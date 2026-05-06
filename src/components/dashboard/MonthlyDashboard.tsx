import { useState, useCallback, useEffect, useMemo } from "react";
import { useCashupStore } from "@/store/cashupStore";
import { CurrencyDisplay } from "@/components/ui/CashupUI";
import { CheckCircle, XCircle, MinusCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, addMonths, subMonths } from "date-fns";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { parseBankStatementDate } from "@/lib/bankStatementDate";
import { getCashierBalanceMetrics, parseDayEndReportMetrics, type DayEndReportMetrics } from "@/lib/cashierBalanceMetrics";

import type { DailyCashup, ManagerDailyEntry } from "@/types/cashup";

interface Props {
  selectedDate: string;
  onNavigateToDate?: (date: string) => void;
}

interface DayMetrics {
  date: string;
  cashierName?: string;
  enteredBy?: string;
  shopDiff: number | null;
  optDiff: number | null;
  payoutsDiff: number | null;
  invDiff: number | null;
  invMatch: boolean | null;
  vatDiff: number | null;
  vatMatch: boolean | null;
  hasData: boolean;
  seqGaps: string[]; // abbreviations of receipt types with gaps e.g. ["BL","EP"]
  seqHasReceipts: boolean; // whether this day has any tracked receipts
}

const SEQ_TYPE_MAP: Record<string, string> = {
  "Blue Label": "BL",
  "Easypay": "EP",
  "Lotto Receipts": "LR",
};

function computeDayMetrics(
  dateStr: string,
  cashup: DailyCashup | undefined,
  managerEntry: ManagerDailyEntry | undefined,
  reportMetricsByDate: Record<string, DayEndReportMetrics>,
  previousCashup?: DailyCashup,
): DayMetrics {
  if (!cashup && !managerEntry) {
    return {
      date: dateStr,
      shopDiff: null,
      optDiff: null,
      payoutsDiff: null,
      invDiff: null,
      invMatch: null,
      vatDiff: null,
      vatMatch: null,
      hasData: false,
      enteredBy: undefined,
      seqGaps: [],
      seqHasReceipts: false,
    };
  }

  let shopDiff: number | null = null;
  let optDiff: number | null = null;

  if (cashup) {
    const metrics = getCashierBalanceMetrics(cashup, dateStr, reportMetricsByDate[dateStr], previousCashup);
    shopDiff = metrics.shopDiff;
    optDiff = metrics.optDiff;
  }

  let payoutsDiff: number | null = null;
  if (cashup && managerEntry) {
    const cashierPayoutsTotal = cashup.shop.payouts.reduce((s, p) => s + p.amount, 0);
    const managerPayoutInvoicesTotal = managerEntry.payoutInvoices.reduce((s, i) => s + i.inclusive, 0);
    payoutsDiff = cashierPayoutsTotal - managerPayoutInvoicesTotal;
  }

  let invDiff: number | null = null;
  let invMatch: boolean | null = null;
  let vatDiff: number | null = null;
  let vatMatch: boolean | null = null;

  if (managerEntry) {
    const invTotal =
      managerEntry.payoutInvoices.reduce((s, i) => s + i.inclusive, 0) +
      managerEntry.eftInvoices.reduce((s, i) => s + i.inclusive, 0);
    const invVat =
      managerEntry.payoutInvoices.reduce((s, i) => s + i.vat, 0) +
      managerEntry.eftInvoices.reduce((s, i) => s + i.vat, 0);
    invDiff = invTotal - managerEntry.branchDayEndTotal;
    invMatch = Math.abs(invDiff) < 0.5;
    vatDiff = invVat - managerEntry.branchDayEndVat;
    vatMatch = Math.abs(vatDiff) < 1.0;
  }

  const enteredBy = cashup?.enteredBy || managerEntry?.enteredBy || undefined;

  // Check which tracked receipt types exist
  const seqHasReceipts = cashup
    ? cashup.shop.receipts.some((r) => SEQ_TYPE_MAP[r.type] && r.amount !== 0)
    : false;

  return {
    date: dateStr,
    cashierName: cashup?.cashierName,
    enteredBy,
    shopDiff,
    optDiff,
    payoutsDiff,
    invDiff,
    invMatch,
    vatDiff,
    vatMatch,
    hasData: true,
    seqGaps: [], // computed after all rows are built
    seqHasReceipts,
  };
}

/** Parse seq numbers for tracked receipt types from a cashup */
function getSeqNumbers(cashup: DailyCashup | undefined): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  if (!cashup) return result;
  for (const r of cashup.shop.receipts) {
    const abbr = SEQ_TYPE_MAP[r.type];
    if (!abbr || r.amount === 0) continue;
    const num = parseInt(r.seqNo, 10);
    if (!isNaN(num)) {
      if (!result[abbr]) result[abbr] = [];
      result[abbr].push(num);
    }
  }
  return result;
}

function computeSeqGaps(
  days: Date[],
  getCashupByDate: (date: string) => DailyCashup | undefined,
): Record<string, string[]> {
  const gaps: Record<string, string[]> = {};
  // Track last max seq per type
  const lastMax: Record<string, number> = {};

  for (const day of days) {
    const ds = format(day, "yyyy-MM-dd");
    const cashup = getCashupByDate(ds);
    const seqNums = getSeqNumbers(cashup);
    const dayGaps: string[] = [];

    for (const abbr of Object.keys(SEQ_TYPE_MAP).map((k) => SEQ_TYPE_MAP[k])) {
      const nums = seqNums[abbr];
      if (!nums || nums.length === 0) continue;
      nums.sort((a, b) => a - b);
      const minSeq = nums[0];

      if (lastMax[abbr] !== undefined) {
        if (minSeq !== lastMax[abbr] + 1) {
          dayGaps.push(abbr);
        }
      }
      // Update lastMax
      lastMax[abbr] = Math.max(...nums);
    }

    gaps[ds] = dayGaps;
  }

  return gaps;
}

function StatusIcon({ status }: { status: "green" | "red" | "none" }) {
  if (status === "green") return <CheckCircle className="h-4 w-4 text-green-600" />;
  if (status === "red") return <XCircle className="h-4 w-4 text-red-600" />;
  return <MinusCircle className="h-4 w-4 text-muted-foreground/30" />;
}

export function MonthlyDashboard({ selectedDate, onNavigateToDate }: Props) {
  const { getCashupByDate, getManagerEntryByDate, updateManagerEntry, addManagerEntry, cashups, managerEntries, getMonthlyFiguresByMonth } = useCashupStore();
  const [editingExplanations, setEditingExplanations] = useState<Record<string, string>>({});
  const [monthOffset, setMonthOffset] = useState(0);
  const [bankLines, setBankLines] = useState<{ amount: number; description: string; transaction_date: string }[]>([]);
  const [prevBankLines, setPrevBankLines] = useState<typeof bankLines>([]);

  const baseMonth = startOfMonth(parseISO(selectedDate));
  const currentMonth = monthOffset === 0 ? baseMonth : addMonths(baseMonth, monthOffset);
  const monthStart = currentMonth;
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const filterMonth = format(monthStart, 'yyyy-MM');

  const SEED_BLD = -11906.34;
  const SEED_EASYPAY = 14392.59;
  const SEED_LOTTO = -7691.21;

  const isFirstMonth = filterMonth === '2026-03';
  const prevMonth = useMemo(() => {
    const d = new Date(filterMonth + '-01');
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  }, [filterMonth]);

  const [reportMetricsByDate, setReportMetricsByDate] = useState<Record<string, DayEndReportMetrics>>({});

  useEffect(() => {
    const load = async () => {
      const bankRes = await supabase.from('bank_statement_lines').select('amount, description, transaction_date').eq('month', filterMonth);
      setBankLines(((bankRes as any)?.data ?? []) as typeof bankLines);
      if (!isFirstMonth) {
        const prevRes = await supabase.from('bank_statement_lines').select('amount, description, transaction_date').eq('month', prevMonth);
        setPrevBankLines(((prevRes as any)?.data ?? []) as typeof bankLines);
      }
      const dayEndRes = await supabase.from('day_end_uploads').select('date, content').eq('month', filterMonth);
      const map: Record<string, DayEndReportMetrics> = {};
      ((dayEndRes as any)?.data ?? []).forEach((row: { date: string; content: string }) => {
        const metrics = parseDayEndReportMetrics(row.content);
        if (metrics) map[row.date] = metrics;
      });
      setReportMetricsByDate(map);
    };
    load();
  }, [filterMonth, isFirstMonth, prevMonth]);

  const computeAirtimeClosing = useCallback((
    monthStr: string,
    lines: typeof bankLines,
    openBld: number, openEp: number, openLt: number,
  ) => {
    const mStart = startOfMonth(new Date(monthStr + '-01'));
    const mEnd = endOfMonth(mStart);
    const mDays = eachDayOfInterval({ start: mStart, end: mEnd });
    const mCashups = new Map(cashups.filter(c => c.month === monthStr).map(c => [c.date, c]));
    const bldPmts = new Map<string, number>();
    const lottoPmts = new Map<string, number>();
    lines.forEach(line => {
      const desc = line.description.toUpperCase().trim();
      const dateStr = parseBankStatementDate(line.transaction_date);
      if (!dateStr) return;
      if (desc.includes('BLD DO') || desc.includes('BLUE LABEL')) bldPmts.set(dateStr, (bldPmts.get(dateStr) ?? 0) + Math.abs(line.amount));
      if (desc.includes('ITHUCOLL')) lottoPmts.set(dateStr, (lottoPmts.get(dateStr) ?? 0) + Math.abs(line.amount));
    });
    let bld = openBld, ep = openEp, lt = openLt;
    for (const day of mDays) {
      const ds = format(day, 'yyyy-MM-dd');
      const c = mCashups.get(ds);
      const bldInv = c ? c.shop.receipts.filter((r: any) => r.type === 'Blue Label').reduce((s: number, r: any) => s + r.amount, 0) : 0;
      const epInv = c ? c.shop.receipts.filter((r: any) => r.type === 'Easypay').reduce((s: number, r: any) => s + r.amount, 0) : 0;
      const mgrEntry = managerEntries.find(e => e.date === ds);
      const dfCC = mgrEntry?.deepFrozenCC ?? 0;
      const ltRec = c ? c.shop.receipts.filter((r: any) => r.type === 'Lotto Receipts').reduce((s: number, r: any) => s + r.amount, 0) : 0;
      const ltPay = c ? (c.shop.lottoPayouts ?? 0) : 0;
      bld = bld - bldInv + (bldPmts.get(ds) ?? 0) + (mgrEntry?.blueLabelComm ?? 0);
      ep = ep - (epInv + dfCC) + (c?.shop.easyPay ?? 0) + (mgrEntry?.easypayComm ?? 0);
      lt = lt - (ltRec - ltPay) + (lottoPmts.get(ds) ?? 0) + (mgrEntry?.lottoComm ?? 0);
    }
    return { bld, ep, lt };
  }, [cashups, managerEntries]);

  const airtimeClosing = useMemo(() => {
    const opening = isFirstMonth
      ? { bld: SEED_BLD, ep: SEED_EASYPAY, lt: SEED_LOTTO }
      : computeAirtimeClosing(prevMonth, prevBankLines, SEED_BLD, SEED_EASYPAY, SEED_LOTTO);
    return computeAirtimeClosing(filterMonth, bankLines, opening.bld, opening.ep, opening.lt);
  }, [filterMonth, bankLines, prevBankLines, isFirstMonth, prevMonth, computeAirtimeClosing]);

  const airtimeMonthly = getMonthlyFiguresByMonth(filterMonth);
  const airtimeStatus = useMemo(() => {
    if (!airtimeMonthly) return null;
    const mBld = airtimeMonthly.airtimeBldBalance ?? 0;
    const mEp = airtimeMonthly.airtimeEasypayBalance ?? 0;
    const mLt = airtimeMonthly.airtimeLottoBalance ?? 0;
    return {
      bldOk: Math.abs((-airtimeClosing.bld) - mBld) < 2,
      epOk: Math.abs(airtimeClosing.ep - mEp) < 2,
      ltOk: Math.abs((-airtimeClosing.lt) - mLt) < 2,
    };
  }, [airtimeClosing, airtimeMonthly]);

  const rows: DayMetrics[] = days.map((day) => {
    const ds = format(day, "yyyy-MM-dd");
    const previousDay = format(new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1), "yyyy-MM-dd");
    return computeDayMetrics(ds, getCashupByDate(ds), getManagerEntryByDate(ds), reportMetricsByDate, getCashupByDate(previousDay));
  });

  // Compute seq gaps across the month
  const seqGapsMap = computeSeqGaps(days, getCashupByDate);
  for (const row of rows) {
    row.seqGaps = seqGapsMap[row.date] || [];
  }

  const handleExplanationChange = useCallback((date: string, value: string) => {
    setEditingExplanations(prev => ({ ...prev, [date]: value }));
  }, []);

  const handleExplanationBlur = useCallback(async (date: string) => {
    const value = editingExplanations[date];
    if (value === undefined) return;
    const existing = getManagerEntryByDate(date);
    if (existing) {
      await updateManagerEntry(existing.id, { explanations: value });
    } else {
      await addManagerEntry({
        date,
        cashupId: '',
        enteredBy: '',
        explanations: value,
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
        invoiceNotes: '',
        cashReconcNotes: '',
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
    }
    setEditingExplanations(prev => {
      const next = { ...prev };
      delete next[date];
      return next;
    });
  }, [editingExplanations, getManagerEntryByDate, updateManagerEntry, addManagerEntry]);

  const dataRows = rows.filter((r) => r.hasData);
  const totalShopDiff = dataRows.reduce((s, r) => s + (r.shopDiff ?? 0), 0);
  const greenCount = dataRows.filter((r) => {
    const shopOk = r.shopDiff !== null && Math.abs(r.shopDiff) < 20;
    const optOk = r.optDiff === null || Math.abs(r.optDiff) < 0.01;
    const payoutsOk = r.payoutsDiff === null || Math.abs(r.payoutsDiff) < 0.5;
    const invOk = r.invMatch === null || r.invMatch;
    const vatOk = r.vatMatch === null || r.vatMatch;
    return shopOk && optOk && payoutsOk && invOk && vatOk;
  }).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-blue-700">{format(monthStart, "MMMM yyyy")} - Monthly Overview</h2>
          <p className="text-sm text-muted-foreground">
            {dataRows.length} day{dataRows.length !== 1 ? "s" : ""} captured · {greenCount} balanced
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Month Shop Short/(Over)</div>
          <CurrencyDisplay value={totalShopDiff} highlight className="text-lg" />
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-center px-1 py-2 font-semibold text-muted-foreground w-8 border-r text-xs">Status</th>
                <th className="text-center px-1 py-2 font-semibold text-muted-foreground border-r text-xs">Date</th>
                <th className="text-center px-1 py-2 font-semibold text-muted-foreground border-r text-xs">Entered By</th>
                <th className="text-center px-1 py-2 font-semibold text-muted-foreground border-r text-xs">Shop Till</th>
                <th className="text-center px-1 py-2 font-semibold text-muted-foreground border-r text-xs">Payouts</th>
                <th className="text-center px-1 py-2 font-semibold text-muted-foreground border-r text-xs">OPT</th>
                <th className="text-center px-1 py-2 font-semibold text-muted-foreground border-r text-xs">Invoices</th>
                <th className="text-center px-1 py-2 font-semibold text-muted-foreground border-r text-xs">VAT</th>
                <th className="text-center px-1 py-2 font-semibold text-muted-foreground border-r text-xs">Seq #</th>
                <th className="text-center px-1 py-2 font-semibold text-muted-foreground" style={{ width: '35%' }}>Explanation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const d = parseISO(row.date);
                if (!row.hasData) {
                  return (
                    <tr key={row.date} className="border-b last:border-b-0 bg-muted/10">
                      <td className="px-1 py-1 border-r"><StatusIcon status="none" /></td>
                      <td className="px-1 py-1 text-center text-muted-foreground/40 border-r text-xs">{format(d, "EEE dd")}</td>
                      <td colSpan={8} className="px-1 py-1 text-muted-foreground/30 text-center italic text-xs">
                        No data
                      </td>
                    </tr>
                  );
                }

                const shopOk = row.shopDiff !== null && Math.abs(row.shopDiff) < 20;
                const optOk = row.optDiff === null || Math.abs(row.optDiff) < 0.01;
                const showOpt = row.optDiff !== null && Math.abs(row.optDiff) >= 0.01;
                const payoutsOk = row.payoutsDiff === null || Math.abs(row.payoutsDiff) < 0.5;
                const invOk = row.invMatch === null || row.invMatch;
                const vatOk = row.vatMatch === null || row.vatMatch;
                const seqOk = row.seqGaps.length === 0;
                const allOk = shopOk && optOk && payoutsOk && invOk && vatOk;

                return (
                  <tr key={row.date} className={`border-b last:border-b-0 ${allOk ? "" : "bg-red-50/50"}`}>
                    <td className="px-1 py-1 border-r">
                      <div className="flex justify-center">
                        {allOk ? (
                          <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
                        ) : (
                          <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
                        )}
                      </div>
                    </td>
                    <td className="px-1 py-1 text-center font-medium border-r text-xs whitespace-nowrap">
                      {onNavigateToDate ? (
                        <button
                          type="button"
                          className="text-primary underline hover:text-primary/80"
                          onClick={() => onNavigateToDate(row.date)}
                        >
                          {format(d, "EEE dd")}
                        </button>
                      ) : (
                        format(d, "EEE dd")
                      )}
                    </td>
                    <td className="px-1 py-1 text-center text-muted-foreground border-r text-xs">{row.enteredBy || "—"}</td>
                    <td className="px-1 py-1 text-center border-r">
                      {row.shopDiff !== null ? (
                        <span className={`inline-flex items-center justify-center font-mono text-xs ${shopOk ? "text-green-700" : "text-red-600 font-semibold"}`}>
                          <CurrencyDisplay value={row.shopDiff} />
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </td>
                    <td className="px-1 py-1 text-center border-r">
                      {row.payoutsDiff !== null ? (
                        <span className={`inline-flex items-center justify-center font-mono text-xs ${payoutsOk ? "text-green-700" : "text-red-600 font-semibold"}`}>
                          {payoutsOk ? "✓" : <CurrencyDisplay value={row.payoutsDiff} />}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </td>
                    <td className="px-1 py-1 text-center border-r">
                      {showOpt ? (
                        <span className="inline-flex items-center justify-center font-mono text-xs text-red-600 font-semibold">
                          <CurrencyDisplay value={row.optDiff!} />
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </td>
                    <td className="px-1 py-1 border-r">
                      <div className="flex justify-center">
                        {row.invMatch !== null ? (
                          <StatusIcon status={invOk ? "green" : "red"} />
                        ) : (
                          <StatusIcon status="none" />
                        )}
                      </div>
                    </td>
                    <td className="px-1 py-1 border-r">
                      <div className="flex justify-center">
                        {row.vatMatch !== null ? (
                          <StatusIcon status={vatOk ? "green" : "red"} />
                        ) : (
                          <StatusIcon status="none" />
                        )}
                      </div>
                    </td>
                    <td className="px-1 py-1 text-center border-r">
                      {row.seqHasReceipts ? (
                        seqOk ? (
                          <span className="text-green-700 text-xs font-mono">✓</span>
                        ) : (
                          <span className="text-red-600 text-xs font-semibold">{row.seqGaps.join(", ")}</span>
                        )
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </td>
                    <td className="px-1 py-1">
                      <textarea
                        className="w-full min-h-[28px] text-xs rounded-md border border-input bg-background px-2 py-1 resize-none overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        rows={1}
                        placeholder={allOk ? "" : "Explain variance..."}
                        value={editingExplanations[row.date] ?? (getManagerEntryByDate(row.date)?.explanations || getCashupByDate(row.date)?.notes || "")}
                        onChange={(e) => {
                          handleExplanationChange(row.date, e.target.value);
                          e.target.style.height = 'auto';
                          e.target.style.height = e.target.scrollHeight + 'px';
                        }}
                        onBlur={() => handleExplanationBlur(row.date)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {dataRows.length > 0 && (
              <tfoot>
                <tr className="bg-muted/50 border-t-2 font-semibold text-xs">
                  <td colSpan={3} className="px-1 py-2 text-center border-r">
                    Total
                  </td>
                  <td className="px-1 py-2 text-center border-r">
                    <CurrencyDisplay value={totalShopDiff} highlight />
                  </td>
                  <td className="px-1 py-2 text-center border-r">
                    <CurrencyDisplay value={dataRows.reduce((s, r) => s + (r.payoutsDiff ?? 0), 0)} highlight />
                  </td>
                  <td className="px-1 py-2 text-center border-r">
                    <CurrencyDisplay
                      value={dataRows.reduce(
                        (s, r) => s + (r.optDiff !== null && Math.abs(r.optDiff) >= 0.01 ? r.optDiff : 0),
                        0,
                      )}
                    />
                  </td>
                  <td className="px-1 py-2 text-center text-xs text-muted-foreground border-r">
                    {dataRows.filter((r) => r.invMatch === true).length}/
                    {dataRows.filter((r) => r.invMatch !== null).length}
                  </td>
                  <td className="px-1 py-2 text-center text-xs text-muted-foreground border-r">
                    {dataRows.filter((r) => r.vatMatch === true).length}/
                    {dataRows.filter((r) => r.vatMatch !== null).length}
                  </td>
                  <td className="px-1 py-2 text-center text-xs text-muted-foreground border-r">
                    {dataRows.filter((r) => r.seqHasReceipts && r.seqGaps.length === 0).length}/
                    {dataRows.filter((r) => r.seqHasReceipts).length}
                  </td>
                  <td className="px-1 py-2 text-center text-xs">
                    {greenCount}/{dataRows.length}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Airtime Recon Reconciliation */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-muted/50 px-3 py-2 border-b font-semibold text-sm">
          Airtime / Lotto Reconciliation
        </div>
        <div className="grid grid-cols-3 gap-0 text-sm">
          {[
            { label: 'Blue Label', ok: airtimeStatus?.bldOk ?? null },
            { label: 'Easy Pay', ok: airtimeStatus?.epOk ?? null },
            { label: 'Lotto', ok: airtimeStatus?.ltOk ?? null },
          ].map(({ label, ok }) => (
            <div key={label} className={`flex items-center justify-center gap-2 px-3 py-3 border-r last:border-r-0 ${
              ok === null ? 'bg-muted/20' : ok ? 'bg-green-50 dark:bg-green-950/20' : 'bg-red-50 dark:bg-red-950/20'
            }`}>
              {ok === null ? (
                <MinusCircle className="h-4 w-4 text-muted-foreground/40" />
              ) : ok ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : (
                <XCircle className="h-4 w-4 text-red-600" />
              )}
              <span className={`text-xs font-semibold ${
                ok === null ? 'text-muted-foreground' : ok ? 'text-green-700' : 'text-red-600'
              }`}>
                {label}: {ok === null ? 'No data' : ok ? 'PASS' : 'FAIL'}
              </span>
            </div>
          ))}
        </div>
        {!airtimeMonthly && (
          <div className="text-xs text-muted-foreground text-center py-1 border-t">
            No monthly figures entered — enter in Manager Monthly Section 4
          </div>
        )}
      </div>
    </div>
  );
}
