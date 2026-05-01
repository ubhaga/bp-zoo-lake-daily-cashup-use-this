import { useState, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { useCashupStore } from "@/store/cashupStore";
import { useMasterDataStore } from "@/store/masterDataStore";
import type { ManagerDailyEntry, InvoiceLine } from "@/types/cashup";
import { Section, DataRow, CurrencyInput, CurrencyDisplay } from "@/components/ui/CashupUI";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Save, AlertCircle, CheckCircle, Lock, ChevronLeft, ChevronRight, ArrowLeftRight } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { format, subDays, addDays, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { extractDayEndInvoiceTotals } from "@/lib/dayEndInvoiceTotals";
import { extractDayEndCreditors } from "@/lib/dayEndCreditors";
import { ManualPumpReadings } from "@/components/manager/ManualPumpReadings";
import { useCommissionSchedules } from "@/hooks/useCommissionSchedules";
import { commissionMatchesDate, describeSchedule } from "@/lib/commissionSchedules";

const DAY_END_INVOICE_CUTOFF = "2026-03-01";

// ---- Recursive chain helper ----
// Walk forward from Jan 1 2026 to compute the TRUE effective closing balance for any date.
// This ensures each day's opening is based on the correctly-derived previous closing,
// regardless of what stale values may have been stored.
interface EffectiveClosing {
  coins: number;
  easypay: number;
  cc: number;
}

function computeEffectiveClosingForDate(
  targetDate: string,
  getEntry: (d: string) => ManagerDailyEntry | undefined,
  getCashup: (d: string) =>
    | {
        shop: {
          coins: number;
          easyPay: number;
          cashDepositedBanking: number;
          deepFrozenCC?: number;
          cashConnectTotal?: number;
        };
      }
    | undefined,
): EffectiveClosing | null {
  const SEED_DATE = "2026-01-01";
  if (targetDate < SEED_DATE) return null;

  // Build ordered list of dates from SEED_DATE to targetDate
  const dates: string[] = [];
  let d = parseISO(SEED_DATE);
  const end = parseISO(targetDate);
  while (d <= end) {
    dates.push(format(d, "yyyy-MM-dd"));
    d = addDays(d, 1);
  }

  // Seed values for Jan 1 2026
  let coinsOpening = 4483.15;
  let easypayOpening = 3500;
  let ccOpening = 2000;

  // Walk forward, computing closing for each day
  for (const date of dates) {
    const entry = getEntry(date);
    const cashup = getCashup(date);

    // Effective opening for this date
    let effCoinsOpen: number;
    let effEasypayOpen: number;
    let effCCOpen: number;

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

// ---- Invoice table: defined OUTSIDE the parent so React never remounts inputs on keystroke ----
interface InvoiceTableProps {
  lines: InvoiceLine[];
  supplierList: string[];
  categories: string[];
  invoiceTotal: number;
  vatTotal: number;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<InvoiceLine>) => void;
  onMove: (id: string) => void;
  moveLabel: string;
}

function InvoiceTable({
  lines,
  supplierList,
  categories,
  invoiceTotal,
  vatTotal,
  onAdd,
  onRemove,
  onUpdate,
  onMove,
  moveLabel,
}: InvoiceTableProps) {
  return (
    <>
      <div className="px-3 py-1 border-b grid grid-cols-12 gap-1 text-xs text-muted-foreground font-semibold bg-muted/30">
        <span className="col-span-3">Supplier</span>
        <span className="col-span-3">Category</span>
        <span className="col-span-2">Doc No.</span>
        <span className="col-span-2 text-right">Incl.</span>
        <span className="col-span-1 text-right">VAT</span>
        <span></span>
      </div>
      {lines.map((l) => {
        const selectableSuppliers = l.supplier && !supplierList.includes(l.supplier) ? [l.supplier, ...supplierList] : supplierList;

        return (
        <div key={l.id} className="px-2 py-1 border-b grid grid-cols-12 gap-1 items-center">
          <div className="col-span-3">
            {l.autoImported ? (
              <div className="input-cell text-[#020508] bg-[#e4ebf2] w-full text-left text-xs py-0.5 bg-muted/30 text-muted-foreground">{l.supplier || "—"}</div>
            ) : (
              <select
                value={l.supplier}
                onChange={(e) => onUpdate(l.id, { supplier: e.target.value })}
                className="input-cell text-[#020508] bg-[#e4ebf2] w-full text-left text-xs py-0.5"
              >
                <option value="">Select...</option>
                {selectableSuppliers.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
            {l.supplier === "Sundry Supplier" && (
              <input
                value={l.vendorName ?? ""}
                onChange={(e) => onUpdate(l.id, { vendorName: e.target.value })}
                placeholder="Vendor name *"
                className="input-cell text-[#020508] bg-amber-50 border border-amber-300 w-full text-left text-xs py-0.5 mt-1"
                disabled={l.autoImported}
              />
            )}
          </div>
          <div className="col-span-3">
            <select
              value={l.category}
              onChange={(e) => onUpdate(l.id, { category: e.target.value })}
              className="input-cell text-[#020508] bg-[#e4ebf2] w-full text-left text-xs py-0.5"
            >
              <option value="">Category...</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            {l.autoImported ? (
              <div className="input-cell text-[#020508] bg-[#e4ebf2] w-full text-xs py-0.5 bg-muted/30 text-muted-foreground">{l.branchDocNum || "—"}</div>
            ) : (
              <input
                value={l.branchDocNum}
                onChange={(e) => onUpdate(l.id, { branchDocNum: e.target.value })}
                className="input-cell text-[#020508] bg-[#e4ebf2] w-full text-xs py-0.5"
                placeholder="Doc#"
              />
            )}
          </div>
          <div className="col-span-2">
            {l.autoImported ? (
              <div className="flex justify-end px-2 py-1 text-xs font-medium text-muted-foreground"><CurrencyDisplay value={l.inclusive} /></div>
            ) : (
              <CurrencyInput value={l.inclusive} onChange={(v) => onUpdate(l.id, { inclusive: v })} className="w-full" />
            )}
          </div>
          <div className="col-span-1">
            {l.autoImported ? (
              <div className="flex justify-end px-2 py-1 text-xs font-medium text-muted-foreground"><CurrencyDisplay value={l.vat} /></div>
            ) : (
              <CurrencyInput value={l.vat} onChange={(v) => onUpdate(l.id, { vat: v })} className="w-full" />
            )}
          </div>
          <div className="flex items-center justify-center gap-1">
            <button onClick={() => onMove(l.id)} className="text-primary p-0.5" title={moveLabel} aria-label={moveLabel}>
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => onRemove(l.id)} className="text-destructive p-0.5" title="Delete invoice" aria-label="Delete invoice">
              <Trash2 className={`h-3.5 w-3.5 ${l.autoImported ? 'opacity-40' : ''}`} />
            </button>
          </div>
        </div>
        );
      })}
      <div className="px-3 py-1.5 flex justify-between items-center">
        <Button variant="outline" size="sm" onClick={onAdd} className="text-xs h-7">
          <Plus className="h-3 w-3 mr-1" />
          Add Invoice
        </Button>
        <div className="flex gap-4 text-sm font-semibold">
          <span>
            Total: <CurrencyDisplay value={invoiceTotal} highlight />
          </span>
          <span>
            VAT: <CurrencyDisplay value={vatTotal} />
          </span>
        </div>
      </div>
    </>
  );
}

const blankEntry = (date: string): Omit<ManagerDailyEntry, "id"> => ({
  date,
  cashupId: "",
  enteredBy: "",
  explanations: "",
  payoutInvoices: [],
  eftInvoices: [],
  coinsOpeningBalance: 0,
  easypayOpeningBalance: 0,
  cashConnectOpeningBalance: 0,
  dailyCoins: 0,
  cashDepositedEasypay: 0,
  cashDepositedCashConnect: 0,
  ccBagClosureCoins: 0,
  ccBagClosureEasypay: 0,
  ccBagClosureCashConnect: 0,
  transferFromCoins: 0,
  branchDayEndTotal: 0,
  branchDayEndVat: 0,
  invoiceNotes: "",
  cashReconcNotes: "",
  bankChargesRate: 0,
  bankCharges: 0,
  banking: 0,
  deepFrozenCC: 0,
  blueLabelComm: 0,
  easypayComm: 0,
  lottoComm: 0,
  lottoNetSalesComm: 0,
  lottoPayoutComm: 0,
  locked: false,
});

interface Props {
  selectedDate: string;
  onDateChange?: (date: string) => void;
}

export function ManagerDailyForm({ selectedDate, onDateChange }: Props) {
  const { getManagerEntryByDate, addManagerEntry, updateManagerEntry, getCashupByDate, managerEntries } =
    useCashupStore();
  const {
    payoutSuppliers: SUPPLIERS,
    eftSuppliers,
    managerNames: MANAGER_NAMES,
    categories: CATEGORIES,
    payoutSupplierCategories,
    eftSupplierCategories,
    cashInTransit,
  } = useMasterDataStore();
  const isDeposita = cashInTransit === 'Deposita';
  const citLabel = isDeposita ? 'Deposita' : 'Cash Connect';
  const existing = getManagerEntryByDate(selectedDate);
  const cashup = getCashupByDate(selectedDate);
  const isLocked = selectedDate < "2026-01-01";
  const creditorsSyncRef = useRef<{ date: string; updatedAt: string } | null>(null);

  const isFirstJan2026 = selectedDate === "2026-01-01";
  const prevDate = format(subDays(new Date(selectedDate + "T00:00:00"), 1), "yyyy-MM-dd");

  // Compute the TRUE prev-day closing by walking the full chain from Jan 1 forward.
  // This ensures no stale stored opening values pollute the chain.
  const prevClosing = computeEffectiveClosingForDate(prevDate, getManagerEntryByDate, getCashupByDate);
  const prevCoinsClosing = prevClosing?.coins ?? 0;
  const prevEasypayClosing = prevClosing?.easypay ?? 0;
  const prevCCClosing = prevClosing?.cc ?? 0;

  // Opening is always derived from prev day's effective closing (unless it's the seed date)
  const usePrevClosingAsOpening = selectedDate >= "2026-01-01" && !isFirstJan2026 && prevClosing !== null;

  const [form, setForm] = useState<Omit<ManagerDailyEntry, "id">>(() => blankEntry(selectedDate));

  // Find prev day's bank charges rate for auto-fill
  const prevEntry = getManagerEntryByDate(prevDate);
  const prevBankChargesRate = prevEntry?.bankChargesRate ?? 37.9;

  useEffect(() => {
    if (existing) {
      setForm({ ...existing });
    } else {
      const base = blankEntry(selectedDate);
      // Auto-fill rate from previous day (or default 37.9)
      base.bankChargesRate = prevBankChargesRate;
      if (isFirstJan2026) {
        base.coinsOpeningBalance = 4483.15;
        base.easypayOpeningBalance = 3500;
        base.cashConnectOpeningBalance = 2000;
        base.ccBagClosureEasypay = 5500;
        base.ccBagClosureCashConnect = 10000;
        base.transferFromCoins = 2000;
      } else if (usePrevClosingAsOpening) {
        base.coinsOpeningBalance = prevCoinsClosing;
        base.easypayOpeningBalance = prevEasypayClosing;
        base.cashConnectOpeningBalance = prevCCClosing;
      }
      setForm(base);
    }
  }, [selectedDate, existing?.id]);

  // Auto-populate payout invoices from cashup
  useEffect(() => {
    if (cashup && !existing) {
      const invoices: InvoiceLine[] = cashup.shop.payouts.map((p) => ({
        id: uuidv4(),
        supplier: p.vendor,
        category: payoutSupplierCategories[p.vendor] ?? "",
        branchDocNum: "",
        inclusive: p.amount,
        vat: p.amount > 0 ? parseFloat(((p.amount * 15) / 115).toFixed(2)) : 0,
      }));
      setForm((f) => ({ ...f, payoutInvoices: invoices, cashupId: cashup.id }));
    }
  }, [cashup?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("day_end_uploads")
        .select("content, updated_at")
        .eq("date", selectedDate)
        .maybeSingle();

      if (cancelled || !data?.content) return;

      const updatedAt = (data as { updated_at: string }).updated_at;
      const last = creditorsSyncRef.current;
      if (last && last.date === selectedDate && last.updatedAt === updatedAt) return;
      creditorsSyncRef.current = { date: selectedDate, updatedAt };

      const imported = extractDayEndCreditors(data.content);
      if (imported.payoutInvoices.length === 0 && imported.eftInvoices.length === 0) return;

      setForm((f) => {
        const manualPayouts = f.payoutInvoices.filter((line) => !line.autoImported);
        const manualEfts = f.eftInvoices.filter((line) => !line.autoImported);

        const withPayoutCat = imported.payoutInvoices.map((line) => ({
          ...line,
          category: line.category || (payoutSupplierCategories[line.supplier] ?? ""),
        }));
        const withEftCat = imported.eftInvoices.map((line) => ({
          ...line,
          category: line.category || (eftSupplierCategories[line.supplier] ?? ""),
        }));

        return {
          ...f,
          payoutInvoices: [...withPayoutCat, ...manualPayouts],
          eftInvoices: [...withEftCat, ...manualEfts],
        };
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  const addInvoice = (type: "payout" | "eft") => {
    const line: InvoiceLine = { id: uuidv4(), supplier: "", category: "", branchDocNum: "", inclusive: 0, vat: 0 };
    if (type === "payout") setForm((f) => ({ ...f, payoutInvoices: [...f.payoutInvoices, line] }));
    else setForm((f) => ({ ...f, eftInvoices: [...f.eftInvoices, line] }));
  };

  const removeInvoice = (id: string, type: "payout" | "eft") => {
    if (type === "payout") setForm((f) => ({ ...f, payoutInvoices: f.payoutInvoices.filter((i) => i.id !== id) }));
    else setForm((f) => ({ ...f, eftInvoices: f.eftInvoices.filter((i) => i.id !== id) }));
  };

  const moveInvoice = (id: string, from: "payout" | "eft") => {
    setForm((f) => {
      if (from === "payout") {
        const invoice = f.payoutInvoices.find((i) => i.id === id);
        if (!invoice) return f;
        return {
          ...f,
          payoutInvoices: f.payoutInvoices.filter((i) => i.id !== id),
          eftInvoices: [...f.eftInvoices, invoice],
        };
      }

      const invoice = f.eftInvoices.find((i) => i.id === id);
      if (!invoice) return f;
      return {
        ...f,
        eftInvoices: f.eftInvoices.filter((i) => i.id !== id),
        payoutInvoices: [...f.payoutInvoices, invoice],
      };
    });
  };

  const updateInvoice = (id: string, patch: Partial<InvoiceLine>, type: "payout" | "eft") => {
    const defaultCatMap = type === "payout" ? payoutSupplierCategories : eftSupplierCategories;
    const update = (lines: InvoiceLine[]) =>
      lines.map((l) => {
        if (l.id !== id) return l;
        const updated = { ...l, ...patch };
        if ("inclusive" in patch && !("vat" in patch)) {
          updated.vat = parseFloat(((updated.inclusive * 15) / 115).toFixed(2));
        }
        // When the supplier changes, auto-fill the default category if one is configured
        // and the user hasn't already chosen a category for this row.
        if ("supplier" in patch && !("category" in patch)) {
          const def = defaultCatMap[updated.supplier];
          if (def && !l.category) {
            updated.category = def;
          }
        }
        return updated;
      });
    if (type === "payout") setForm((f) => ({ ...f, payoutInvoices: update(f.payoutInvoices) }));
    else setForm((f) => ({ ...f, eftInvoices: update(f.eftInvoices) }));
  };

  // Calculations
  const payoutInvoiceTotal = form.payoutInvoices.reduce((s, i) => s + i.inclusive, 0);
  const payoutVatTotal = form.payoutInvoices.reduce((s, i) => s + i.vat, 0);
  const eftInvoiceTotal = form.eftInvoices.reduce((s, i) => s + i.inclusive, 0);
  const eftVatTotal = form.eftInvoices.reduce((s, i) => s + i.vat, 0);
  const totalAllInvoices = payoutInvoiceTotal + eftInvoiceTotal;
  const totalAllVat = payoutVatTotal + eftVatTotal;

  // From 1 March 2026: pull Branch Day End Total/VAT from the uploaded day-end report
  // (EOD Creditors Transactions → "Total for : G.R.N. / TAX INVOICE").
  const useDayEndInvoiceAuto = selectedDate >= DAY_END_INVOICE_CUTOFF;
  const [dayEndInvoiceTotals, setDayEndInvoiceTotals] = useState<{ incl: number; vat: number } | null>(null);
  const [dayEndInvoiceStatus, setDayEndInvoiceStatus] = useState<"idle" | "loading" | "loaded" | "missing">("idle");

  useEffect(() => {
    let cancelled = false;
    if (!useDayEndInvoiceAuto) {
      setDayEndInvoiceTotals(null);
      setDayEndInvoiceStatus("idle");
      return;
    }
    setDayEndInvoiceStatus("loading");
    (async () => {
      const { data } = await supabase
        .from("day_end_uploads")
        .select("content")
        .eq("date", selectedDate)
        .maybeSingle();
      if (cancelled) return;
      const totals = data?.content ? extractDayEndInvoiceTotals(data.content) : null;
      if (totals) {
        setDayEndInvoiceTotals(totals);
        setDayEndInvoiceStatus("loaded");
      } else {
        setDayEndInvoiceTotals(null);
        setDayEndInvoiceStatus("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDate, useDayEndInvoiceAuto]);

  // Sync resolved totals into form so downstream logic + persistence keep working.
  useEffect(() => {
    if (!useDayEndInvoiceAuto) return;
    const incl = dayEndInvoiceTotals?.incl ?? 0;
    const vat = dayEndInvoiceTotals?.vat ?? 0;
    setForm((f) =>
      f.branchDayEndTotal === incl && f.branchDayEndVat === vat
        ? f
        : { ...f, branchDayEndTotal: incl, branchDayEndVat: vat },
    );
  }, [useDayEndInvoiceAuto, dayEndInvoiceTotals?.incl, dayEndInvoiceTotals?.vat]);

  const branchDayEndTotalEffective = useDayEndInvoiceAuto
    ? dayEndInvoiceTotals?.incl ?? 0
    : form.branchDayEndTotal;
  const branchDayEndVatEffective = useDayEndInvoiceAuto
    ? dayEndInvoiceTotals?.vat ?? 0
    : form.branchDayEndVat;

  // Cashier daily NET cash payouts (day end payouts less lotto payouts) — required to match against 1.1 Payout Invoices
  const cashierPayoutsTotal = cashup?.shop.payouts.reduce((s, p) => s + p.amount, 0) ?? 0;
  // Expected Total All Invoices = Cashier payouts + 1.2 EFT invoices total
  const expectedTotalAllInvoices = cashierPayoutsTotal + eftInvoiceTotal;
  const invMatch = Math.abs(totalAllInvoices - expectedTotalAllInvoices) < 0.5;
  const vatMatch = Math.abs(totalAllVat - branchDayEndVatEffective) < 1.0;

  // Daily Cashup pulled directly from Cashier form (read-only)
  // Cash Connect = Cash Connect Total (sum of Banking + EasyPay + Coins) from cashier
  const dailyCashupCoins = cashup?.shop.coins ?? 0;
  const dailyCashupEasypay = cashup?.shop.easyPay ?? 0;
  const dailyCashupCashConnect = cashup?.shop.cashDepositedBanking ?? 0;
  const dailyDeepFrozenCC = form.deepFrozenCC;

  // Opening balances: always use chain-derived prev-day closing (never the stale stored value)
  const effectiveCoinsOpening = usePrevClosingAsOpening ? prevCoinsClosing : form.coinsOpeningBalance;
  const effectiveEasypayOpening = usePrevClosingAsOpening ? prevEasypayClosing : form.easypayOpeningBalance;
  const effectiveCCOpening = usePrevClosingAsOpening ? prevCCClosing : form.cashConnectOpeningBalance;

  // CLOSING = Opening + DailyCashup - CCBagClosure ± Transfer
  const coinsClosing =
    effectiveCoinsOpening + dailyCashupCoins - Math.abs(form.ccBagClosureCoins) - Math.abs(form.transferFromCoins);
  const easypayClosing = effectiveEasypayOpening + dailyCashupEasypay - Math.abs(form.ccBagClosureEasypay);
  const ccClosing =
    effectiveCCOpening +
    dailyCashupCashConnect -
    Math.abs(form.ccBagClosureCashConnect) +
    Math.abs(form.transferFromCoins);

  // 2.1 Banking — derived from CC Bag Closure Cash Connect using configurable rate
  const effectiveRate = form.bankChargesRate || 37.9; // cents per R100 inclusive
  const bankChargesCalc =
    Math.round((Math.abs(form.ccBagClosureCashConnect) / 100) * (effectiveRate / 100) * 100) / 100;
  const bankingCalc = Math.round((Math.abs(form.ccBagClosureCashConnect) - bankChargesCalc) * 100) / 100;

  const openingIsReadOnly = true;

  // Commission day rules
  const { schedules: commissionSchedules } = useCommissionSchedules();
  const showBlueLabelComm = commissionMatchesDate("blue_label", selectedDate, commissionSchedules);
  const showEasypayComm = commissionMatchesDate("easypay", selectedDate, commissionSchedules);
  const showLottoComm = commissionMatchesDate("lotto", selectedDate, commissionSchedules);
  const blueLabelScheduleText = commissionSchedules
    .filter((s) => s.commissionKey === "blue_label")
    .map(describeSchedule)
    .join(" · ");
  const easypayScheduleText = commissionSchedules
    .filter((s) => s.commissionKey === "easypay")
    .map(describeSchedule)
    .join(" · ");
  const lottoScheduleText = commissionSchedules
    .filter((s) => s.commissionKey === "lotto")
    .map(describeSchedule)
    .join(" · ");

  const [savedAt, setSavedAt] = useState<string | null>(null);

  const handleSave = async () => {
    if (isLocked) return;

    // 1. Mandatory: Entered By
    if (!form.enteredBy) {
      toast({
        title: "Missing information",
        description: "Please select who entered this record (Entered By).",
        variant: "destructive",
      });
      return;
    }

    // 2. Invoice line validation — supplier, category, doc no are mandatory if any amount entered
    const incompletePayoutInvoices = form.payoutInvoices.filter(
      (i) => i.inclusive !== 0 && (!i.supplier || !i.category || !i.branchDocNum),
    );
    if (incompletePayoutInvoices.length > 0) {
      toast({
        title: "Incomplete payout invoices",
        description: "Each payout invoice with an amount must have a Supplier, Category and Doc No.",
        variant: "destructive",
      });
      return;
    }
    const sundryMissingVendorPayouts = form.payoutInvoices.some(
      (i) => i.supplier === "Sundry Supplier" && !(i.vendorName ?? "").trim(),
    );
    if (sundryMissingVendorPayouts) {
      toast({
        title: "Vendor name required",
        description: "Sundry Supplier payout invoices must include a Vendor name.",
        variant: "destructive",
      });
      return;
    }
    const hasBlankPayoutLine = form.payoutInvoices.some(
      (i) => i.inclusive === 0 && (!i.supplier || !i.category || !i.branchDocNum),
    );
    if (hasBlankPayoutLine) {
      toast({
        title: "Incomplete payout invoices",
        description: "All payout invoice rows must have a Supplier, Category and Doc No (or remove empty rows).",
        variant: "destructive",
      });
      return;
    }

    const incompleteEftInvoices = form.eftInvoices.filter(
      (i) => i.inclusive !== 0 && (!i.supplier || !i.category || !i.branchDocNum),
    );
    if (incompleteEftInvoices.length > 0) {
      toast({
        title: "Incomplete EFT invoices",
        description: "Each EFT/Non-Cash invoice with an amount must have a Supplier, Category and Doc No.",
        variant: "destructive",
      });
      return;
    }
    const sundryMissingVendorEft = form.eftInvoices.some(
      (i) => i.supplier === "Sundry Supplier" && !(i.vendorName ?? "").trim(),
    );
    if (sundryMissingVendorEft) {
      toast({
        title: "Vendor name required",
        description: "Sundry Supplier EFT/Non-Cash invoices must include a Vendor name.",
        variant: "destructive",
      });
      return;
    }
    const hasBlankEftLine = form.eftInvoices.some(
      (i) => i.inclusive === 0 && (!i.supplier || !i.category || !i.branchDocNum),
    );
    if (hasBlankEftLine) {
      toast({
        title: "Incomplete EFT invoices",
        description: "All EFT/Non-Cash invoice rows must have a Supplier, Category and Doc No (or remove empty rows).",
        variant: "destructive",
      });
      return;
    }

    // 5. Commission validation — mandatory when field is shown
    if (showBlueLabelComm && form.blueLabelComm === 0) {
      toast({
        title: "Missing Blue Label Commission",
        description: `Blue Label Commission is mandatory (${blueLabelScheduleText || "scheduled day"}).`,
        variant: "destructive",
      });
      return;
    }
    if (showEasypayComm && form.easypayComm === 0) {
      toast({
        title: "Missing Easy Pay Commission",
        description: `Easy Pay Commission is mandatory (${easypayScheduleText || "scheduled day"}).`,
        variant: "destructive",
      });
      return;
    }
    if (showLottoComm && form.lottoComm === 0) {
      toast({
        title: "Missing Lotto Commission",
        description: `Lotto Commission is mandatory (${lottoScheduleText || "scheduled day"}).`,
        variant: "destructive",
      });
      return;
    }

    const negativeClosingFields: string[] = [];
    if (coinsClosing < -0.005) negativeClosingFields.push("Coins");
    if (easypayClosing < -0.005) negativeClosingFields.push("Easy Pay");
    if (ccClosing < -0.005) negativeClosingFields.push("Cash Connect");
    if (negativeClosingFields.length > 0) {
      toast({
        title: "Negative closing balance",
        description: `The closing balance for ${negativeClosingFields.join(", ")} is negative. Please correct the figures before saving.`,
        variant: "destructive",
      });
      return;
    }

    const payload: Omit<ManagerDailyEntry, "id"> = {
      ...form,
      coinsOpeningBalance: effectiveCoinsOpening,
      easypayOpeningBalance: effectiveEasypayOpening,
      cashConnectOpeningBalance: effectiveCCOpening,
      bankChargesRate: effectiveRate,
      bankCharges: bankChargesCalc,
      banking: bankingCalc,
    };

    if (existing) await updateManagerEntry(existing.id, payload);
    else await addManagerEntry(payload);

    // Propagate rate change to all subsequent saved entries
    const laterEntries = useCashupStore.getState().managerEntries.filter((e) => e.date > selectedDate);
    let updatedCount = 0;
    for (const entry of laterEntries) {
      if (entry.bankChargesRate !== effectiveRate) {
        const recalcCharges =
          Math.round((Math.abs(entry.ccBagClosureCashConnect) / 100) * (effectiveRate / 100) * 100) / 100;
        const recalcBanking = Math.round((Math.abs(entry.ccBagClosureCashConnect) - recalcCharges) * 100) / 100;
        await updateManagerEntry(entry.id, {
          bankChargesRate: effectiveRate,
          bankCharges: recalcCharges,
          banking: recalcBanking,
        });
        updatedCount++;
      }
    }

    setForm(payload);
    const now = format(new Date(), "dd MMM yyyy HH:mm:ss");
    setSavedAt((prev) => prev ?? now);
    const desc =
      updatedCount > 0
        ? `Saved for ${format(new Date(selectedDate), "dd MMM yyyy")} — rate updated on ${updatedCount} subsequent day(s)`
        : `Saved for ${format(new Date(selectedDate), "dd MMM yyyy")}`;
    toast({ title: "Manager entry saved", description: desc });
  };

  // Cashier short/over calculations — must match CashierDailyForm exactly
  const cashierBlock = cashup
    ? (() => {
        const shopNetSales = cashup.shop.income - cashup.shop.returns - (cashup.shop.returns_today ?? 0);
        const shopPayoutsTotal = cashup.shop.payouts.reduce((s, p) => s + p.amount, 0);
        const shopTotalReceipts = cashup.shop.receipts.reduce((s, r) => s + r.amount, 0);
        const shopTotalTakings = shopNetSales - shopPayoutsTotal - cashup.shop.lottoPayouts + shopTotalReceipts;

        // Must match CashierDailyForm exactly: cashConnectTotal = cashDepositedBanking + easyPay + coins
        const cashConnectTotal = cashup.shop.cashDepositedBanking + cashup.shop.easyPay + cashup.shop.coins;
        const shopSpeedpointTotal = cashup.shop.speedpoints.reduce((s, sp) => s + sp.shopAmount, 0);
        const shopAccountTotal = cashup.shop.accounts.reduce((s, a) => s + a.amount, 0);
        const shopOtherTotal = cashup.shop.otherAdjustments.reduce((s, o) => s + o.amount, 0);
        const shopDiff =
          shopTotalTakings -
          cashConnectTotal -
          shopSpeedpointTotal -
          shopAccountTotal -
          shopOtherTotal -
          cashup.shop.returns_mop -
          (cashup.shop.returnsNotCaptured ?? 0) -
          (cashup.shop.attendantShortOver ?? 0) -
          (cashup.shop.customerToPay ?? 0) -
          (cashup.shop.extraAttendantShortOvers ?? []).reduce((s, r) => s + (r.amount || 0), 0) -
          (cashup.shop.extraCustomerToPays ?? []).reduce((s, r) => s + (r.amount || 0), 0);

        const optNetSales = cashup.opt.income - cashup.opt.returns;
        const optSpeedpointTotal = cashup.opt.speedpoints.reduce((s, sp) => s + sp.optAmount, 0);
        const optAccountTotal = cashup.opt.accounts.reduce((s, a) => s + a.amount, 0);
        const optDiff = optNetSales - optSpeedpointTotal - optAccountTotal;

        return { shopDiff, optDiff };
      })()
    : null;

  const goDay = (offset: number) => {
    if (onDateChange) {
      const d = addDays(parseISO(selectedDate), offset);
      if (d >= parseISO("2026-01-01")) onDateChange(format(d, "yyyy-MM-dd"));
    }
  };

  return (
    <div className="space-y-3">
      {/* Date navigation */}
      {onDateChange && (
        <div className="sticky top-0 z-30 flex items-center justify-between bg-card border rounded-lg px-4 py-2 shadow-sm gap-2">
          <Button variant="ghost" size="sm" onClick={() => goDay(-1)} disabled={selectedDate <= "2026-01-01"}>
            <ChevronLeft className="h-4 w-4" /> Previous Day
          </Button>
          <span className="text-sm font-semibold">{format(parseISO(selectedDate), "EEEE, dd MMMM yyyy")}</span>
          <div className="flex items-center gap-2">
            <Button onClick={handleSave} size="sm" disabled={isLocked}>
              <Save className="h-4 w-4 mr-1" />
              Save Entry
            </Button>
            <Button variant="ghost" size="sm" onClick={() => goDay(1)}>
              Next Day <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      {isLocked && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/40 rounded-lg text-destructive">
          <Lock className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold text-sm">Period Locked — Read Only</p>
            <p className="text-xs opacity-80">
              Dates before 1 January 2026 are locked. No data can be posted or modified.
            </p>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="bg-card border rounded-lg p-3 grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Entered By</label>
          <select
            value={form.enteredBy}
            onChange={(e) => setForm((f) => ({ ...f, enteredBy: e.target.value }))}
            className="input-cell text-[#020508] bg-[#e4ebf2] w-full mt-0.5"
          >
            <option value="">Select manager...</option>
            {MANAGER_NAMES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground">Explanations / Notes</label>
          <input
            value={form.explanations}
            onChange={(e) => setForm((f) => ({ ...f, explanations: e.target.value }))}
            className="input-cell text-[#020508] bg-[#e4ebf2] w-full mt-0.5 text-left"
            placeholder="Any notes for the day..."
          />
        </div>
      </div>

      {!cashup && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          No cashier data found for this date. Enter cashier sheet first to auto-populate payout vendors.
        </div>
      )}

      {/* Cashier Short / Over — at the top */}
      {cashierBlock && (
        <Section title="Cashier Short / (Over) from Cashup" color="default">
          <div className="grid grid-cols-2 gap-2 px-3 py-2">
            <DataRow label="Shop Till">
              <div
                className={`rounded px-2 py-0.5 text-sm font-semibold ${Math.abs(cashierBlock.shopDiff) < 0.01 ? "status-green" : "status-red"}`}
              >
                <CurrencyDisplay value={cashierBlock.shopDiff} />
              </div>
            </DataRow>
            <DataRow label="OPT">
              <div
                className={`rounded px-2 py-0.5 text-sm font-semibold ${Math.abs(cashierBlock.optDiff) < 0.01 ? "status-green" : "status-red"}`}
              >
                <CurrencyDisplay value={cashierBlock.optDiff} />
              </div>
            </DataRow>
          </div>
        </Section>
      )}

      {/* 1.1 Payout Invoices */}
      <Section title="1.1 Payout Invoices (to enter on branch system)" color="red">
        <InvoiceTable
          lines={form.payoutInvoices}
          supplierList={SUPPLIERS}
          categories={CATEGORIES}
          invoiceTotal={payoutInvoiceTotal}
          vatTotal={payoutVatTotal}
          onAdd={() => addInvoice("payout")}
          onRemove={(id) => removeInvoice(id, "payout")}
          onUpdate={(id, patch) => updateInvoice(id, patch, "payout")}
          onMove={(id) => moveInvoice(id, "payout")}
          moveLabel="Move invoice to EFT"
        />
      </Section>

      {/* 1.2 EFT / Non-Cash Invoices */}
      <Section title="1.2 EFT / Non-Cash Invoices" color="blue">
        <InvoiceTable
          lines={form.eftInvoices}
          supplierList={eftSuppliers}
          categories={CATEGORIES}
          invoiceTotal={eftInvoiceTotal}
          vatTotal={eftVatTotal}
          onAdd={() => addInvoice("eft")}
          onRemove={(id) => removeInvoice(id, "eft")}
          onUpdate={(id, patch) => updateInvoice(id, patch, "eft")}
          onMove={(id) => moveInvoice(id, "eft")}
          moveLabel="Move invoice to Payout"
        />
      </Section>

      {/* 1.3 Invoice Reconciliation vs Branch Day End — full width */}
      <Section title="1.3 Invoice Reconciliation vs Branch Day End" color="green">
        <DataRow label="Total Payout Invoices">
          <CurrencyDisplay value={payoutInvoiceTotal} />
        </DataRow>
        <DataRow label="Total EFT Invoices">
          <CurrencyDisplay value={eftInvoiceTotal} />
        </DataRow>
        <DataRow label="TOTAL ALL INVOICES" total>
          <div className="flex items-center justify-end gap-3">
            <CurrencyDisplay value={totalAllInvoices} highlight />
            <div className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs ${invMatch ? "status-green" : "status-red"}`}>
              {invMatch ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {invMatch
                ? "MATCH"
                : `Diff ${new Intl.NumberFormat("en-ZA", { minimumFractionDigits: 2 }).format(Math.abs(totalAllInvoices - expectedTotalAllInvoices))}`}
            </div>
          </div>
        </DataRow>
        <DataRow label="Total VAT" total>
          <div className="flex items-center justify-end gap-3">
            <CurrencyDisplay value={totalAllVat} />
            <div className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs ${vatMatch ? "status-green" : "status-red"}`}>
              {vatMatch ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {vatMatch
                ? "MATCH"
                : `Diff ${new Intl.NumberFormat("en-ZA", { minimumFractionDigits: 2 }).format(Math.abs(totalAllVat - branchDayEndVatEffective))}`}
            </div>
          </div>
        </DataRow>
        <div className="border-t mt-1 pt-1">
          {useDayEndInvoiceAuto && dayEndInvoiceStatus === "missing" && (
            <div className="px-3 py-1.5 text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              No Day End report uploaded for this date — Branch Day End totals default to 0. Upload the day-end .rpt to populate.
            </div>
          )}
          {useDayEndInvoiceAuto && dayEndInvoiceStatus === "loading" && (
            <div className="px-3 py-1.5 text-xs text-muted-foreground">Loading Branch Day End from upload…</div>
          )}
          <div className="border-t mt-1 pt-2 pb-2 px-3">
            <label className="text-xs text-muted-foreground font-medium">Explanations / Notes</label>
            <input
              value={form.invoiceNotes}
              onChange={(e) => setForm((f) => ({ ...f, invoiceNotes: e.target.value }))}
              className="input-cell text-[#020508] bg-[#e4ebf2] w-full mt-0.5 text-left text-sm"
              placeholder="Any notes for section 1.3..."
            />
          </div>
        </div>
      </Section>

      {/* 2. Cash Reconciliation — full width, below 1.3 */}
      <Section title="2. Cash Reconciliation" color="orange">
        <table className="w-full text-sm border-collapse">
          <colgroup>
            <col className="w-[32%]" />
            <col className="w-[17%]" />
            <col className="w-[17%]" />
            <col className="w-[17%]" />
            <col className="w-[17%]" />
          </colgroup>
          <thead>
            <tr className="bg-muted/40 text-xs font-semibold text-muted-foreground border-b">
              <th className="px-3 py-2 text-left font-semibold">DAILY CASH</th>
              <th className="px-3 py-2 text-center font-semibold">Coins</th>
              <th className="px-3 py-2 text-center font-semibold">Easy Pay</th>
              <th className="px-3 py-2 text-center font-semibold">{citLabel}</th>
              <th className="px-3 py-2 text-center font-semibold">TOTAL CC</th>
            </tr>
          </thead>
          <tbody>
            {/* Opening Balance — always read-only, sourced from prev day closing or Jan 1 seed */}
            <tr className="border-b">
              <td className="px-3 py-1.5 text-xs font-medium">
                <span className="flex items-center gap-1">
                  OPENING BALANCE <Lock className="h-3 w-3 text-muted-foreground" />
                  {usePrevClosingAsOpening && (
                    <span className="text-[10px] text-muted-foreground font-normal ml-1">(prev day closing)</span>
                  )}
                </span>
              </td>
              <td className="px-3 py-1.5">
                <div className="input-cell text-[#020508] bg-[#e4ebf2] w-full text-right bg-muted/30 text-xs py-0.5 px-1 rounded">
                  <CurrencyDisplay value={effectiveCoinsOpening} />
                </div>
              </td>
              <td className="px-3 py-1.5">
                <div className="input-cell text-[#020508] bg-[#e4ebf2] w-full text-right bg-muted/30 text-xs py-0.5 px-1 rounded">
                  <CurrencyDisplay value={effectiveEasypayOpening} />
                </div>
              </td>
              <td className="px-3 py-1.5">
                <div className="input-cell text-[#020508] bg-[#e4ebf2] w-full text-right bg-muted/30 text-xs py-0.5 px-1 rounded">
                  <CurrencyDisplay value={effectiveCCOpening} />
                </div>
              </td>
              <td className="px-3 py-1.5">
                <div className="input-cell text-[#020508] bg-[#e4ebf2] w-full text-right bg-muted/30 text-xs py-0.5 px-1 rounded font-semibold">
                  <CurrencyDisplay value={effectiveEasypayOpening + effectiveCCOpening} />
                </div>
              </td>
            </tr>

            {/* Daily Cashup — auto-populated from Cashier form, read-only */}
            <tr className="border-b bg-muted/10">
              <td className="px-3 py-1.5 text-xs text-muted-foreground">
                Daily Cashup (from Cashier Shift)
                <Lock className="h-3 w-3 text-muted-foreground inline ml-1" />
              </td>
              <td className="px-3 py-1.5">
                <div className="input-cell text-[#020508] bg-[#e4ebf2] w-full text-right bg-muted/30 text-xs py-0.5 px-1 rounded">
                  <CurrencyDisplay value={dailyCashupCoins} />
                </div>
              </td>
              <td className="px-3 py-1.5">
                <div className="input-cell text-[#020508] bg-[#e4ebf2] w-full text-right bg-muted/30 text-xs py-0.5 px-1 rounded">
                  <CurrencyDisplay value={dailyCashupEasypay} />
                </div>
              </td>
              <td className="px-3 py-1.5">
                <div className="input-cell text-[#020508] bg-[#e4ebf2] w-full text-right bg-muted/30 text-xs py-0.5 px-1 rounded">
                  <CurrencyDisplay value={dailyCashupCashConnect} />
                </div>
              </td>
              <td className="px-3 py-1.5">
                <div className="input-cell text-[#020508] bg-[#e4ebf2] w-full text-right bg-muted/30 text-xs py-0.5 px-1 rounded font-semibold">
                  <CurrencyDisplay value={dailyCashupEasypay + dailyCashupCashConnect + dailyCashupCoins} />
                </div>
              </td>
            </tr>

            {/* CC Bag Closure */}
            <tr className="border-b">
              <td className="px-3 py-1.5 text-xs text-muted-foreground">
                CC Bag Closure BAG no. <span className="text-destructive font-bold">(-ve)</span>
              </td>
              <td className="px-3 py-1.5 text-center text-xs text-muted-foreground align-middle">—</td>
              <td className="px-3 py-1.5">
                <CurrencyInput
                  value={form.ccBagClosureEasypay}
                  onChange={(v) => setForm((f) => ({ ...f, ccBagClosureEasypay: Math.abs(v) }))}
                  className="w-full"
                  placeholder="0.00"
                />
                <div className="text-xs text-destructive text-right mt-0.5">
                  <CurrencyDisplay value={-Math.abs(form.ccBagClosureEasypay)} />
                </div>
              </td>
              <td className="px-3 py-1.5">
                <CurrencyInput
                  value={form.ccBagClosureCashConnect}
                  onChange={(v) => setForm((f) => ({ ...f, ccBagClosureCashConnect: Math.abs(v) }))}
                  className="w-full"
                  placeholder="0.00"
                />
                <div className="text-xs text-destructive text-right mt-0.5">
                  <CurrencyDisplay value={-Math.abs(form.ccBagClosureCashConnect)} />
                </div>
              </td>
              <td className="px-3 py-1.5 text-right align-top pt-2 text-destructive font-semibold">
                <CurrencyDisplay value={-Math.abs(form.ccBagClosureEasypay) - Math.abs(form.ccBagClosureCashConnect)} />
              </td>
            </tr>

            {/* Transfer from Coins */}
            <tr className="border-b">
              <td className="px-3 py-1.5 text-xs text-muted-foreground">Transfer from Coin</td>
              <td className="px-3 py-1.5">
                <CurrencyInput
                  value={form.transferFromCoins}
                  onChange={(v) => setForm((f) => ({ ...f, transferFromCoins: Math.abs(v) }))}
                  className="w-full"
                  placeholder="0.00"
                />
                <div className="text-xs text-destructive text-right mt-0.5">
                  <CurrencyDisplay value={-Math.abs(form.transferFromCoins)} />
                </div>
              </td>
              <td className="px-3 py-1.5 text-center text-xs text-muted-foreground align-middle">—</td>
              <td className="px-3 py-1.5 align-middle">
                <div className="input-cell text-[#020508] bg-[#e4ebf2] w-full text-right bg-muted/30 text-xs py-0.5 px-1 rounded text-green-700 font-semibold">
                  <CurrencyDisplay value={Math.abs(form.transferFromCoins)} />
                </div>
              </td>
              <td className="px-3 py-1.5 text-center text-xs text-muted-foreground align-middle">—</td>
            </tr>

            {/* Closing Balance */}
            <tr className="bg-secondary font-semibold border-t-2">
              <td className="px-3 py-2 font-bold text-xs uppercase">CLOSING BALANCE</td>
              <td className="px-3 py-2 text-right">
                <CurrencyDisplay value={coinsClosing} highlight />
              </td>
              <td className="px-3 py-2 text-right">
                <CurrencyDisplay value={easypayClosing} highlight />
              </td>
              <td className="px-3 py-2 text-right">
                <CurrencyDisplay value={ccClosing} highlight />
              </td>
              <td className="px-3 py-2 text-right">
                <CurrencyDisplay value={easypayClosing + ccClosing} highlight />
              </td>
            </tr>

            {/* Deep Frozen paid in CC — editable, after closing balance, Easy Pay + Total columns */}
            <tr className="border-t bg-muted/20">
              <td className="px-3 py-1.5 text-xs text-muted-foreground">Deep Frozen paid in CC</td>
              <td className="px-3 py-1.5 text-center text-xs text-muted-foreground align-middle">—</td>
              <td className="px-3 py-1.5">
                <CurrencyInput
                  value={form.deepFrozenCC}
                  onChange={(v) => setForm((f) => ({ ...f, deepFrozenCC: Math.abs(v) }))}
                  className="w-full"
                  placeholder="0.00"
                />
              </td>
              <td className="px-3 py-1.5 text-center text-xs text-muted-foreground align-middle">—</td>
              <td className="px-3 py-1.5 text-right font-semibold">
                <CurrencyDisplay value={Math.abs(form.deepFrozenCC)} />
              </td>
            </tr>
          </tbody>
        </table>
        <div className="border-t pt-2 pb-2 px-3">
          <label className="text-xs text-muted-foreground font-medium">Explanations / Notes</label>
          <input
            value={form.cashReconcNotes}
            onChange={(e) => setForm((f) => ({ ...f, cashReconcNotes: e.target.value }))}
            className="input-cell text-[#020508] bg-[#e4ebf2] w-full mt-0.5 text-left text-sm"
            placeholder="Any notes for section 2..."
          />
        </div>
      </Section>

      {/* 2.1 Banking — full width, below 2 (hidden when CIT = Deposita) */}
      {!isDeposita && (
        <Section title="2.1 Banking" color="blue">
          <DataRow label="Charges cents per R100 (incl)">
            <CurrencyInput
              value={form.bankChargesRate}
              onChange={(v) => setForm((f) => ({ ...f, bankChargesRate: v }))}
              className="w-[120px]"
              placeholder="37.9000"
              decimals={4}
            />
          </DataRow>
          <DataRow label="Bank Charges">
            <div className="input-cell text-[#020508] bg-[#e4ebf2] text-right bg-muted/30 text-sm px-2 py-1 rounded min-w-[120px]">
              <CurrencyDisplay value={bankChargesCalc} />
            </div>
          </DataRow>
          <DataRow label="Banking (net deposited)">
            <div className="input-cell text-[#020508] bg-[#e4ebf2] text-right bg-muted/30 text-sm px-2 py-1 rounded min-w-[120px]">
              <CurrencyDisplay value={bankingCalc} />
            </div>
          </DataRow>
        </Section>
      )}
      <ManualPumpReadings selectedDate={selectedDate} />

      {/* 3. Airtime / Lotto Commissions — only shown when relevant fields are active */}
      {(showBlueLabelComm || showEasypayComm || showLottoComm) && (
        <Section title="3. Airtime / Lotto Commissions" color="green">
          {showBlueLabelComm && (
            <DataRow label={`3.1 Blue Label Commission${blueLabelScheduleText ? ` (${blueLabelScheduleText})` : ""}`}>
              <CurrencyInput
                value={form.blueLabelComm}
                onChange={(v) => setForm((f) => ({ ...f, blueLabelComm: v }))}
                className="w-[160px]"
                allowNegative
              />
            </DataRow>
          )}
          {showEasypayComm && (
            <DataRow label={`3.2 Easy Pay Commission${easypayScheduleText ? ` (${easypayScheduleText})` : ""}`}>
              <CurrencyInput
                value={form.easypayComm}
                onChange={(v) => setForm((f) => ({ ...f, easypayComm: v }))}
                className="w-[160px]"
                allowNegative
              />
            </DataRow>
          )}
          {showLottoComm && (
            <>
              <DataRow label={`3.3 Total Sales Comm${lottoScheduleText ? ` (${lottoScheduleText})` : ""}`}>
                <CurrencyInput
                  value={form.lottoNetSalesComm}
                  onChange={(v) => setForm((f) => ({ ...f, lottoNetSalesComm: v, lottoComm: v + f.lottoPayoutComm }))}
                  className="w-[160px]"
                  allowNegative
                />
              </DataRow>
              <DataRow label={`3.3 Total Payout Comm${lottoScheduleText ? ` (${lottoScheduleText})` : ""}`}>
                <CurrencyInput
                  value={form.lottoPayoutComm}
                  onChange={(v) => setForm((f) => ({ ...f, lottoPayoutComm: v, lottoComm: f.lottoNetSalesComm + v }))}
                  className="w-[160px]"
                  allowNegative
                />
              </DataRow>
              <DataRow label="3.3 Lotto Commission Total">
                <CurrencyDisplay value={form.lottoComm} />
              </DataRow>
            </>
          )}
        </Section>
      )}

      {/* Save button + nav at bottom */}
      <div className="flex items-center justify-between gap-2 pt-2 pb-4">
        {onDateChange ? (
          <Button variant="ghost" size="sm" onClick={() => goDay(-1)} disabled={selectedDate <= "2026-01-01"}>
            <ChevronLeft className="h-4 w-4" /> Previous Day
          </Button>
        ) : (
          <div />
        )}
        <div className="flex flex-col items-center gap-1">
          <Button onClick={handleSave} size="lg" className="w-full max-w-xs" disabled={isLocked}>
            <Save className="h-4 w-4 mr-2" />
            Save Entry
          </Button>
          {savedAt && (
            <p className="text-xs text-muted-foreground">
              Originally saved: <span className="font-medium">{savedAt}</span>
            </p>
          )}
        </div>
        {onDateChange ? (
          <Button variant="ghost" size="sm" onClick={() => goDay(1)}>
            Next Day <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}
