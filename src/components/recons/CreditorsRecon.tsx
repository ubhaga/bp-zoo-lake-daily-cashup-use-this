import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useCashupStore } from "@/store/cashupStore";
import { useMasterDataStore } from "@/store/masterDataStore";
import { supabase } from "@/integrations/supabase/client";
import { CurrencyDisplay } from "@/components/ui/CashupUI";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Save, Download } from "lucide-react";
import { CreditorsTable } from "./CreditorsTable";
import type { BreakdownEntry } from "@/components/ui/SourceBreakdown";
import { format, startOfMonth, endOfMonth, addDays, getDay } from "date-fns";
import { toast } from "sonner";
import { downloadCsv } from "@/lib/csvExport";
import { parseBankStatementDateToDate } from "@/lib/bankStatementDate";
import { useBankAllocations } from "@/hooks/useBankAllocations";
import { useReconAdjustments } from "@/hooks/useReconAdjustments";

interface CreditorsReconProps {
  filterMonth: string;
}

export function CreditorsRecon({ filterMonth }: CreditorsReconProps) {
  const { managerEntries } = useCashupStore();
  const { eftSuppliers } = useMasterDataStore();
  const { allocations: bankAllocations } = useBankAllocations(filterMonth);
  const { adjustments: weekAdjustments, getAdjustment, saveAdjustment } = useReconAdjustments(
    "creditor",
    filterMonth,
  );

  // Load bank lines for CR payments (now includes id for allocation matching)
  const [bankLines, setBankLines] = useState<
    { id: string; amount: number; description: string; transaction_date: string }[]
  >([]);
  const [openingBalances, setOpeningBalances] = useState<Record<string, number>>({});
  const [editingOB, setEditingOB] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [prevMonthBankLines, setPrevMonthBankLines] = useState<typeof bankLines>([]);
  const [prevMonthOB, setPrevMonthOB] = useState<Record<string, number>>({});
  const [prevMonth, setPrevMonth] = useState("");

  const isFirstMonth = filterMonth <= "2026-03";

  const loadData = useCallback(async () => {
    const curDate = new Date(filterMonth + "-01");
    const prevDate = new Date(curDate);
    prevDate.setMonth(prevDate.getMonth() - 1);
    const pm = format(prevDate, "yyyy-MM");
    setPrevMonth(pm);

    const [bankRes, obRes] = await Promise.all([
      supabase
        .from("bank_statement_lines")
        .select("id, amount, description, transaction_date")
        .eq("month", filterMonth),
      supabase.from("creditor_opening_balances").select("*").eq("month", filterMonth),
    ]);

    setBankLines((bankRes.data ?? []) as typeof bankLines);
    const obMap: Record<string, number> = {};
    ((obRes.data ?? []) as { supplier: string; amount: number }[]).forEach((r) => {
      obMap[r.supplier] = Number(r.amount);
    });
    setOpeningBalances(obMap);
    setEditingOB({});

    if (filterMonth > "2026-03") {
      const [prevBankRes, prevObRes] = await Promise.all([
        supabase.from("bank_statement_lines").select("id, amount, description, transaction_date").eq("month", pm),
        supabase.from("creditor_opening_balances").select("*").eq("month", pm),
      ]);
      setPrevMonthBankLines((prevBankRes.data ?? []) as typeof bankLines);
      const prevObMap: Record<string, number> = {};
      ((prevObRes.data ?? []) as { supplier: string; amount: number }[]).forEach((r) => {
        prevObMap[r.supplier] = Number(r.amount);
      });
      setPrevMonthOB(prevObMap);
    } else {
      setPrevMonthBankLines([]);
      setPrevMonthOB({});
    }
  }, [filterMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Compute week-ending Sundays for the month
  const monthStart = startOfMonth(new Date(filterMonth + "-01"));
  const monthEnd = endOfMonth(monthStart);
  const sundays: Date[] = [];
  let d = monthStart;
  while (d <= monthEnd) {
    if (getDay(d) === 0) sundays.push(d);
    d = addDays(d, 1);
  }
  // If month doesn't end on Sunday, add monthEnd as final period
  if (getDay(monthEnd) !== 0) sundays.push(monthEnd);

  const FUEL_CREDITORS = ["Engen", "F2K"];
  const isFuelCreditor = (s: string) => FUEL_CREDITORS.some((fc) => fc.toUpperCase() === s.toUpperCase());
  const isBpCreditor = (s: string) => s.toUpperCase() === "BP";

  // EFT invoices from manager daily entries for this month
  const monthManagers = managerEntries.filter((e) => e.date.startsWith(filterMonth));

  // ── Build the full supplier list ─────────────────────────────
  // 1) all suppliers from master data
  // 2) any supplier name actually used in invoices (current + previous month) that
  //    isn't already in the master list — these are flagged as "unrecognised"
  // 3) one synthetic row per unique Sundry vendor name (key = "Sundry: <name>")
  const SUNDRY_SUPPLIER = "Sundry Supplier";
  const SUNDRY_PREFIX = "Sundry: ";

  const masterSet = new Set(eftSuppliers);

  const sundryVendors = new Set<string>();
  const usedInvoiceSuppliers = new Set<string>();
  monthManagers.forEach((entry) => {
    entry.eftInvoices.forEach((inv) => {
      if (!inv.supplier) return;
      if (inv.supplier === SUNDRY_SUPPLIER) {
        const v = (inv.vendorName ?? "").trim();
        if (v) sundryVendors.add(v);
      } else {
        usedInvoiceSuppliers.add(inv.supplier);
      }
    });
  });

  // Unrecognised = used in invoices but not in master and not Sundry
  const unrecognisedSuppliers = [...usedInvoiceSuppliers].filter((s) => !masterSet.has(s));

  const sundryKeys = [...sundryVendors].sort().map((v) => `${SUNDRY_PREFIX}${v}`);

  // Master list excluding Sundry Supplier itself (we replace it with per-vendor rows)
  const masterList = [...eftSuppliers].filter((s) => s !== SUNDRY_SUPPLIER).sort();
  const allSuppliers = [...new Set([...masterList, ...unrecognisedSuppliers, ...sundryKeys])];
  const suppliers = allSuppliers.filter((s) => !isFuelCreditor(s) && !isBpCreditor(s));
  const bpSuppliers = allSuppliers.filter((s) => isBpCreditor(s));
  const fuelSuppliers = allSuppliers.filter((s) => isFuelCreditor(s));

  const isUnrecognised = (s: string) => unrecognisedSuppliers.includes(s);
  const isSundryRow = (s: string) => s.startsWith(SUNDRY_PREFIX);

  // Get cashups for Deep Frozen CC payments
  const { cashups } = useCashupStore();

  // Parse bank payment descriptions and map them to EFT suppliers
  const normalizeName = (value: string) =>
    value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const supplierByNormalized = new Map(
    [...suppliers, ...bpSuppliers, ...fuelSuppliers].map((supplier) => [normalizeName(supplier), supplier]),
  );

  const resolveSupplier = (preferredNames: string[]): string | null => {
    for (const name of preferredNames) {
      const found = supplierByNormalized.get(normalizeName(name));
      if (found) return found;
    }
    return null;
  };

  const matchSupplier = (desc: string): string | null => {
    const raw = desc.toUpperCase().trim();
    const normalized = normalizeName(desc);

    const aliasRules: Array<{ patterns: RegExp[]; suppliers: string[] }> = [
      { patterns: [/\bCR\s+WICKED\s+CONV(?:ENIENCE)?\b/, /\bWICKED\s+CONV\b/], suppliers: ["Wicked Convenience"] },
      { patterns: [/\bCR\s+STATUS\s+HYGIENE\b/, /\bSTATUS\s+HYGIENE\b/], suppliers: ["Status Hygiene"] },
      { patterns: [/\bCR\s+RFP\b/, /\bCR\s+FROZEN\s+SOLN\b/], suppliers: ["RFP"] },
      { patterns: [/\bSS898\b/, /\bSS998\b/], suppliers: ["Clippa Sales"] },
      { patterns: [/\bSHELL\s+F2K\b/, /\bF2K\b/], suppliers: ["F2K"] },
      { patterns: [/\bSHELL\s*DOWN\d+\b/, /\bSHELL\s+DOWNSTREAM\b/], suppliers: ["Shell Downstream"] },
    ];

    for (const rule of aliasRules) {
      if (rule.patterns.some((pattern) => pattern.test(raw))) {
        const supplier = resolveSupplier(rule.suppliers);
        if (supplier) return supplier;
      }
    }

    const crMatch = raw.match(/\bCR\s+(.+)$/);
    const candidate = crMatch ? normalizeName(crMatch[1]) : normalized;

    for (const supplier of suppliers) {
      const supplierNormalized = normalizeName(supplier);
      if (candidate.startsWith(supplierNormalized) || supplierNormalized.startsWith(candidate)) {
        return supplier;
      }
    }

    return null;
  };

  const parseBankDate = (dateStr: string): Date | null => parseBankStatementDateToDate(dateStr);

  // Build weekly data per supplier
  type WeekData = { invoices: number; payments: number };
  const supplierWeekly: Record<string, WeekData[]> = {};
  const supplierInvoiceEntries: Record<string, BreakdownEntry[][]> = {};

  [...suppliers, ...bpSuppliers, ...fuelSuppliers].forEach((supplier) => {
    const weeks: WeekData[] = sundays.map(() => ({ invoices: 0, payments: 0 }));
    const invEntries: BreakdownEntry[][] = sundays.map(() => []);

    // Add EFT invoices — for Sundry rows, match by vendorName instead of supplier name
    const isSundry = isSundryRow(supplier);
    const sundryVendorName = isSundry ? supplier.slice(SUNDRY_PREFIX.length) : null;
    monthManagers.forEach((entry) => {
      const entryDate = new Date(entry.date);
      entry.eftInvoices.forEach((inv) => {
        const matches = isSundry
          ? inv.supplier === SUNDRY_SUPPLIER &&
            (inv.vendorName ?? "").trim() === sundryVendorName
          : inv.supplier === supplier;
        if (matches) {
          const weekIdx = sundays.findIndex((sun) => entryDate <= sun);
          const idx = weekIdx >= 0 ? weekIdx : sundays.length - 1;
          weeks[idx].invoices += inv.inclusive;
          invEntries[idx].push({ date: entry.date, amount: inv.inclusive, label: 'EFT' });
        }
      });
    });

    // Deduct bank CR payments (check manual allocation first, then regex)
    bankLines.forEach((line) => {
      // Check manual allocation first
      const allocation = bankAllocations.find((a) => a.bank_line_id === line.id && a.recon_type === "creditor");
      const matched = allocation ? allocation.target_name : matchSupplier(line.description);
      if (matched !== supplier) return;
      const lineDate = parseBankDate(line.transaction_date);
      if (!lineDate) return;
      const paymentAmount = Math.abs(line.amount);
      const weekIdx = sundays.findIndex((sun) => lineDate <= sun);
      const idx = weekIdx >= 0 ? weekIdx : sundays.length - 1;
      weeks[idx].payments += paymentAmount;
    });

    // Add Deep Frozen paid in CC from manager daily as payments for "Deep frozen" supplier
    const isDeepFrozen = supplier.toLowerCase().replace(/\s+/g, "") === "deepfrozen";
    if (isDeepFrozen) {
      monthManagers.forEach((entry) => {
        const dfAmount = entry.deepFrozenCC ?? 0;
        if (dfAmount > 0) {
          const entryDate = new Date(entry.date);
          const weekIdx = sundays.findIndex((sun) => entryDate <= sun);
          const idx = weekIdx >= 0 ? weekIdx : sundays.length - 1;
          weeks[idx].payments += dfAmount;
        }
      });
    }

    supplierWeekly[supplier] = weeks;
    supplierInvoiceEntries[supplier] = invEntries;
  });

  // Apply user adjustments (deltas) to weekly figures
  weekAdjustments.forEach((adj) => {
    const weeks = supplierWeekly[adj.target_name];
    if (!weeks) return;
    const wi = adj.week_index ?? 0;
    if (wi < 0 || wi >= weeks.length) return;
    if (adj.field === "invoices") weeks[wi].invoices += Number(adj.amount);
    else if (adj.field === "payments") weeks[wi].payments += Number(adj.amount);
  });

  // Compute effective opening balances: for April+, use previous month closing as default
  const effectiveOB = useMemo(() => {
    const result: Record<string, number> = { ...openingBalances };

    if (!isFirstMonth && prevMonth) {
      const prevMonthManagers = managerEntries.filter((e) => e.date.startsWith(prevMonth));

      [...suppliers, ...bpSuppliers, ...fuelSuppliers].forEach((supplier) => {
        // If there's already a manually-entered OB for this month, keep it
        if (openingBalances[supplier] !== undefined) return;

        // Compute previous month closing: OB + invoices - payments
        const prevOB = prevMonthOB[supplier] ?? 0;
        let totalInv = 0;
        let totalPay = 0;

        const isSundry = isSundryRow(supplier);
        const sundryVendorName = isSundry ? supplier.slice(SUNDRY_PREFIX.length) : null;

        // Previous month invoices
        prevMonthManagers.forEach((entry) => {
          entry.eftInvoices.forEach((inv) => {
            const matches = isSundry
              ? inv.supplier === SUNDRY_SUPPLIER &&
                (inv.vendorName ?? "").trim() === sundryVendorName
              : inv.supplier === supplier;
            if (matches) totalInv += inv.inclusive;
          });
        });

        // Previous month payments from bank
        prevMonthBankLines.forEach((line) => {
          const matched = matchSupplier(line.description);
          if (matched !== supplier) return;
          totalPay += Math.abs(line.amount);
        });

        const closing = prevOB + totalInv - totalPay;
        if (closing !== 0) {
          result[supplier] = closing;
        }
      });
    }

    return result;
  }, [
    openingBalances,
    isFirstMonth,
    prevMonth,
    prevMonthOB,
    prevMonthBankLines,
    managerEntries,
    // suppliers/fuelSuppliers identities change each render (rebuilt above).
    // We intentionally exclude them and rely on the inputs above.
  ]);

  // Save opening balances
  const handleSaveOB = async () => {
    setSaving(true);
    try {
      const entries = Object.entries(editingOB);
      for (const [supplier, valStr] of entries) {
        const amount = parseFloat(valStr) || 0;
        await supabase
          .from("creditor_opening_balances")
          .upsert({ month: filterMonth, supplier, amount } as never, { onConflict: "month,supplier" });
        setOpeningBalances((prev) => ({ ...prev, [supplier]: amount }));
      }
      setEditingOB({});
      toast.success("Opening balances saved");
    } catch {
      toast.error("Failed to save");
    }
    setSaving(false);
  };

  const hasEdits = Object.keys(editingOB).length > 0;

  // Format sunday labels
  const weekLabels = sundays.map((sun, i) =>
    i === sundays.length - 1 && getDay(monthEnd) !== 0 ? format(sun, "dd MMM") + " (EOM)" : format(sun, "dd MMM"),
  );

  const renderTable = (title: string, supplierList: string[]) => {
    const activeSuppliers = supplierList.filter((s) => {
      const weeks = supplierWeekly[s];
      const ob = effectiveOB[s] ?? 0;
      return ob !== 0 || weeks.some((w) => w.invoices > 0 || w.payments > 0);
    });
    const inactiveSuppliers = supplierList.filter((s) => !activeSuppliers.includes(s));

    return (
      <CreditorsTable
        title={title}
        activeSuppliers={activeSuppliers}
        inactiveSuppliers={inactiveSuppliers}
        supplierWeekly={supplierWeekly}
        openingBalances={effectiveOB}
        editingOB={editingOB}
        setEditingOB={setEditingOB}
        weekLabels={weekLabels}
        sundays={sundays}
        readOnlyOB={!isFirstMonth}
        invoiceEntries={supplierInvoiceEntries}
        month={filterMonth}
        getAdjustment={getAdjustment}
        saveAdjustment={saveAdjustment}
        unrecognisedSuppliers={unrecognisedSuppliers}
        sundryKeys={sundryKeys}
      />
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const allSup = [...suppliers, ...bpSuppliers, ...fuelSuppliers];
            const headers = [
              "Supplier",
              "Opening Balance",
              ...weekLabels.flatMap((l) => [`Invoices (${l})`, `Payments (${l})`, `Balance (${l})`]),
            ];
            const csvRows = allSup.map((s) => {
              const ob = effectiveOB[s] ?? 0;
              let bal = ob;
              const weeks = supplierWeekly[s];
              const weekCols = weeks.flatMap((w) => {
                bal = bal + w.invoices - w.payments;
                return [w.invoices, w.payments, bal];
              });
              return [s, ob, ...weekCols] as (string | number)[];
            });
            downloadCsv(headers, csvRows, `creditors-recon-${filterMonth}.csv`);
          }}
        >
          <Download className="h-3.5 w-3.5 mr-1" />
          Export CSV
        </Button>
        {hasEdits && (
          <Button size="sm" onClick={handleSaveOB} disabled={saving}>
            <Save className="h-3.5 w-3.5 mr-1" />
            Save Opening Balances
          </Button>
        )}
      </div>
      {renderTable(`Creditors Reconciliation — ${format(monthStart, "MMMM yyyy")}`, suppliers)}
      {bpSuppliers.length > 0 && renderTable(`BP — ${format(monthStart, "MMMM yyyy")}`, bpSuppliers)}
      {fuelSuppliers.length > 0 && renderTable(`Fuel Creditors — ${format(monthStart, "MMMM yyyy")}`, fuelSuppliers)}
    </div>
  );
}
