import { useMemo, useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CurrencyDisplay } from "@/components/ui/CashupUI";
import { useCashupStore } from "@/store/cashupStore";
import { useMasterDataStore } from "@/store/masterDataStore";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO, addDays, lastDayOfMonth, startOfMonth, endOfMonth, getDay, parse } from "date-fns";
import type { ManagerDailyEntry } from "@/types/cashup";
import { extractTerminalNumber, getCanonicalSpeedpointTerminal } from "@/lib/speedpointMatching";

interface AfsMonthlyProps {
  selectedDate: string;
}

// Chain-walking closing balance logic (same as ManagerDailyForm)
interface EffectiveClosing {
  coins: number;
  easypay: number;
  cc: number;
}

function computeEffectiveClosingForDate(
  targetDate: string,
  getEntry: (d: string) => ManagerDailyEntry | undefined,
  getCashup: (d: string) => { shop: { coins: number; easyPay: number; cashDepositedBanking: number } } | undefined,
): EffectiveClosing | null {
  const SEED_DATE = "2026-01-01";
  if (targetDate < SEED_DATE) return null;

  const dates: string[] = [];
  let d = parseISO(SEED_DATE);
  const end = parseISO(targetDate);
  while (d <= end) {
    dates.push(format(d, "yyyy-MM-dd"));
    d = addDays(d, 1);
  }

  let coinsOpening = 4483.15;
  let easypayOpening = 3500;
  let ccOpening = 2000;

  for (const date of dates) {
    const entry = getEntry(date);
    const cashup = getCashup(date);

    let effCoinsOpen: number, effEasypayOpen: number, effCCOpen: number;
    if (date === SEED_DATE) {
      effCoinsOpen = 4483.15;
      effEasypayOpen = 3500;
      effCCOpen = 2000;
    } else {
      effCoinsOpen = coinsOpening;
      effEasypayOpen = easypayOpening;
      effCCOpen = ccOpening;
    }

    const dailyCoins = cashup?.shop.coins ?? 0;
    const dailyEasypay = cashup?.shop.easyPay ?? 0;
    const dailyCC = cashup?.shop.cashDepositedBanking ?? 0;
    const closureCoins = Math.abs(entry?.ccBagClosureCoins ?? 0);
    const closureEasypay = Math.abs(entry?.ccBagClosureEasypay ?? 0);
    const closureCC = Math.abs(entry?.ccBagClosureCashConnect ?? 0);
    const transferFromCoins = Math.abs(entry?.transferFromCoins ?? 0);

    coinsOpening = effCoinsOpen + dailyCoins - closureCoins - transferFromCoins;
    easypayOpening = effEasypayOpen + dailyEasypay - closureEasypay;
    ccOpening = effCCOpen + dailyCC - closureCC + transferFromCoins;
  }

  return { coins: coinsOpening, easypay: easypayOpening, cc: ccOpening };
}

export function AfsMonthly({ selectedDate }: AfsMonthlyProps) {
  const month = selectedDate.slice(0, 7);
  const cashups = useCashupStore((s) => s.cashups);
  const managerEntries = useCashupStore((s) => s.managerEntries);
  const monthlyFigures = useCashupStore((s) => s.monthlyFigures);
  const { eftSuppliers, speedpointTerminals } = useMasterDataStore();

  // Load bank lines + creditor opening balances
  const [bankLines, setBankLines] = useState<
    { id: string; amount: number; description: string; transaction_date: string; matched_terminal: string }[]
  >([]);
  const [prevBankLines, setPrevBankLines] = useState<
    { id: string; amount: number; description: string; transaction_date: string; matched_terminal: string }[]
  >([]);
  const [creditorOBs, setCreditorOBs] = useState<Record<string, number>>({});
  const [manualMatches, setManualMatches] = useState<
    { month: string; cashup_date: string; terminal: string; bank_amount: number; bank_line_id: string }[]
  >([]);

  const prevMonth = useMemo(() => {
    const d = new Date(month + "-01");
    d.setMonth(d.getMonth() - 1);
    return format(d, "yyyy-MM");
  }, [month]);

  const loadData = useCallback(async () => {
    const [bankRes, prevBankRes, obRes, matchRes] = await Promise.all([
      supabase
        .from("bank_statement_lines")
        .select("id, matched_terminal, amount, description, transaction_date")
        .eq("month", month),
      supabase
        .from("bank_statement_lines")
        .select("id, matched_terminal, amount, description, transaction_date")
        .eq("month", prevMonth),
      supabase.from("creditor_opening_balances").select("*").eq("month", month),
      supabase.from("speedpoint_manual_matches").select("*").in("month", [month, prevMonth]),
    ]);
    setBankLines((bankRes.data ?? []) as typeof bankLines);
    setPrevBankLines((prevBankRes.data ?? []) as typeof prevBankLines);
    const obMap: Record<string, number> = {};
    ((obRes.data ?? []) as { supplier: string; amount: number }[]).forEach((r) => {
      obMap[r.supplier] = Number(r.amount);
    });
    setCreditorOBs(obMap);
    setManualMatches((matchRes.data ?? []) as typeof manualMatches);
  }, [month, prevMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Income Statement ──
  const incomeStatement = useMemo(() => {
    const mf = monthlyFigures.find((f) => f.month === month);
    const monthlyCashups = cashups.filter((c) => c.month === month);
    const monthlyManagers = managerEntries.filter((e) => e.date.startsWith(month));

    // Sales from JE 1 credits
    const sales = [
      { description: "Sales Fuel", amount: mf ? mf.salesFuel + mf.adjFuel : 0 },
      { description: "Sales WSL DSL", amount: mf ? mf.salesWslDsl + mf.adjWslDsl : 0 },
      { description: "Sales C Store", amount: mf ? mf.salesCStore + mf.adjCStore : 0 },
      { description: "Sales Gas", amount: mf ? mf.salesGas + mf.adjGas : 0 },
      { description: "Sales Oil", amount: mf ? mf.salesOil + mf.adjOil : 0 },
    ];
    const totalSales = sales.reduce((s, r) => s + r.amount, 0);

    // COS from JE 2 categories
    const managerPayoutByVendor = new Map<
      string,
      Map<string, { count: number; entries: { category: string; vat: number }[] }>
    >();
    monthlyManagers.forEach((e) => {
      e.payoutInvoices.forEach((inv) => {
        const vendor = inv.supplier.toLowerCase().trim();
        if (!managerPayoutByVendor.has(vendor)) managerPayoutByVendor.set(vendor, new Map());
        const dateMap = managerPayoutByVendor.get(vendor)!;
        const existing = dateMap.get(e.date) ?? { count: 0, entries: [] };
        existing.count += 1;
        existing.entries.push({ category: inv.category || "", vat: inv.vat });
        dateMap.set(e.date, existing);
      });
    });

    const invoiceConsumed = new Map<string, number>();
    const matchPayout = (payoutDate: string, vendor: string): { category: string; vat: number } => {
      const v = vendor.toLowerCase().trim();
      const dateMap = managerPayoutByVendor.get(v);
      if (!dateMap) return { category: "", vat: 0 };
      const sameKey = `${v}|${payoutDate}`;
      const sameEntry = dateMap.get(payoutDate);
      const sameAvail = sameEntry ? sameEntry.count - (invoiceConsumed.get(sameKey) ?? 0) : 0;
      if (sameAvail > 0) {
        const idx = invoiceConsumed.get(sameKey) ?? 0;
        invoiceConsumed.set(sameKey, idx + 1);
        return sameEntry!.entries[idx];
      }
      for (const [date, entry] of dateMap) {
        const otherKey = `${v}|${date}`;
        const idx = invoiceConsumed.get(otherKey) ?? 0;
        if (entry.count - idx > 0) {
          invoiceConsumed.set(otherKey, idx + 1);
          return entry.entries[idx];
        }
      }
      return { category: "", vat: 0 };
    };

    const allCatMap: Record<string, { total: number; totalVat: number }> = {};
    monthlyCashups.forEach((c) => {
      c.shop.payouts.forEach((p) => {
        const match = matchPayout(c.date, p.vendor);
        const cat = match.category || "Uncategorised";
        if (!allCatMap[cat]) allCatMap[cat] = { total: 0, totalVat: 0 };
        allCatMap[cat].total += p.amount;
        allCatMap[cat].totalVat += match.vat;
      });
      if (c.shop.lottoPayouts > 0) {
        const match = matchPayout(c.date, "Lotto");
        const cat = match.category || "Uncategorised";
        if (!allCatMap[cat]) allCatMap[cat] = { total: 0, totalVat: 0 };
        allCatMap[cat].total += c.shop.lottoPayouts;
        allCatMap[cat].totalVat += match.vat;
      }
    });
    monthlyManagers.forEach((e) => {
      e.eftInvoices.forEach((inv) => {
        const cat = inv.category || "Uncategorised";
        if (!allCatMap[cat]) allCatMap[cat] = { total: 0, totalVat: 0 };
        allCatMap[cat].total += inv.inclusive;
        allCatMap[cat].totalVat += inv.vat;
      });
    });

    const cosMapping = [
      { label: "COS Fuel", key: "COS Fuel" },
      { label: "COS WSL DSL", key: "COS WSL DSL" },
      { label: "COS C Store", key: "COS C Store" },
      { label: "COS Gas", key: "COS Gas" },
      { label: "COS Oil", key: "COS Oil" },
    ];

    const cos = cosMapping.map((c) => {
      const catData = allCatMap[c.key];
      if (!catData) return { description: c.label, amount: 0 };
      const exclVat = catData.totalVat / 0.15;
      const noVat = catData.total - exclVat - catData.totalVat;
      return { description: c.label, amount: exclVat + noVat };
    });
    const totalCOS = cos.reduce((s, r) => s + r.amount, 0);
    const grossProfit = totalSales - totalCOS;

    return { sales, totalSales, cos, totalCOS, grossProfit };
  }, [month, cashups, managerEntries, monthlyFigures]);

  // ── Balance Sheet: Shift Clearing ──
  const shiftClearing = useMemo(() => {
    const monthDate = parseISO(month + "-01");
    const lastDay = format(lastDayOfMonth(monthDate), "yyyy-MM-dd");
    const getEntry = (d: string) => managerEntries.find((e) => e.date === d);
    const getCashup = (d: string) => cashups.find((c) => c.date === d);
    const closing = computeEffectiveClosingForDate(lastDay, getEntry, getCashup);

    return [
      { description: "Shift Clearing — Cash Connect", amount: closing?.cc ?? 0 },
      { description: "Shift Clearing — Easypay", amount: closing?.easypay ?? 0 },
      { description: "Shift Clearing — Coins", amount: closing?.coins ?? 0 },
    ];
  }, [month, cashups, managerEntries]);

  // ── Balance Sheet: EFT Clearing (Speedpoint recon TOTAL diff per terminal) ──
  // SP_TERMINALS comes from Settings → Speedpoint Terminals; only terminals with a
  // configured bank-statement match pattern participate in the EFT recon.
  const SP_TERMINALS = useMemo(
    () => speedpointTerminals.filter((t) => t.bankPattern.trim() !== "").map((t) => t.name),
    [speedpointTerminals],
  );
  const eftClearing = useMemo(() => {
    const monthlyCashups = cashups.filter((c) => c.month === month);
    const prevMonthCashups = cashups.filter((c) => c.month === prevMonth);

    const TERMINAL_NUM_MAP: Record<string, string> = {};
    SP_TERMINALS.forEach((t) => {
      const terminalNumber = extractTerminalNumber(t);
      if (terminalNumber) TERMINAL_NUM_MAP[t] = terminalNumber;
    });

    // Current month speedpoint totals per terminal
    type SpTermData = { batchNo: string; total: number };
    const speedpointByDate = monthlyCashups.map((c) => {
      const termMap: Record<string, SpTermData> = {};
      SP_TERMINALS.forEach((t) => {
        termMap[t] = { batchNo: "", total: 0 };
      });
      c.shop.speedpoints.forEach((sp) => {
        if (!termMap[sp.terminal]) termMap[sp.terminal] = { batchNo: "", total: 0 };
        termMap[sp.terminal].batchNo = sp.batchNo || termMap[sp.terminal].batchNo;
        termMap[sp.terminal].total += sp.shopAmount;
      });
      c.opt.speedpoints.forEach((sp) => {
        if (!termMap[sp.terminal]) termMap[sp.terminal] = { batchNo: "", total: 0 };
        termMap[sp.terminal].batchNo = sp.batchNo || termMap[sp.terminal].batchNo;
        termMap[sp.terminal].total += sp.optAmount;
      });
      return { date: c.date, terminals: termMap };
    });

    const spColumnTotals: Record<string, number> = {};
    SP_TERMINALS.forEach((t) => {
      spColumnTotals[t] = speedpointByDate.reduce((s, r) => s + (r.terminals[t]?.total ?? 0), 0);
    });

    // Bank parsed
    type BankParsedLine = { terminal: string; batch: string; amount: number; bankLineId: string };
    const bankParsed: BankParsedLine[] = [];
    bankLines.forEach((l) => {
      const canonicalTerminal = getCanonicalSpeedpointTerminal(l.matched_terminal, SP_TERMINALS);
      if (!canonicalTerminal || !SP_TERMINALS.includes(canonicalTerminal)) return;
      const termNum = TERMINAL_NUM_MAP[canonicalTerminal] || "";
      const batchMatch = l.description.match(new RegExp(`${termNum}\\s+(\\d+)`));
      const batch = batchMatch ? batchMatch[1] : "";
      bankParsed.push({ terminal: canonicalTerminal, batch, amount: l.amount, bankLineId: l.id });
    });

    const currentManualMatches = manualMatches.filter((m) => m.month === month);
    const manuallyMatchedIds = new Set(
      currentManualMatches
        .map((m) => m.bank_line_id)
        .filter((id): id is string => Boolean(id))
    );

    const bankLookup: Record<string, number> = {};
    bankParsed.forEach((bp) => {
      if (!bp.batch) return;
      if (manuallyMatchedIds.has(bp.bankLineId)) return;
      const key = `${bp.terminal}|${bp.batch}`;
      bankLookup[key] = (bankLookup[key] || 0) + bp.amount;
    });

    // Manual matches for current month
    const manualByKey: Record<string, number> = {};
    currentManualMatches.forEach((m) => {
      const key = `${m.cashup_date}|${m.terminal}`;
      manualByKey[key] = (manualByKey[key] || 0) + m.bank_amount;
    });

    // Match current month rows
    const consumedBankKeys = new Set<string>();
    const speedpointMatches: Record<string, { bankAmount: number }>[] = speedpointByDate.map((r) => {
      const rowMatch: Record<string, { bankAmount: number }> = {};
      SP_TERMINALS.forEach((t) => {
        const td = r.terminals[t];
        if (!td || td.total === 0) {
          rowMatch[t] = { bankAmount: 0 };
          return;
        }
        const key = `${t}|${td.batchNo}`;
        let bankAmt = 0;
        if (!consumedBankKeys.has(key)) {
          bankAmt = bankLookup[key] ?? 0;
          if (bankAmt > 0) consumedBankKeys.add(key);
        }
        const manualKey = `${r.date}|${t}`;
        bankAmt += manualByKey[manualKey] || 0;
        rowMatch[t] = { bankAmount: bankAmt };
      });
      return rowMatch;
    });

    // Opening balance from prev month unmatched
    const prevBankParsed: BankParsedLine[] = [];
    prevBankLines.forEach((l) => {
      const canonicalTerminal = getCanonicalSpeedpointTerminal(l.matched_terminal, SP_TERMINALS);
      if (!canonicalTerminal || !SP_TERMINALS.includes(canonicalTerminal)) return;
      const termNum = TERMINAL_NUM_MAP[canonicalTerminal] || "";
      const batchMatch = l.description.match(new RegExp(`${termNum}\\s+(\\d+)`));
      const batch = batchMatch ? batchMatch[1] : "";
      prevBankParsed.push({ terminal: canonicalTerminal, batch, amount: l.amount, bankLineId: l.id });
    });
    const prevManualMatches = manualMatches.filter((m) => m.month === prevMonth);
    const prevManuallyMatchedIds = new Set(
      prevManualMatches
        .map((m) => m.bank_line_id)
        .filter((id): id is string => Boolean(id))
    );

    const prevBankLookup: Record<string, number> = {};
    prevBankParsed.forEach((bp) => {
      if (!bp.batch) return;
      if (prevManuallyMatchedIds.has(bp.bankLineId)) return;
      const k = `${bp.terminal}|${bp.batch}`;
      prevBankLookup[k] = (prevBankLookup[k] || 0) + bp.amount;
    });

    const prevManualByKey: Record<string, number> = {};
    prevManualMatches.forEach((m) => {
      const key = `${m.cashup_date}|${m.terminal}`;
      prevManualByKey[key] = (prevManualByKey[key] || 0) + m.bank_amount;
    });

    const prevSpeedpointByDate = prevMonthCashups.map((c) => {
      const termMap: Record<string, SpTermData> = {};
      SP_TERMINALS.forEach((t) => {
        termMap[t] = { batchNo: "", total: 0 };
      });
      c.shop.speedpoints.forEach((sp) => {
        if (!termMap[sp.terminal]) termMap[sp.terminal] = { batchNo: "", total: 0 };
        termMap[sp.terminal].batchNo = sp.batchNo || termMap[sp.terminal].batchNo;
        termMap[sp.terminal].total += sp.shopAmount;
      });
      c.opt.speedpoints.forEach((sp) => {
        if (!termMap[sp.terminal]) termMap[sp.terminal] = { batchNo: "", total: 0 };
        termMap[sp.terminal].batchNo = sp.batchNo || termMap[sp.terminal].batchNo;
        termMap[sp.terminal].total += sp.optAmount;
      });
      return { date: c.date, terminals: termMap };
    });

    // OB rows
    const prevConsumedBatchKeys = new Set<string>();
    const obByTerminal: Record<string, { cashup: number; bank: number }> = {};
    SP_TERMINALS.forEach((t) => {
      obByTerminal[t] = { cashup: 0, bank: 0 };
    });

    prevSpeedpointByDate.forEach((r) => {
      SP_TERMINALS.forEach((t) => {
        const td = r.terminals[t];
        if (!td || td.total === 0) return;
        const batchKey = `${t}|${td.batchNo}`;
        const hasMeaningfulBatch = td.batchNo && td.batchNo !== "X" && td.batchNo !== "";
        if (hasMeaningfulBatch && prevConsumedBatchKeys.has(batchKey)) return;
        if (hasMeaningfulBatch) prevConsumedBatchKeys.add(batchKey);

        const autoBankAmt = prevBankLookup[batchKey] ?? 0;
        const prevManualKey = `${r.date}|${t}`;
        const prevManualAmt = prevManualByKey[prevManualKey] || 0;
        const totalBank = autoBankAmt + prevManualAmt;
        const diff = td.total - totalBank;
        if (Math.abs(diff) > 0.01) {
          const obKey = `OB-${r.date}|${t}`;
          const obManualAmt = manualByKey[obKey] || 0;
          obByTerminal[t].cashup += diff;
          obByTerminal[t].bank += obManualAmt;
        }
      });
    });

    // Compute TOTAL diff per terminal (same as recon TOTAL row)
    const items = SP_TERMINALS.map((t) => {
      const cashupTotal = (spColumnTotals[t] ?? 0) + obByTerminal[t].cashup;
      const bankTotal = speedpointMatches.reduce((s, rm) => s + (rm[t]?.bankAmount ?? 0), 0) + obByTerminal[t].bank;
      const diff = cashupTotal - bankTotal;
      return { description: `EFT Clearing — ${t}`, amount: diff };
    });

    const total = items.reduce((s, r) => s + r.amount, 0);
    return { items, total };
  }, [month, prevMonth, cashups, bankLines, prevBankLines, manualMatches]);

  // ── Balance Sheet: Trade Creditors & Fuel Creditors (EOM balance) ──
  const creditors = useMemo(() => {
    const FUEL_CREDITORS = ["Engen", "F2K"];
    const isFuelCreditor = (s: string) => FUEL_CREDITORS.some((fc) => fc.toUpperCase() === s.toUpperCase());
    const allSuppliers = [...eftSuppliers].filter((s) => s.toUpperCase() !== "DAWN CONSULTANTS").sort();
    const tradeSuppliers = allSuppliers.filter((s) => !isFuelCreditor(s));
    const fuelSuppliers = allSuppliers.filter((s) => isFuelCreditor(s));

    const monthManagers = managerEntries.filter((e) => e.date.startsWith(month));

    // Bank line supplier matching (same logic as CreditorsRecon)
    const normalizeName = (value: string) =>
      value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const supplierByNormalized = new Map(allSuppliers.map((supplier) => [normalizeName(supplier), supplier]));

    const resolveSupplier = (preferredNames: string[]): string | null => {
      for (const name of preferredNames) {
        const found = supplierByNormalized.get(normalizeName(name));
        if (found) return found;
      }
      return null;
    };

    const matchSupplier = (desc: string): string | null => {
      const raw = desc.toUpperCase().trim();

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
          return resolveSupplier(rule.suppliers);
        }
      }

      const crMatch = raw.match(/\bCR\s+(.+)$/);
      const candidate = crMatch ? normalizeName(crMatch[1]) : normalizeName(desc);

      for (const supplier of allSuppliers) {
        const supplierNormalized = normalizeName(supplier);
        if (candidate.startsWith(supplierNormalized) || supplierNormalized.startsWith(candidate)) {
          return supplier;
        }
      }
      return null;
    };

    // Compute EOM balance per supplier: OB + total invoices - total payments
    const computeEOMBalance = (supplierList: string[]): number => {
      let total = 0;
      for (const supplier of supplierList) {
        let balance = creditorOBs[supplier] ?? 0;

        // Add invoices
        monthManagers.forEach((entry) => {
          entry.eftInvoices.forEach((inv) => {
            if (inv.supplier === supplier) balance += inv.inclusive;
          });
        });

        // Deduct payments
        bankLines.forEach((line) => {
          const matched = matchSupplier(line.description);
          if (matched === supplier) balance -= Math.abs(line.amount);
        });

        total += balance;
      }
      return total;
    };

    const tradeTotal = computeEOMBalance(tradeSuppliers);
    const fuelTotal = computeEOMBalance(fuelSuppliers);

    return { tradeTotal, fuelTotal };
  }, [month, managerEntries, bankLines, creditorOBs, eftSuppliers]);

  // ── Balance Sheet: Debtors (closing balance from Debtors Recon) ──
  const debtorsClosing = useMemo(() => {
    const DEBTOR_ACCOUNTS = [
      "Mahindra",
      "Lancaster Pharmacy",
      "Hyde Park Toyota",
      "Hltc",
      "St Theresas",
      "Sayinile",
      "Red cross",
      "Umesh",
      "Isuzu bakkie",
      "Bp Zoolake",
      "Bp Zoolake Account Customer",
      "Shell Parkhurst",
      "House tech",
      "Moses bpzl",
      "Generator",
      "Shop Expense",
    ];
    const JE3_WRITEOFF_ACCOUNTS = ["Generator", "Shop Expense"];
    const BANK_PAYMENT_RULES: { pattern: RegExp; account: string }[] = [
      { pattern: /ST TERESA/i, account: "St Theresas" },
      { pattern: /OSIRIS.*LANCASTER|LANCASTER.*PHARMACY/i, account: "Lancaster Pharmacy" },
      { pattern: /FNB OB.*HPT|HYDE PARK TOYOTA/i, account: "Hyde Park Toyota" },
      { pattern: /CR BP ZOO.*ISUZU/i, account: "Isuzu bakkie" },
      { pattern: /CR BP ZOO.*MAHINDRA|BP ZOO MAHINDRA/i, account: "Mahindra" },
      { pattern: /CR BP ZOO.*LAKE.*DSL|BP ZOO LAKE DSL/i, account: "Bp Zoolake" },
    ];

    const monthlyCashups = cashups.filter((c) => c.month === month);

    // Opening balances from creditor_opening_balances (debtor: prefix)
    const obMap: Record<string, number> = {};
    Object.entries(creditorOBs).forEach(([key, val]) => {
      if (key.startsWith("debtor:")) obMap[key.replace("debtor:", "")] = val;
    });

    // Purchases from cashups
    const purchases: Record<string, number> = {};
    DEBTOR_ACCOUNTS.forEach((a) => {
      purchases[a] = 0;
    });
    for (const c of monthlyCashups) {
      for (const a of c.shop.accounts ?? []) {
        if (purchases[a.name] !== undefined) purchases[a.name] += a.amount;
      }
      for (const a of c.opt.accounts ?? []) {
        if (purchases[a.name] !== undefined) purchases[a.name] += a.amount;
      }
    }

    // Bank payments
    const bankPmts: Record<string, number> = {};
    DEBTOR_ACCOUNTS.forEach((a) => {
      bankPmts[a] = 0;
    });
    for (const line of bankLines) {
      if (line.amount <= 0) continue;
      for (const rule of BANK_PAYMENT_RULES) {
        if (rule.pattern.test(line.description)) {
          bankPmts[rule.account] = (bankPmts[rule.account] || 0) + line.amount;
          break;
        }
      }
    }

    // ROA payments
    for (const c of monthlyCashups) {
      for (const r of c.shop.receipts ?? []) {
        if (r.type === "Debtors Received on Account ROA" && r.amount > 0) {
          const ref = (r.seqNo || "").trim();
          const matched = DEBTOR_ACCOUNTS.find((a) => a.toLowerCase() === ref.toLowerCase());
          if (matched) bankPmts[matched] = (bankPmts[matched] || 0) + r.amount;
        }
      }
    }

    // Net closing balance
    let total = 0;
    DEBTOR_ACCOUNTS.forEach((name) => {
      const ob = obMap[name] ?? 0;
      const purchase = purchases[name] || 0;
      const pmt = bankPmts[name] || 0;
      const adj = JE3_WRITEOFF_ACCOUNTS.includes(name) ? purchase : 0;
      total += ob + purchase - pmt - adj;
    });

    return total;
  }, [month, cashups, bankLines, creditorOBs]);

  // ── Balance Sheet: BLD Creditor & Easypay Debtor (from Airtime Recon logic) ──
  const airtimeBalances = useMemo(() => {
    const BLD_OPENING = -11906.34;
    const EASYPAY_OPENING = 14392.59;
    const monthlyCashups = cashups.filter((c) => c.month === month);

    const parseBankDate = (dateStr: string): string | null => {
      try {
        const parts = dateStr.split("/");
        if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
        return null;
      } catch {
        return null;
      }
    };

    // BLD payments from bank
    let totalBldPayments = 0;
    bankLines.forEach((line) => {
      const desc = line.description.toUpperCase().trim();
      if (desc.includes("BLD DO") || desc.includes("BLUE LABEL")) {
        totalBldPayments += Math.abs(line.amount);
      }
    });

    // BLD invoices (Blue Label receipts) & Easypay invoices/collections from cashups
    let totalBldInvoices = 0;
    let totalEasypayInvoices = 0;
    let totalEasypayCollections = 0;

    monthlyCashups.forEach((c) => {
      c.shop.receipts.forEach((r) => {
        if (r.type === "Blue Label") totalBldInvoices += r.amount;
        if (r.type === "Easypay") totalEasypayInvoices += r.amount;
      });
      totalEasypayCollections += c.shop.easyPay ?? 0;
    });

    const bldClosing = BLD_OPENING - totalBldInvoices + totalBldPayments;
    const easypayClosing = EASYPAY_OPENING + totalEasypayInvoices - totalEasypayCollections;

    return { bldClosing, easypayClosing };
  }, [month, cashups, bankLines]);

  const totalCurrentAssets =
    shiftClearing.reduce((s, r) => s + r.amount, 0) +
    eftClearing.total +
    airtimeBalances.easypayClosing +
    debtorsClosing;
  const totalCurrentLiabilities = creditors.tradeTotal + creditors.fuelTotal + Math.abs(airtimeBalances.bldClosing);
  const netBalanceSheet = totalCurrentAssets - totalCurrentLiabilities;

  return (
    <div className="space-y-6">
      {/* Income Statement */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Income Statement ({month})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Description</TableHead>
                <TableHead className="text-xs text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-muted/50">
                <TableCell colSpan={2} className="text-sm font-semibold py-1.5">
                  Sales
                </TableCell>
              </TableRow>
              {incomeStatement.sales.map((r) => (
                <TableRow key={r.description}>
                  <TableCell className="text-sm py-1.5 pl-6">{r.description}</TableCell>
                  <TableCell className="text-right py-1.5">
                    <CurrencyDisplay value={r.amount} />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-secondary">
                <TableCell className="text-sm font-semibold py-1.5">Total Sales</TableCell>
                <TableCell className="text-right py-1.5">
                  <CurrencyDisplay value={incomeStatement.totalSales} highlight />
                </TableCell>
              </TableRow>

              <TableRow className="bg-muted/50">
                <TableCell colSpan={2} className="text-sm font-semibold py-1.5">
                  Cost of Sales
                </TableCell>
              </TableRow>
              {incomeStatement.cos.map((r) => (
                <TableRow key={r.description}>
                  <TableCell className="text-sm py-1.5 pl-6">{r.description}</TableCell>
                  <TableCell className="text-right py-1.5">
                    <CurrencyDisplay value={r.amount} />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-secondary">
                <TableCell className="text-sm font-semibold py-1.5">Total Cost of Sales</TableCell>
                <TableCell className="text-right py-1.5">
                  <CurrencyDisplay value={incomeStatement.totalCOS} highlight />
                </TableCell>
              </TableRow>
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold text-sm">Gross Profit</TableCell>
                <TableCell className="text-right">
                  <CurrencyDisplay value={incomeStatement.grossProfit} highlight />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      {/* Balance Sheet */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Balance Sheet ({month})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Description</TableHead>
                <TableHead className="text-xs text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Current Assets header */}
              <TableRow className="bg-primary/10">
                <TableCell colSpan={2} className="text-sm font-bold py-2">
                  Current Assets
                </TableCell>
              </TableRow>

              {/* Shift Clearing */}
              <TableRow className="bg-muted/50">
                <TableCell colSpan={2} className="text-sm font-semibold py-1.5 pl-4">
                  Shift Clearing
                </TableCell>
              </TableRow>
              {shiftClearing.map((r) => (
                <TableRow key={r.description}>
                  <TableCell className="text-sm py-1.5 pl-8">{r.description}</TableCell>
                  <TableCell className="text-right py-1.5">
                    <CurrencyDisplay value={r.amount} />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-secondary">
                <TableCell className="text-sm font-semibold py-1.5 pl-4">Total Shift Clearing</TableCell>
                <TableCell className="text-right py-1.5">
                  <CurrencyDisplay value={shiftClearing.reduce((s, r) => s + r.amount, 0)} highlight />
                </TableCell>
              </TableRow>

              {/* EFT Clearing */}
              <TableRow className="bg-muted/50">
                <TableCell colSpan={2} className="text-sm font-semibold py-1.5 pl-4">
                  EFT Clearing
                </TableCell>
              </TableRow>
              {eftClearing.items.map((r) => (
                <TableRow key={r.description}>
                  <TableCell className="text-sm py-1.5 pl-8">{r.description}</TableCell>
                  <TableCell className="text-right py-1.5">
                    <CurrencyDisplay value={r.amount} />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-secondary">
                <TableCell className="text-sm font-semibold py-1.5 pl-4">Total EFT Clearing</TableCell>
                <TableCell className="text-right py-1.5">
                  <CurrencyDisplay value={eftClearing.total} highlight />
                </TableCell>
              </TableRow>

              {/* Easypay (Debtor) */}
              <TableRow>
                <TableCell className="text-sm py-1.5 pl-4">Easypay (Debtor)</TableCell>
                <TableCell className="text-right py-1.5">
                  <CurrencyDisplay value={airtimeBalances.easypayClosing} />
                </TableCell>
              </TableRow>

              {/* Debtors */}
              <TableRow>
                <TableCell className="text-sm py-1.5 pl-4">Debtors</TableCell>
                <TableCell className="text-right py-1.5">
                  <CurrencyDisplay value={debtorsClosing} />
                </TableCell>
              </TableRow>

              {/* Total Current Assets */}
              <TableRow className="bg-primary/10 border-t-2">
                <TableCell className="text-sm font-bold py-2">Total Current Assets</TableCell>
                <TableCell className="text-right py-2">
                  <CurrencyDisplay value={totalCurrentAssets} highlight />
                </TableCell>
              </TableRow>

              {/* Current Liabilities header */}
              <TableRow className="bg-destructive/10">
                <TableCell colSpan={2} className="text-sm font-bold py-2">
                  Current Liabilities
                </TableCell>
              </TableRow>

              {/* Creditors */}
              <TableRow className="bg-muted/50">
                <TableCell colSpan={2} className="text-sm font-semibold py-1.5 pl-4">
                  Creditors
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-sm py-1.5 pl-8">Trade Creditors</TableCell>
                <TableCell className="text-right py-1.5">
                  <CurrencyDisplay value={creditors.tradeTotal} />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-sm py-1.5 pl-8">Fuel Creditors</TableCell>
                <TableCell className="text-right py-1.5">
                  <CurrencyDisplay value={creditors.fuelTotal} />
                </TableCell>
              </TableRow>
              <TableRow className="bg-secondary">
                <TableCell className="text-sm font-semibold py-1.5 pl-4">Total Creditors</TableCell>
                <TableCell className="text-right py-1.5">
                  <CurrencyDisplay value={creditors.tradeTotal + creditors.fuelTotal} highlight />
                </TableCell>
              </TableRow>

              {/* BLD Creditor */}
              <TableRow>
                <TableCell className="text-sm py-1.5 pl-4">BLD Creditor</TableCell>
                <TableCell className="text-right py-1.5">
                  <CurrencyDisplay value={Math.abs(airtimeBalances.bldClosing)} />
                </TableCell>
              </TableRow>

              {/* Total Current Liabilities */}
              <TableRow className="bg-destructive/10 border-t-2">
                <TableCell className="text-sm font-bold py-2">Total Current Liabilities</TableCell>
                <TableCell className="text-right py-2">
                  <CurrencyDisplay value={totalCurrentLiabilities} highlight />
                </TableCell>
              </TableRow>
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold text-sm">Net Assets (Assets − Liabilities)</TableCell>
                <TableCell className="text-right">
                  <CurrencyDisplay value={netBalanceSheet} highlight />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
