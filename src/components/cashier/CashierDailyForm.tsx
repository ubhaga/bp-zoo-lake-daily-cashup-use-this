import { useState, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { useCashupStore } from "@/store/cashupStore";
import { RECEIPT_TYPES } from "@/data/masterData";
import { useMasterDataStore } from "@/store/masterDataStore";
import type {
  DailyCashup,
  PayoutLine,
  ReceiptLine,
  SpeedpointEntry,
  AccountEntry,
  OtherAdjustment,
  NamedAdjustment,
} from "@/types/cashup";
import { Section, DataRow, CurrencyInput, CurrencyDisplay } from "@/components/ui/CashupUI";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, Save, CheckCircle, AlertCircle, Lock, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { format, addDays, subDays, parseISO } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { extractDayEndPayouts } from "@/lib/dayEndPayouts";
import { extractCashierDailyAutofill } from "@/lib/dayEndPayouts";
import { extractDayEndDebtors } from "@/lib/dayEndDebtors";
import {
  isNetAccContent,
  extractNetAccDebtors,
  extractNetAccBpRewards,
  extractNetAccSalesTotal,
  extractNetAccSafeDepositsTotal,
  extractNetAccShiftNumber,
  extractNetAccCashierName,
} from "@/lib/dayEndNetAcc";

const DAY_END_PAYOUTS_CUTOFF = "2026-03-01";
const DAY_END_PAYOUT_VENDOR = "Day End Payouts";

const normalizeCashierName = (value: string) => value.replace(/\s+/g, "").toUpperCase();

const resolveCashierName = (rawName: string | null, names: string[]) => {
  if (!rawName) return "";
  const target = normalizeCashierName(rawName);
  const prefix = target.slice(0, 6);

  return (
    names.find((name) => normalizeCashierName(name) === target) ??
    names.find((name) => normalizeCashierName(name).startsWith(prefix)) ??
    names.find((name) => prefix.startsWith(normalizeCashierName(name).slice(0, 6))) ??
    ""
  );
};

const blankShopShift = (terminals: string[]): DailyCashup["shop"] => ({
  income: 0,
  returns: 0,
  returns_today: 0,
  payouts: [],
  lottoPayouts: 0,
  receipts: RECEIPT_TYPES.map((type) => ({ id: uuidv4(), type, seqNo: "", amount: 0 })),
  cashConnectTotal: 0,
  cashDepositedBanking: 0,
  easyPay: 0,
  deepFrozenCC: 0,
  coins: 0,
  speedpoints: terminals.map((terminal) => ({ terminal, batchNo: "", shopAmount: 0, optAmount: 0 })),
  accounts: [],
  otherAdjustments: [],
  returns_mop: 0,
  returnsNotCaptured: 0,
  attendantShortOver: 0,
  attendantName: '',
  customerToPay: 0,
  customerName: '',
  extraAttendantShortOvers: [],
  extraCustomerToPays: [],
});

const blankOptShift = (terminals: string[]): DailyCashup["opt"] => ({
  income: 0,
  returns: 0,
  returns_today: 0,
  speedpoints: terminals.map((terminal) => ({ terminal, batchNo: "", shopAmount: 0, optAmount: 0 })),
  accounts: [],
});

interface Props {
  selectedDate: string;
  onDateChange?: (date: string) => void;
}

// Header row for two-column sections
function ColHeader({ left, right }: { left: string; right: string }) {
  return (
    <div className="grid grid-cols-2 border-b">
      <div className="px-3 py-1.5 text-xs font-bold text-white bg-primary/80 border-r">{left}</div>
      <div className="px-3 py-1.5 text-xs font-bold text-white bg-primary/60">{right}</div>
    </div>
  );
}

export function CashierDailyForm({ selectedDate, onDateChange }: Props) {
  const { getCashupByDate, addCashup, updateCashup } = useCashupStore();
  const { payoutSuppliers, accounts: ACCOUNTS, cashierNames: CASHIER_NAMES, speedpointTerminals } = useMasterDataStore();
  const addCashierName = useMasterDataStore(s => s.addCashierName);
  const siteSystem = useMasterDataStore(s => s.siteSystem);
  const isNetAccSite = siteSystem === 'NetAcc';
  const SUPPLIERS = payoutSuppliers;
  const existing = getCashupByDate(selectedDate);
  const isLocked = selectedDate < "2026-01-01";

  const shopTerminalNames = speedpointTerminals
    .filter(t => t.shift === 'shop' || t.shift === 'both')
    .map(t => t.name);
  const optTerminalNames = speedpointTerminals
    .filter(t => t.shift === 'opt' || t.shift === 'both')
    .map(t => t.name);

  const [form, setForm] = useState<Omit<DailyCashup, "id">>(() => ({
    date: selectedDate,
    month: selectedDate.slice(0, 7),
    enteredBy: "",
    shopShiftNumber: 0,
    optShiftNumber: 0,
    cashierName: "",
    shop: blankShopShift(shopTerminalNames),
    opt: blankOptShift(optTerminalNames),
    notes: "",
    locked: false,
  }));

  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [overConfirmOpen, setOverConfirmOpen] = useState(false);

  /** Whether the second (OPT-style) shift is shown.
   *  Branch sites: always shown.
   *  NetAcc sites: hidden by default; user opts in via the "Add second shift" tab.
   *  If an existing record already has OPT data we keep it visible so users can edit. */
  const hasExistingOptData =
    !!existing &&
    (existing.optShiftNumber > 0 ||
      existing.opt.income !== 0 ||
      existing.opt.speedpoints.some((s) => s.optAmount !== 0) ||
      (existing.opt.accounts ?? []).some((a) => a.amount !== 0));
  const [showSecondShift, setShowSecondShift] = useState<boolean>(
    !isNetAccSite || hasExistingOptData,
  );
  // Re-evaluate default when navigating between dates / records
  useEffect(() => {
    setShowSecondShift(!isNetAccSite || hasExistingOptData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, existing?.id, isNetAccSite]);

  useEffect(() => {
    if (existing) {
      // Merge existing cashup with any newly-added terminals so they appear
      // in the form even if absent from the saved record.
      const mergeTerminals = (
        existingSp: SpeedpointEntry[],
        wantedNames: string[]
      ): SpeedpointEntry[] => {
        const byName = new Map(existingSp.map(sp => [sp.terminal, sp]));
        const merged = wantedNames.map(name =>
          byName.get(name) ?? { terminal: name, batchNo: "", shopAmount: 0, optAmount: 0 }
        );
        // Preserve any historical terminals that no longer exist in master data
        // so old data doesn't disappear silently.
        existingSp.forEach(sp => {
          if (!wantedNames.includes(sp.terminal)) merged.push(sp);
        });
        return merged;
      };
      setForm({
        ...existing,
        shop: { ...existing.shop, speedpoints: mergeTerminals(existing.shop.speedpoints, shopTerminalNames) },
        opt: { ...existing.opt, speedpoints: mergeTerminals(existing.opt.speedpoints, optTerminalNames) },
      });
    } else {
      const shopBase = blankShopShift(shopTerminalNames);
      // Seed Jan 1 2026 MOP Cash from spreadsheet (Daily Cashup row)
      if (selectedDate === "2026-01-01") {
        shopBase.coins = 54;
        shopBase.easyPay = 2000;
        shopBase.cashDepositedBanking = 13110;
        shopBase.cashConnectTotal = 54 + 2000 + 13110; // 15164
      }
      setForm((f) => ({
        ...f,
        date: selectedDate,
        month: selectedDate.slice(0, 7),
        shop: shopBase,
        opt: blankOptShift(optTerminalNames),
      }));
    }
    setSavedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, existing?.id, speedpointTerminals.length]);

  const setShop = (patch: Partial<typeof form.shop>) => setForm((f) => ({ ...f, shop: { ...f.shop, ...patch } }));
  const setOpt = (patch: Partial<typeof form.opt>) => setForm((f) => ({ ...f, opt: { ...f.opt, ...patch } }));

  // From 1 March 2026 onwards, the uploaded day end report provides the gross
  // payouts total. Section 2 uses NET cash payouts = gross day end payouts less
  // lotto payouts, and that net value is what downstream manager invoice linking uses.
  const useDayEndPayouts = selectedDate >= DAY_END_PAYOUTS_CUTOFF;
  const [dayEndPayoutsAmount, setDayEndPayoutsAmount] = useState<number | null>(null);
  const [dayEndStatus, setDayEndStatus] = useState<"idle" | "loading" | "loaded" | "missing">("idle");

  useEffect(() => {
    if (!useDayEndPayouts) {
      setDayEndPayoutsAmount(null);
      setDayEndStatus("idle");
      return;
    }
    let cancelled = false;
    setDayEndStatus("loading");
    (async () => {
      const { data } = await supabase
        .from("day_end_uploads")
        .select("content")
        .eq("date", selectedDate)
        .maybeSingle();
      if (cancelled) return;
      const amt = data?.content ? extractDayEndPayouts(data.content) : null;
      setDayEndPayoutsAmount(amt);
      setDayEndStatus(amt != null ? "loaded" : "missing");
    })();
    return () => { cancelled = true; };
  }, [selectedDate, useDayEndPayouts]);

  const netDayEndPayoutsAmount = Math.round((((dayEndPayoutsAmount ?? 0) - (form.shop.lottoPayouts ?? 0)) + Number.EPSILON) * 100) / 100;

  // Sync the synthetic NET payout line into form.shop.payouts so all downstream
  // calculations (recons, AFS, manager invoices) use day end payouts less lotto payouts.
  useEffect(() => {
    if (!useDayEndPayouts) return;
    const target = netDayEndPayoutsAmount;
    const current = form.shop.payouts;
    const onlyDayEnd =
      current.length === 1 &&
      current[0].vendor === DAY_END_PAYOUT_VENDOR &&
      Math.abs(current[0].amount - target) < 0.005;
    if (onlyDayEnd && current.length === 1) return;
    setForm((f) => ({
      ...f,
      shop: {
        ...f.shop,
        payouts: [{ id: "day-end-payouts", vendor: DAY_END_PAYOUT_VENDOR, amount: target }],
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useDayEndPayouts, netDayEndPayoutsAmount, selectedDate]);

  // From 1 April 2026 onwards: auto-populate Section 7 (MOP Account / Debtors)
  // from the uploaded day-end report's "EOD Debtors Transactions" section.
  // Lines remain editable; re-uploading the .rpt re-syncs them.
  // Unknown account names are added to Master Data automatically.
  const addAccountToMaster = useMasterDataStore(s => s.addAccount);
  const masterAccounts = useMasterDataStore(s => s.accounts);
  const cashierAutofillSyncRef = useRef<{ date: string; updatedAt: string } | null>(null);
  // Track the upload's updated_at so we re-sync only when the report changes.
  const lastSyncedRef = useRef<{ date: string; updatedAt: string } | null>(null);

  // Validation badge: NetAcc Manual Safe Deposits TOTAL shown next to Cash Connect Total (sum)
  const [netAccSafeDepositsTotal, setNetAccSafeDepositsTotal] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("day_end_uploads")
        .select("content, updated_at")
        .eq("date", selectedDate)
        .maybeSingle();
      if (cancelled || !data?.content) {
        if (!cancelled) setNetAccSafeDepositsTotal(null);
        return;
      }

      const updatedAt = (data as { updated_at: string }).updated_at;
      const last = cashierAutofillSyncRef.current;
      const alreadySynced =
        last && last.date === selectedDate && last.updatedAt === updatedAt;

      const isNetAcc = isNetAccContent(data.content);

      // Refresh safe-deposit badge whenever content changes (cheap)
      setNetAccSafeDepositsTotal(isNetAcc ? extractNetAccSafeDepositsTotal(data.content) : null);

      if (alreadySynced) return;
      cashierAutofillSyncRef.current = { date: selectedDate, updatedAt };

      const previousCashup = getCashupByDate(format(subDays(parseISO(selectedDate), 1), "yyyy-MM-dd"));
      const previousReturns = Math.abs(previousCashup?.shop.returnsNotCaptured ?? 0);

      if (isNetAcc) {
        // NetAcc: single combined file populates Shop Till income only.
        // OPT shift is entered manually.
        const salesTotal = extractNetAccSalesTotal(data.content);
        const bpRewards = extractNetAccBpRewards(data.content);
        const shiftNo = extractNetAccShiftNumber(data.content);
        const rawCashier = extractNetAccCashierName(data.content);

        // Resolve cashier against master list; auto-add if new.
        let resolvedCashier = "";
        if (rawCashier) {
          resolvedCashier = resolveCashierName(rawCashier, CASHIER_NAMES);
          if (!resolvedCashier) {
            const exists = CASHIER_NAMES.some(
              (n) => n.toLowerCase() === rawCashier.toLowerCase()
            );
            if (!exists) addCashierName(rawCashier);
            resolvedCashier = rawCashier;
          }
        }

        setForm((f) => {
          const shopSpeedpoints = f.shop.speedpoints.map((sp) => {
            if (bpRewards && sp.terminal.toLowerCase() === 'redeem') {
              return { ...sp, batchNo: bpRewards.batch, shopAmount: bpRewards.amount };
            }
            return sp;
          });
          return {
            ...f,
            cashierName: resolvedCashier || f.cashierName,
            shopShiftNumber: shiftNo ?? f.shopShiftNumber,
            shop: {
              ...f.shop,
              income: salesTotal ?? f.shop.income,
              returns: previousReturns,
              returns_mop: previousReturns > 0 ? -previousReturns : f.shop.returns_mop,
              speedpoints: shopSpeedpoints,
            },
          };
        });
        return;
      }


      // Branch (.rpt) flow — original autofill
      const autofill = extractCashierDailyAutofill(data.content);
      if (!autofill) return;
      const matchedCashier = resolveCashierName(autofill.cashierName, CASHIER_NAMES);

      setForm((f) => ({
        ...f,
        cashierName: matchedCashier || f.cashierName,
        shop: {
          ...f.shop,
          income: autofill.shopIncome ?? f.shop.income,
          returns: previousReturns,
          returns_today: autofill.shopReturnsToday ?? f.shop.returns_today,
          returns_mop: previousReturns > 0 ? -previousReturns : f.shop.returns_mop,
        },
        opt: {
          ...f.opt,
          income: autofill.optIncome ?? f.opt.income,
        },
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDate, CASHIER_NAMES, getCashupByDate, addCashierName]);

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
      const last = lastSyncedRef.current;
      // Skip if we've already synced this exact upload version for this date
      if (last && last.date === selectedDate && last.updatedAt === updatedAt) return;
      lastSyncedRef.current = { date: selectedDate, updatedAt };

      // Format-aware debtors extraction. NetAcc returns one row per invoice
      // (same Account Holder may appear multiple times); Branch returns rows
      // from the EOD Debtors Transactions block.
      const debtors = isNetAccContent(data.content)
        ? extractNetAccDebtors(data.content).map(d => ({ accountName: d.accountName, amount: d.amount }))
        : extractDayEndDebtors(data.content);
      if (debtors.length === 0) return;

      // Auto-add any new account names to Master Data (case-insensitive check)
      const known = new Set(masterAccounts.map(a => a.toLowerCase()));
      debtors.forEach(d => {
        if (!known.has(d.accountName.toLowerCase())) {
          addAccountToMaster(d.accountName);
          known.add(d.accountName.toLowerCase());
        }
      });

      // Replace Section 7 entries with the parsed debtors
      setForm(f => ({
        ...f,
        shop: {
          ...f.shop,
          accounts: debtors.map(d => ({
            id: uuidv4(),
            name: d.accountName,
            amount: d.amount,
          })),
        },
      }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, existing?.id]);
  // ---- CALCULATIONS ----
  const shopPayoutsTotal = form.shop.payouts.reduce((s, p) => s + p.amount, 0);
  const shopNetSales = form.shop.income - form.shop.returns - form.shop.returns_today;
  const shopTotalReceipts = form.shop.receipts.reduce((s, r) => s + r.amount, 0);
  const shopTotalTakings = shopNetSales - shopPayoutsTotal - form.shop.lottoPayouts + shopTotalReceipts;

  const optNetSales = form.opt.income - form.opt.returns;
  // OPT Total Takings = Net Sales only (no payouts/receipts for OPT)
  const optTotalTakings = optNetSales;

  const combinedTotalTakings = shopTotalTakings + optTotalTakings;

  const shopSpeedpointTotal = form.shop.speedpoints.reduce((s, sp) => s + sp.shopAmount, 0);
  const optSpeedpointTotal = form.opt.speedpoints.reduce((s, sp) => s + sp.optAmount, 0);

  const shopAccountTotal = form.shop.accounts.reduce((s, a) => s + a.amount, 0);
  const optAccountTotal = form.opt.accounts.reduce((s, a) => s + a.amount, 0);

  const shopOtherTotal = form.shop.otherAdjustments.reduce((s, o) => s + o.amount, 0);
  const customerToPay = form.shop.customerToPay ?? 0;
  const extraAttendantTotal = (form.shop.extraAttendantShortOvers ?? []).reduce((s, r) => s + (r.amount || 0), 0);
  const extraCustomerTotal = (form.shop.extraCustomerToPays ?? []).reduce((s, r) => s + (r.amount || 0), 0);
  const shopSection8Total =
    shopOtherTotal +
    form.shop.returns_mop +
    form.shop.returnsNotCaptured +
    form.shop.attendantShortOver +
    customerToPay +
    extraAttendantTotal +
    extraCustomerTotal;

  const cashConnectTotal = form.shop.cashDepositedBanking + form.shop.easyPay + form.shop.coins;

  // Shop balance = Shop Takings - MOP Cash - Shop Speedpoints - Shop Accounts - Other adjustments
  const shopDifference =
    shopTotalTakings -
    cashConnectTotal -
    shopSpeedpointTotal -
    shopAccountTotal -
    shopOtherTotal -
    form.shop.returns_mop -
    form.shop.returnsNotCaptured -
    form.shop.attendantShortOver -
    customerToPay -
    extraAttendantTotal -
    extraCustomerTotal;
  // OPT balance = OPT Takings - OPT Speedpoints - OPT Accounts
  const optDifference = optTotalTakings - optSpeedpointTotal - optAccountTotal;

  const commitSave = () => {
    // When the second shift is hidden (NetAcc by default) we exclude OPT data
    // from the saved record by replacing it with a blank shift and zero shift #.
    const toSave = showSecondShift
      ? form
      : { ...form, optShiftNumber: 0, opt: blankOptShift(optTerminalNames) };
    if (existing) updateCashup(existing.id, toSave);
    else addCashup(toSave);
    const now = format(new Date(), "dd MMM yyyy, HH:mm:ss");
    setSavedAt((prev) => prev ?? now);
    toast({ title: "Cashup saved", description: `Saved for ${format(new Date(selectedDate), "dd MMM yyyy")}` });
  };

  const handleSave = () => {
    if (isLocked) return;

    // --- Mandatory header fields ---
    const missing: string[] = [];
    if (!form.enteredBy.trim()) missing.push("Entered By");
    if (!form.cashierName.trim()) missing.push("Cashier");
    if (!form.shopShiftNumber) missing.push("Shop Shift #");
    if (showSecondShift && !form.optShiftNumber) missing.push("OPT Shift #");
    if (!form.shop.income && (!showSecondShift || !form.opt.income)) missing.push("Income (Gross Sales) — at least one shift required");

    if (missing.length > 0) {
      toast({
        title: "Missing required fields",
        description: `Please fill in: ${missing.join(", ")}`,
        variant: "destructive",
      });
      return;
    }

    // --- Receipts: seq# mandatory if amount entered (debtor mandatory for ROA) ---
    const roaType = "Debtors Received on Account ROA";
    const receiptsWithoutSeq = form.shop.receipts.filter(
      (r) => r.amount !== 0 && r.type !== roaType && !r.seqNo.trim()
    );
    const roaWithoutDebtor = form.shop.receipts.filter(
      (r) => r.amount !== 0 && r.type === roaType && !r.seqNo.trim()
    );
    if (receiptsWithoutSeq.length > 0) {
      const types = receiptsWithoutSeq.map((r) => r.type).join(", ");
      toast({
        title: "Receipt Seq No. required",
        description: `Please enter a Seq No. for: ${types}`,
        variant: "destructive",
      });
      return;
    }
    if (roaWithoutDebtor.length > 0) {
      toast({
        title: "Debtor required",
        description: `Please select a Debtor for: ${roaType}`,
        variant: "destructive",
      });
      return;
    }

    // --- Speedpoints: batch# mandatory if amount entered ---
    const shopSpBad = form.shop.speedpoints.filter((s) => s.shopAmount !== 0 && !s.batchNo.trim());
    const optSpBad = showSecondShift
      ? form.opt.speedpoints.filter((s) => s.optAmount !== 0 && !s.batchNo.trim())
      : [];
    const allSpBad = [...shopSpBad.map((s) => `Shop — ${s.terminal}`), ...optSpBad.map((s) => `OPT — ${s.terminal}`)];
    if (allSpBad.length > 0) {
      toast({
        title: "Speedpoint Batch # required",
        description: `Please enter a Batch # for: ${allSpBad.join(", ")}`,
        variant: "destructive",
      });
      return;
    }
    // --- Attendant name mandatory if short/over is non-zero ---
    if (form.shop.attendantShortOver !== 0 && !form.shop.attendantName.trim()) {
      toast({
        title: "Attendant Name required",
        description: "Please select the attendant name when Attendant Short/(Over) is entered.",
        variant: "destructive",
      });
      return;
    }
    // --- Customer name mandatory if customer to pay is non-zero ---
    if ((form.shop.customerToPay ?? 0) !== 0 && !(form.shop.customerName ?? '').trim()) {
      toast({
        title: "Customer Name required",
        description: "Please enter the customer name when Customer to Pay/(Paid) is entered.",
        variant: "destructive",
      });
      return;
    }
    // --- Extra Attendant Short/(Over) rows: name required if amount non-zero ---
    const badExtraAttendant = (form.shop.extraAttendantShortOvers ?? []).filter(
      (r) => r.amount !== 0 && !r.name.trim(),
    );
    if (badExtraAttendant.length > 0) {
      toast({
        title: "Attendant Name required",
        description: "Please select an attendant name for every extra Attendant Short/(Over) row with an amount.",
        variant: "destructive",
      });
      return;
    }
    // --- Extra Customer to Pay/(Paid) rows: name required if amount non-zero ---
    const badExtraCustomer = (form.shop.extraCustomerToPays ?? []).filter(
      (r) => r.amount !== 0 && !r.name.trim(),
    );
    if (badExtraCustomer.length > 0) {
      toast({
        title: "Customer Name required",
        description: "Please enter a customer name for every extra Customer to Pay/(Paid) row with an amount.",
        variant: "destructive",
      });
      return;
    }

    // --- Over (negative balance) confirmation ---
    const shopOver = shopDifference < -0.01;
    const optOver = showSecondShift && optDifference < -0.01;
    if (shopOver || optOver) {
      setOverConfirmOpen(true);
      return;
    }

    commitSave();
  };

  const addPayout = () => setShop({ payouts: [...form.shop.payouts, { id: uuidv4(), vendor: "", amount: 0 }] });
  const removePayout = (id: string) => setShop({ payouts: form.shop.payouts.filter((p) => p.id !== id) });
  const updatePayout = (id: string, patch: Partial<PayoutLine>) =>
    setShop({ payouts: form.shop.payouts.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const updateReceipt = (id: string, patch: Partial<ReceiptLine>) =>
    setShop({ receipts: form.shop.receipts.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  const updateShopSpeedpoint = (idx: number, patch: Partial<SpeedpointEntry>) => {
    const sp = [...form.shop.speedpoints];
    sp[idx] = { ...sp[idx], ...patch };
    setShop({ speedpoints: sp });
  };
  const updateOptSpeedpoint = (idx: number, patch: Partial<SpeedpointEntry>) => {
    const sp = [...form.opt.speedpoints];
    sp[idx] = { ...sp[idx], ...patch };
    setOpt({ speedpoints: sp });
  };

  const addAccount = (shift: "shop" | "opt") => {
    const entry: AccountEntry = { id: uuidv4(), name: "", amount: 0 };
    if (shift === "shop") setShop({ accounts: [...form.shop.accounts, entry] });
    else setOpt({ accounts: [...form.opt.accounts, entry] });
  };
  const removeAccount = (id: string, shift: "shop" | "opt") => {
    if (shift === "shop") setShop({ accounts: form.shop.accounts.filter((a) => a.id !== id) });
    else setOpt({ accounts: form.opt.accounts.filter((a) => a.id !== id) });
  };
  const updateAccount = (id: string, patch: Partial<AccountEntry>, shift: "shop" | "opt") => {
    if (shift === "shop") setShop({ accounts: form.shop.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
    else setOpt({ accounts: form.opt.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  };

  const addOther = () =>
    setShop({ otherAdjustments: [...form.shop.otherAdjustments, { id: uuidv4(), explanation: "", amount: 0 }] });
  const addAttendantShortOver = () =>
    setShop({
      extraAttendantShortOvers: [
        ...(form.shop.extraAttendantShortOvers ?? []),
        { id: uuidv4(), name: "", amount: 0 },
      ],
    });
  const updateExtraAttendant = (id: string, patch: Partial<NamedAdjustment>) =>
    setShop({
      extraAttendantShortOvers: (form.shop.extraAttendantShortOvers ?? []).map((r) =>
        r.id === id ? { ...r, ...patch } : r,
      ),
    });
  const removeExtraAttendant = (id: string) =>
    setShop({
      extraAttendantShortOvers: (form.shop.extraAttendantShortOvers ?? []).filter((r) => r.id !== id),
    });
  const addCustomerToPay = () =>
    setShop({
      extraCustomerToPays: [
        ...(form.shop.extraCustomerToPays ?? []),
        { id: uuidv4(), name: "", amount: 0 },
      ],
    });
  const updateExtraCustomer = (id: string, patch: Partial<NamedAdjustment>) =>
    setShop({
      extraCustomerToPays: (form.shop.extraCustomerToPays ?? []).map((r) =>
        r.id === id ? { ...r, ...patch } : r,
      ),
    });
  const removeExtraCustomer = (id: string) =>
    setShop({
      extraCustomerToPays: (form.shop.extraCustomerToPays ?? []).filter((r) => r.id !== id),
    });
  const removeOther = (id: string) =>
    setShop({ otherAdjustments: form.shop.otherAdjustments.filter((o) => o.id !== id) });
  const updateOther = (id: string, patch: Partial<OtherAdjustment>) =>
    setShop({ otherAdjustments: form.shop.otherAdjustments.map((o) => (o.id === id ? { ...o, ...patch } : o)) });

  const ShortOverBadge = ({ diff }: { diff: number }) => {
    const balanced = Math.abs(diff) < 0.01;
    return (
      <div
        className={`flex items-center gap-2 rounded px-3 py-1 text-sm font-bold ${balanced ? "bg-green-100 text-green-800 border border-green-400" : "bg-red-100 text-red-800 border border-red-400"}`}
      >
        {balanced ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
        <CurrencyDisplay value={diff} className="font-bold" />
        <span className="text-xs">{balanced ? "BALANCED" : "SHORT/(OVER)"}</span>
      </div>
    );
  };

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
              Save Cashup
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
      {/* Header info */}
      <div className="bg-card border rounded-lg p-3 grid grid-cols-2 md:grid-cols-5 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Entered By</label>
          <input
            value={form.enteredBy}
            onChange={(e) => setForm((f) => ({ ...f, enteredBy: e.target.value }))}
            className="input-cell text-[#020508] bg-[#e4ebf2] w-full mt-0.5"
            placeholder="Name"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Cashier</label>
          <select
            value={form.cashierName}
            onChange={(e) => setForm((f) => ({ ...f, cashierName: e.target.value }))}
            className="input-cell text-[#020508] bg-[#e4ebf2] w-full mt-0.5"
          >
            <option value="">Select...</option>
            {CASHIER_NAMES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Shop Shift #</label>
          <input
            type="number"
            value={form.shopShiftNumber || ""}
            onChange={(e) => setForm((f) => ({ ...f, shopShiftNumber: parseInt(e.target.value) || 0 }))}
            className="input-cell text-[#020508] bg-[#e4ebf2] w-full mt-0.5"
          />
        </div>
        {showSecondShift && (
          <div>
            <label className="text-xs text-muted-foreground">OPT Shift #</label>
            <input
              type="number"
              value={form.optShiftNumber || ""}
              onChange={(e) => setForm((f) => ({ ...f, optShiftNumber: parseInt(e.target.value) || 0 }))}
              className="input-cell text-[#020508] bg-[#e4ebf2] w-full mt-0.5"
            />
          </div>
        )}
        <div className="flex items-end">
          <span className="text-xs text-muted-foreground italic">Use the Save button below ↓</span>
        </div>
      </div>

      {/* Shift headers */}
      <div className="grid grid-cols-2 gap-0 rounded-lg overflow-hidden border">
        <div className="bg-primary text-primary-foreground px-4 py-2 font-bold text-sm text-center">
          🛒 SHOP TILL — Shift {form.shopShiftNumber}
        </div>
        <div className="bg-primary/80 text-primary-foreground px-4 py-2 font-bold text-sm text-center border-l border-primary-foreground/20">
          ⛽ OPT — Shift {form.optShiftNumber}
        </div>
      </div>

      {/* ─── SECTION 1: INCOME ─── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-blue-600 text-white px-3 py-2 font-semibold text-sm">1. Income</div>
        <ColHeader left="Shop Till" right="OPT" />
        <div className="grid grid-cols-2 divide-x">
          {/* Shop income */}
          <div>
            <div className="flex items-center justify-between px-3 py-1.5 border-b text-sm">
              <span className="text-muted-foreground">Income (Gross Sales)</span>
              <CurrencyInput value={form.shop.income} onChange={(v) => setShop({ income: v })} />
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 border-b text-sm">
              <span className="text-muted-foreground">Returns (Yest Shift)</span>
              <CurrencyInput value={form.shop.returns} onChange={(v) => setShop({ returns: v, returns_mop: -v })} />
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 border-b text-sm">
              <span className="text-muted-foreground">Returns (Today Shift)</span>
              <CurrencyInput value={form.shop.returns_today} onChange={(v) => setShop({ returns_today: v })} />
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 bg-secondary text-sm font-semibold">
              <span>Net Sales</span>
              <CurrencyDisplay value={shopNetSales} highlight />
            </div>
          </div>
          {/* OPT income */}
          <div>
            <div className="flex items-center justify-between px-3 py-1.5 border-b text-sm">
              <span className="text-muted-foreground">Income (Gross Sales)</span>
              <CurrencyInput value={form.opt.income} onChange={(v) => setOpt({ income: v })} />
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 border-b text-sm">
              <span className="text-muted-foreground">Returns</span>
              <CurrencyInput value={form.opt.returns} onChange={(v) => setOpt({ returns: v })} />
            </div>
            {/* Spacer row to align with Shop Returns (Today Shift) */}
            <div className="px-3 py-1.5 border-b text-sm">&nbsp;</div>
            <div className="flex items-center justify-between px-3 py-1.5 bg-secondary text-sm font-semibold">
              <span>Net Sales</span>
              <CurrencyDisplay value={optNetSales} highlight />
            </div>
          </div>
        </div>
        {/* Total Net Sales row */}
        <div className="flex items-center justify-between px-3 py-2 bg-primary/10 text-sm font-bold border-t">
          <span>Total Net Sales (Shop + OPT)</span>
          <CurrencyDisplay value={shopNetSales + optNetSales} highlight />
        </div>
      </div>

      {/* ─── SECTION 2: PAYOUTS (Shop only) ─── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-red-600 text-white px-3 py-2 font-semibold text-sm">2. Cash Payouts — Shop Till Only</div>
        {useDayEndPayouts ? (
          <>
            <div className="px-3 py-2 text-xs text-muted-foreground border-b bg-muted/30">
              Cash payouts are pulled from the uploaded Day End report. Net Cash Payouts = Day End Payouts less Lotto Payouts and cannot be edited directly here.
            </div>
            <div className="flex items-center justify-between px-3 py-2 border-b text-sm">
              <span className="font-medium">Day End Payouts</span>
              {dayEndStatus === "loading" && (
                <span className="text-xs text-muted-foreground italic">Loading…</span>
              )}
              {dayEndStatus === "missing" && (
                <span className="text-xs text-amber-700 font-medium">No day end uploaded for this date</span>
              )}
              {dayEndStatus === "loaded" && (
                <CurrencyDisplay value={dayEndPayoutsAmount ?? 0} highlight />
              )}
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Lotto Payouts Only</span>
              <CurrencyInput value={form.shop.lottoPayouts} onChange={(v) => setShop({ lottoPayouts: v })} />
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 bg-secondary text-sm font-semibold">
              <span>Net Cash Payouts</span>
              <CurrencyDisplay value={netDayEndPayoutsAmount} highlight />
            </div>
          </>
        ) : (
          <>
            <div className="px-3 py-1 text-xs text-muted-foreground grid grid-cols-3 gap-2 font-semibold border-b bg-muted/30">
              <span>Vendor</span>
              <span className="text-right col-span-1">Amount (Incl.)</span>
              <span></span>
            </div>
            {form.shop.payouts.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-3 py-1 border-b">
                <select
                  value={p.vendor}
                  onChange={(e) => updatePayout(p.id, { vendor: e.target.value })}
                  className="input-cell text-[#020508] bg-[#e4ebf2] flex-1 text-left text-sm"
                >
                  <option value="">Select vendor...</option>
                  {SUPPLIERS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <CurrencyInput value={p.amount} onChange={(v) => updatePayout(p.id, { amount: v })} />
                <button onClick={() => removePayout(p.id)} className="text-destructive hover:text-destructive/70 p-1">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div className="px-3 py-1.5 flex items-center justify-between border-b">
              <Button variant="outline" size="sm" onClick={addPayout} className="text-xs h-7">
                <Plus className="h-3 w-3 mr-1" />
                Add Payout
              </Button>
              <div className="flex gap-4 text-sm font-semibold pr-8">
                <span className="text-muted-foreground">Payouts (excl. Lotto):</span>
                <CurrencyDisplay value={shopPayoutsTotal} />
              </div>
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Lotto Payouts Only</span>
              <CurrencyInput value={form.shop.lottoPayouts} onChange={(v) => setShop({ lottoPayouts: v })} />
            </div>
          </>
        )}
      </div>


      {/* ─── SECTION 3: RECEIPTS (Shop only) ─── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-green-700 text-white px-3 py-2 font-semibold text-sm">3. Receipts — Shop Till Only</div>
        <div className="px-3 py-1 text-xs text-muted-foreground grid grid-cols-12 gap-2 font-semibold border-b bg-muted/30">
          <span className="col-span-7">Type</span>
          <span className="col-span-2">Seq No. / Debtor</span>
          <span className="col-span-3 text-right">Amount</span>
        </div>
        {form.shop.receipts.map((r) => (
          <div key={r.id} className="grid grid-cols-12 items-center gap-2 px-3 py-1 border-b last:border-b-0">
            <span className="text-sm text-muted-foreground col-span-7">{r.type}</span>
            {r.type === "Debtors Received on Account ROA" ? (
              <div className="col-span-2">
                <Select value={r.seqNo} onValueChange={(v) => updateReceipt(r.id, { seqNo: v })}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Debtor" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNTS.map((acc) => (
                      <SelectItem key={acc} value={acc}>{acc}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <input
                value={r.seqNo}
                onChange={(e) => updateReceipt(r.id, { seqNo: e.target.value })}
                className="input-cell text-[#020508] bg-[#e4ebf2] col-span-2"
                placeholder="Seq#"
              />
            )}
            <div className="col-span-3 flex justify-end">
              <CurrencyInput value={r.amount} onChange={(v) => updateReceipt(r.id, { amount: v })} />
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between px-3 py-1.5 bg-secondary font-semibold text-sm">
          <span>Total Receipts</span>
          <CurrencyDisplay value={shopTotalReceipts} highlight />
        </div>
      </div>

      {/* ─── SECTION 4: TOTAL TAKINGS (Both shifts) ─── */}
      <div className="border-2 border-orange-500 rounded-lg overflow-hidden">
        <div className="bg-orange-600 text-white px-3 py-2 font-semibold text-sm">
          4. Total Takings (Section 1 − 2 + 3)
        </div>
        <ColHeader left="Shop Till" right="OPT" />
        <div className="grid grid-cols-2 divide-x">
          <div className="flex items-center justify-between px-3 py-2 font-bold text-sm">
            <span>Shop Takings</span>
            <CurrencyDisplay value={shopTotalTakings} highlight className="text-base" />
          </div>
          <div className="flex items-center justify-between px-3 py-2 font-bold text-sm">
            <span>OPT Takings</span>
            <CurrencyDisplay value={optTotalTakings} highlight className="text-base" />
          </div>
        </div>
        <div className="flex items-center justify-between px-3 py-2 bg-orange-50 border-t font-bold text-sm">
          <span>COMBINED TOTAL TAKINGS</span>
          <CurrencyDisplay value={combinedTotalTakings} highlight className="text-base text-orange-700" />
        </div>
      </div>

      {/* ─── SECTION 5: MOP CASH (Shop only) ─── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-blue-600 text-white px-3 py-2 font-semibold text-sm">5. MOP Cash — Shop Till Only</div>
        <div className="flex items-center justify-between px-3 py-1.5 border-b text-sm">
          <span className="text-muted-foreground">Cash Deposited for Banking</span>
          <CurrencyInput
            value={form.shop.cashDepositedBanking}
            onChange={(v) => setShop({ cashDepositedBanking: v })}
          />
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 border-b text-sm">
          <span className="text-muted-foreground">EasyPay</span>
          <CurrencyInput value={form.shop.easyPay} onChange={(v) => setShop({ easyPay: v })} />
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 border-b text-sm">
          <span className="text-muted-foreground">Coins</span>
          <CurrencyInput value={form.shop.coins} onChange={(v) => setShop({ coins: v })} />
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 bg-secondary font-semibold text-sm">
          <span className="flex items-center gap-2">
            Cash Connect Total (Sum)
            {netAccSafeDepositsTotal != null && (
              <span
                className={`text-xs font-normal px-2 py-0.5 rounded ${
                  Math.abs(netAccSafeDepositsTotal - cashConnectTotal) < 0.01
                    ? 'bg-green-100 text-green-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
                title="NetAcc Manual Safe Deposits TOTAL — validation reference (not used in calculations)"
              >
                Safe deposits: {netAccSafeDepositsTotal.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
          </span>
          <CurrencyDisplay value={cashConnectTotal} highlight />
        </div>
      </div>

      {/* ─── SECTION 6: MOP SPEEDPOINTS (Both shifts, side by side) ─── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-purple-700 text-white px-3 py-2 font-semibold text-sm">6. MOP Speedpoints</div>
        <div className="grid grid-cols-2 border-b divide-x">
          <div className="px-3 py-1 grid grid-cols-8 gap-1 text-xs font-semibold text-muted-foreground bg-muted/30">
            <span className="col-span-4">Terminal (Shop)</span>
            <span className="col-span-2">Batch#</span>
            <span className="col-span-2 text-right">Amount</span>
          </div>
          <div className="px-3 py-1 grid grid-cols-8 gap-1 text-xs font-semibold text-muted-foreground bg-muted/30">
            <span className="col-span-4">Terminal (OPT)</span>
            <span className="col-span-2">Batch#</span>
            <span className="col-span-2 text-right">Amount</span>
          </div>
        </div>
        {/* Render rows for both — zip them together */}
        {Array.from({ length: Math.max(form.shop.speedpoints.length, form.opt.speedpoints.length) }).map((_, i) => {
          const s = form.shop.speedpoints[i];
          const o = form.opt.speedpoints[i];
          return (
            <div key={i} className="grid grid-cols-2 divide-x border-b last:border-b-0">
              {s ? (
                <div className="px-3 py-1 grid grid-cols-8 gap-1 items-center">
                  <span className="text-sm col-span-4">{s.terminal}</span>
                  <input
                    value={s.batchNo}
                    onChange={(e) => updateShopSpeedpoint(i, { batchNo: e.target.value })}
                    className="input-cell text-[#020508] bg-[#e4ebf2] col-span-2 text-xs py-0.5"
                    placeholder="Batch#"
                  />
                  <div className="col-span-2">
                    <CurrencyInput
                      value={s.shopAmount}
                      onChange={(v) => updateShopSpeedpoint(i, { shopAmount: v })}
                      className="w-full"
                    />
                  </div>
                </div>
              ) : (
                <div />
              )}
              {o ? (
                <div className="px-3 py-1 grid grid-cols-8 gap-1 items-center">
                  <span className="text-sm col-span-4">{o.terminal}</span>
                  <input
                    value={o.batchNo}
                    onChange={(e) => updateOptSpeedpoint(i, { batchNo: e.target.value })}
                    className="input-cell text-[#020508] bg-[#e4ebf2] col-span-2 text-xs py-0.5"
                    placeholder="Batch#"
                  />
                  <div className="col-span-2">
                    <CurrencyInput
                      value={o.optAmount}
                      onChange={(v) => updateOptSpeedpoint(i, { optAmount: v })}
                      className="w-full"
                    />
                  </div>
                </div>
              ) : (
                <div />
              )}
            </div>
          );
        })}
        <div className="grid grid-cols-2 divide-x bg-secondary font-semibold text-sm">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span>Shop Speedpoints Total</span>
            <CurrencyDisplay value={shopSpeedpointTotal} highlight />
          </div>
          <div className="flex items-center justify-between px-3 py-1.5">
            <span>OPT Speedpoints Total</span>
            <CurrencyDisplay value={optSpeedpointTotal} highlight />
          </div>
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 bg-primary/10 font-bold text-sm border-t">
          <span>Combined Speedpoints Total</span>
          <CurrencyDisplay value={shopSpeedpointTotal + optSpeedpointTotal} highlight />
        </div>
      </div>

      {/* ─── SECTION 7: MOP ACCOUNT (Shop only) ─── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-blue-600 text-white px-3 py-2 font-semibold text-sm">
          7. MOP Account (Debtors) — Shop Till Only
        </div>
        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground bg-muted/30 border-b grid grid-cols-12 gap-2">
          <span className="col-span-8">Account</span>
          <span className="col-span-3 text-right">Amount</span>
          <span />
        </div>
        {form.shop.accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-1 px-2 py-1 border-b">
            <select
              value={a.name}
              onChange={(e) => updateAccount(a.id, { name: e.target.value }, "shop")}
              className="input-cell text-[#020508] bg-[#e4ebf2] flex-1 text-left text-xs"
            >
              <option value="">Select account...</option>
              {ACCOUNTS.map((ac) => (
                <option key={ac}>{ac}</option>
              ))}
            </select>
            <CurrencyInput
              value={a.amount}
              onChange={(v) => updateAccount(a.id, { amount: v }, "shop")}
              className="w-28"
            />
            <button onClick={() => removeAccount(a.id, "shop")} className="text-destructive p-0.5">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <div className="px-2 py-1.5 flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => addAccount("shop")} className="text-xs h-7">
            <Plus className="h-3 w-3 mr-1" />
            Add Account
          </Button>
          <span className="text-sm font-semibold pr-1 text-muted-foreground">
            Total: <CurrencyDisplay value={shopAccountTotal} />
          </span>
        </div>
      </div>

      {/* ─── Less SECTION 8: OTHER ADJUSTMENTS (Shop only) ─── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-primary text-primary-foreground px-3 py-2 font-semibold text-sm">
          Less 8. Other Adjustments — Shop Till Only
        </div>
        {form.shop.otherAdjustments.map((o) => (
          <div key={o.id} className="flex items-center gap-2 px-3 py-1 border-b">
            <input
              value={o.explanation}
              onChange={(e) => updateOther(o.id, { explanation: e.target.value })}
              className="input-cell text-[#020508] bg-[#e4ebf2] flex-1 text-left"
              placeholder="Explanation"
            />
            <CurrencyInput value={o.amount} onChange={(v) => updateOther(o.id, { amount: v })} allowNegative />
            <button onClick={() => removeOther(o.id)} className="text-destructive p-1">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between px-3 py-1.5 border-b text-sm">
          <span className="text-muted-foreground">Returns (returns from Yesterday)</span>
          <CurrencyInput value={form.shop.returns_mop} onChange={() => {}} allowNegative disabled />
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 border-b text-sm bg-muted/20">
          <span className="text-muted-foreground italic">Returns not captured (to be captured tomorrow)</span>
          <CurrencyInput value={form.shop.returnsNotCaptured} onChange={(v) => setShop({ returnsNotCaptured: v })} allowNegative />
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 border-b text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Attendant Short/(Over)</span>
            {form.shop.attendantShortOver !== 0 && (
              <Select value={form.shop.attendantName} onValueChange={(v) => setShop({ attendantName: v })}>
                <SelectTrigger className="h-7 text-xs w-36">
                  <SelectValue placeholder="Select attendant" />
                </SelectTrigger>
                <SelectContent>
                  {CASHIER_NAMES.map((name) => (
                    <SelectItem key={name} value={name}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <CurrencyInput
            value={form.shop.attendantShortOver}
            onChange={(v) => setShop({ attendantShortOver: v })}
            allowNegative
          />
        </div>
        {(form.shop.extraAttendantShortOvers ?? []).map((row) => (
          <div key={row.id} className="flex items-center justify-between px-3 py-1.5 border-b text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Attendant Short/(Over)</span>
              {row.amount !== 0 && (
                <Select value={row.name} onValueChange={(v) => updateExtraAttendant(row.id, { name: v })}>
                  <SelectTrigger className="h-7 text-xs w-36">
                    <SelectValue placeholder="Select attendant" />
                  </SelectTrigger>
                  <SelectContent>
                    {CASHIER_NAMES.map((name) => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex items-center gap-1">
              <CurrencyInput
                value={row.amount}
                onChange={(v) => updateExtraAttendant(row.id, { amount: v })}
                allowNegative
              />
              <button
                type="button"
                onClick={() => removeExtraAttendant(row.id)}
                className="p-1 text-muted-foreground hover:text-destructive"
                aria-label="Remove row"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between px-3 py-1.5 border-b text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Customer to Pay/(Paid)</span>
            {(form.shop.customerToPay ?? 0) !== 0 && (
              <input
                value={form.shop.customerName ?? ''}
                onChange={(e) => setShop({ customerName: e.target.value })}
                placeholder="Customer name"
                className="input-cell text-[#020508] bg-[#e4ebf2] h-7 text-xs w-44 text-left"
              />
            )}
          </div>
          <CurrencyInput
            value={form.shop.customerToPay ?? 0}
            onChange={(v) => setShop({ customerToPay: v })}
            allowNegative
          />
        </div>
        {(form.shop.extraCustomerToPays ?? []).map((row) => (
          <div key={row.id} className="flex items-center justify-between px-3 py-1.5 border-b text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Customer to Pay/(Paid)</span>
              {row.amount !== 0 && (
                <input
                  value={row.name}
                  onChange={(e) => updateExtraCustomer(row.id, { name: e.target.value })}
                  placeholder="Customer name"
                  className="input-cell text-[#020508] bg-[#e4ebf2] h-7 text-xs w-44 text-left"
                />
              )}
            </div>
            <div className="flex items-center gap-1">
              <CurrencyInput
                value={row.amount}
                onChange={(v) => updateExtraCustomer(row.id, { amount: v })}
                allowNegative
              />
              <button
                type="button"
                onClick={() => removeExtraCustomer(row.id)}
                className="p-1 text-muted-foreground hover:text-destructive"
                aria-label="Remove row"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
        <div className="px-3 py-1.5 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={addOther} className="text-xs h-7">
            <Plus className="h-3 w-3 mr-1" />
            Add Adjustment
          </Button>
          <Button variant="outline" size="sm" onClick={addAttendantShortOver} className="text-xs h-7">
            <Plus className="h-3 w-3 mr-1" />
            Add Attendant Short/(Over)
          </Button>
          <Button variant="outline" size="sm" onClick={addCustomerToPay} className="text-xs h-7">
            <Plus className="h-3 w-3 mr-1" />
            Add Customer to Pay/(Paid)
          </Button>
        </div>
        <div className="flex items-center justify-between px-3 py-2 bg-secondary font-semibold text-sm border-t">
          <span>Total Other Adjustments</span>
          <CurrencyDisplay value={shopSection8Total} highlight />
        </div>
      </div>

      {/* ─── CASHIER BALANCE (Short/Over) ─── */}
      <div className="border-2 rounded-lg overflow-hidden">
        <div className="bg-muted px-3 py-2 font-semibold text-sm border-b">Cashier Balance — Short / (Over)</div>
        <div className="grid grid-cols-2 divide-x">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold">Shop Till</span>
            <ShortOverBadge diff={shopDifference} />
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold">OPT</span>
            <ShortOverBadge diff={optDifference} />
          </div>
        </div>
        <div className="px-4 py-3 flex items-center justify-between border-t bg-secondary">
          <span className="text-sm font-bold">COMBINED SHORT / (OVER)</span>
          <ShortOverBadge diff={shopDifference + optDifference} />
        </div>
        <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/30 border-t">
          Shop: Total Takings − MOP Cash − Speedpoints − Accounts − Other &nbsp;|&nbsp; OPT: Net Sales − Speedpoints
        </div>
      </div>

      {/* ─── EXPLANATIONS / NOTES ─── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-muted px-3 py-2 font-semibold text-sm border-b">Explanations / Notes</div>
        <div className="p-3">
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            disabled={isLocked}
            rows={3}
            className="input-cell text-[#020508] bg-[#e4ebf2] w-full resize-y text-sm"
            placeholder="Enter any notes or explanations..."
          />
        </div>
      </div>

      {/* ─── SAVE BUTTON + NAV ─── */}
      <div className="flex items-center justify-between gap-2 pt-2 pb-4">
        {onDateChange ? (
          <Button variant="ghost" size="sm" onClick={() => goDay(-1)} disabled={selectedDate <= "2026-01-01"}>
            <ChevronLeft className="h-4 w-4" /> Previous Day
          </Button>
        ) : <div />}
        <div className="flex flex-col items-center gap-1">
          <Button onClick={handleSave} size="lg" className="px-12" disabled={isLocked}>
            <Save className="h-4 w-4 mr-2" /> Save Cashup
          </Button>
          {savedAt && (
            <p className="text-xs text-muted-foreground">
              Originally saved: <span className="font-semibold text-foreground">{savedAt}</span>
            </p>
          )}
        </div>
        {onDateChange ? (
          <Button variant="ghost" size="sm" onClick={() => goDay(1)}>
            Next Day <ChevronRight className="h-4 w-4" />
          </Button>
        ) : <div />}
      </div>

      {/* ─── OVER CONFIRMATION DIALOG ─── */}
      <AlertDialog open={overConfirmOpen} onOpenChange={setOverConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" /> Cashier is Over
            </AlertDialogTitle>
            <AlertDialogDescription>
              {shopDifference < -0.01 && optDifference < -0.01
                ? "Both the Shop Till and OPT shifts show a negative balance (cashier is over)."
                : shopDifference < -0.01
                  ? "The Shop Till shift shows a negative balance (cashier is over)."
                  : "The OPT shift shows a negative balance (cashier is over)."}{" "}
              Are you sure you want to save?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setOverConfirmOpen(false);
                commitSave();
              }}
            >
              Yes, Save Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
