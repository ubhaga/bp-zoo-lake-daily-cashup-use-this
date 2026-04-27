import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useCashupStore } from "@/store/cashupStore";
import { supabase } from "@/integrations/supabase/client";
import { CurrencyDisplay } from "@/components/ui/CashupUI";
import { SourceLink } from "@/components/ui/SourceLink";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Download, Pencil } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { downloadCsv } from "@/lib/csvExport";
import { parseBankStatementDate } from "@/lib/bankStatementDate";
import { useReconAdjustments } from "@/hooks/useReconAdjustments";
import { ReconAdjustDialog } from "./ReconAdjustDialog";

interface AirtimeReconProps {
  filterMonth: string;
}

export function AirtimeRecon({ filterMonth }: AirtimeReconProps) {
  const { cashups, managerEntries, getMonthlyFiguresByMonth } = useCashupStore();

  type BankLine = { id: string; amount: number; description: string; transaction_date: string };
  const [bankLines, setBankLines] = useState<BankLine[]>([]);
  const [prevBankLines, setPrevBankLines] = useState<typeof bankLines>([]);
  const [allocByLine, setAllocByLine] = useState<Map<string, string>>(new Map());
  const [prevAllocByLine, setPrevAllocByLine] = useState<Map<string, string>>(new Map());

  const isFirstMonth = filterMonth === "2026-03";
  const prevMonth = useMemo(() => {
    const d = new Date(filterMonth + "-01");
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  }, [filterMonth]);

  const loadData = useCallback(async () => {
    const bankQuery = supabase
      .from("bank_statement_lines")
      .select("id, amount, description, transaction_date")
      .eq("month", filterMonth);
    const prevBankQuery = !isFirstMonth
      ? supabase.from("bank_statement_lines").select("id, amount, description, transaction_date").eq("month", prevMonth)
      : null;
    const allocQuery = supabase
      .from("bank_line_allocations")
      .select("bank_line_id, recon_type")
      .eq("month", filterMonth);
    const prevAllocQuery = !isFirstMonth
      ? supabase.from("bank_line_allocations").select("bank_line_id, recon_type").eq("month", prevMonth)
      : null;

    const [bankRes, prevBankRes, allocRes, prevAllocRes] = await Promise.all([
      bankQuery,
      prevBankQuery,
      allocQuery,
      prevAllocQuery,
    ]);
    setBankLines(((bankRes as any)?.data ?? []) as typeof bankLines);

    if (!isFirstMonth && prevBankRes) {
      setPrevBankLines(((prevBankRes as any)?.data ?? []) as typeof bankLines);
    }

    const m = new Map<string, string>();
    (((allocRes as any)?.data ?? []) as { bank_line_id: string; recon_type: string }[]).forEach((a) =>
      m.set(a.bank_line_id, a.recon_type),
    );
    setAllocByLine(m);

    const pm = new Map<string, string>();
    if (prevAllocRes) {
      (((prevAllocRes as any)?.data ?? []) as { bank_line_id: string; recon_type: string }[]).forEach((a) =>
        pm.set(a.bank_line_id, a.recon_type),
      );
    }
    setPrevAllocByLine(pm);
  }, [filterMonth, isFirstMonth, prevMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const DEFAULT_SEED_BLD = -11906.34;
  const DEFAULT_SEED_EASYPAY = 14392.59;
  const DEFAULT_SEED_LOTTO = -2504.03;

  // Opening-balance overrides are stored against month '2026-03' only.
  // The stored amount REPLACES the default seed (override semantics).
  // It flows into every subsequent month via the recursive computeClosing chain.
  const { adjustments: openAdjs, saveAdjustment: saveOpenAdj } = useReconAdjustments(
    "airtime",
    "2026-03",
  );
  // Timing adjustments stored against the current filtered month.
  const { adjustments: monthAdjs, saveAdjustment: saveMonthAdj } = useReconAdjustments(
    "airtime",
    filterMonth,
  );
  const getTiming = (name: "bld" | "easypay" | "lotto"): number => {
    const row = monthAdjs.find(
      (a) => a.target_name === name && a.field === "timing_adjustment" && a.week_index === null,
    );
    return row?.amount ?? 0;
  };
  const timingBld = getTiming("bld");
  const timingEp = getTiming("easypay");
  const timingLt = getTiming("lotto");
  const getOverride = (name: "bld" | "easypay" | "lotto"): number | null => {
    const row = openAdjs.find(
      (a) => a.target_name === name && a.field === "opening_balance" && a.week_index === null,
    );
    return row ? row.amount : null;
  };
  const SEED_BLD = getOverride("bld") ?? DEFAULT_SEED_BLD;
  const SEED_EASYPAY = getOverride("easypay") ?? DEFAULT_SEED_EASYPAY;
  const SEED_LOTTO = getOverride("lotto") ?? DEFAULT_SEED_LOTTO;

  const [editTarget, setEditTarget] = useState<null | { name: "bld" | "easypay" | "lotto"; defaultValue: number; label: string }>(null);
  const [editTiming, setEditTiming] = useState<null | { name: "bld" | "easypay" | "lotto"; label: string }>(null);

  const parseBankDate = (dateStr: string): string | null => parseBankStatementDate(dateStr);

  // Helper to compute closing balances for a given month's data
  const computeClosing = (
    monthStr: string,
    lines: typeof bankLines,
    openBld: number,
    openEp: number,
    openLt: number,
    allocs: Map<string, string>,
  ) => {
    const mStart = startOfMonth(new Date(monthStr + "-01"));
    const mEnd = endOfMonth(mStart);
    const mDays = eachDayOfInterval({ start: mStart, end: mEnd });
    const mCashups = new Map(cashups.filter((c) => c.month === monthStr).map((c) => [c.date, c]));

    const bldPmts = new Map<string, number>();
    const lottoPmts = new Map<string, number>();
    lines.forEach((line) => {
      const desc = line.description.toUpperCase().trim();
      const dateStr = parseBankDate(line.transaction_date);
      if (!dateStr) return;
      const reconType = allocs.get(line.id);
      const isBld = reconType === "bld" || (!reconType && (desc.includes("BLD DO") || desc.includes("BLUE LABEL")));
      const isLotto = reconType === "lotto" || (!reconType && desc.includes("ITHUCOLL"));
      if (isBld) {
        bldPmts.set(dateStr, (bldPmts.get(dateStr) ?? 0) + Math.abs(line.amount));
      }
      if (isLotto) {
        lottoPmts.set(dateStr, (lottoPmts.get(dateStr) ?? 0) + Math.abs(line.amount));
      }
    });

    let bld = openBld,
      ep = openEp,
      lt = openLt;
    for (const day of mDays) {
      const ds = format(day, "yyyy-MM-dd");
      const c = mCashups.get(ds);
      const bldInv = c
        ? c.shop.receipts.filter((r: any) => r.type === "Blue Label").reduce((s: number, r: any) => s + r.amount, 0)
        : 0;
      const epInv = c
        ? c.shop.receipts.filter((r: any) => r.type === "Easypay").reduce((s: number, r: any) => s + r.amount, 0)
        : 0;
      const mgrEntry = managerEntries.find((e) => e.date === ds);
      const dfCC = mgrEntry?.deepFrozenCC ?? 0;
      const ltRec = c
        ? c.shop.receipts.filter((r: any) => r.type === "Lotto Receipts").reduce((s: number, r: any) => s + r.amount, 0)
        : 0;
      const ltPay = c ? (c.shop.lottoPayouts ?? 0) : 0;
      // Manager daily commissions as payments
      const bldComm = mgrEntry?.blueLabelComm ?? 0;
      const epComm = mgrEntry?.easypayComm ?? 0;
      const ltComm = mgrEntry?.lottoComm ?? 0;
      bld = bld - bldInv + (bldPmts.get(ds) ?? 0) + bldComm;
      ep = ep - (epInv + dfCC) + (c?.shop.easyPay ?? 0) + epComm;
      lt = lt - (ltRec - ltPay) + (lottoPmts.get(ds) ?? 0) + ltComm;
    }
    return { bld, ep, lt };
  };

  // Compute opening balances
  const openingBalances = useMemo(() => {
    if (isFirstMonth) return { bld: SEED_BLD, ep: SEED_EASYPAY, lt: SEED_LOTTO };
    const prevClosing = computeClosing(prevMonth, prevBankLines, SEED_BLD, SEED_EASYPAY, SEED_LOTTO, prevAllocByLine);
    return prevClosing;
  }, [isFirstMonth, prevMonth, prevBankLines, prevAllocByLine, cashups, managerEntries]);

  const monthStart = startOfMonth(new Date(filterMonth + "-01"));
  const monthEnd = endOfMonth(monthStart);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const cashupByDate = new Map(cashups.filter((c) => c.month === filterMonth).map((c) => [c.date, c]));

  const bldPaymentsByDate = new Map<string, number>();
  bankLines.forEach((line) => {
    const desc = line.description.toUpperCase().trim();
    const reconType = allocByLine.get(line.id);
    const isBld = reconType === "bld" || (!reconType && (desc.includes("BLD DO") || desc.includes("BLUE LABEL")));
    if (isBld) {
      const dateStr = parseBankDate(line.transaction_date);
      if (dateStr) {
        bldPaymentsByDate.set(dateStr, (bldPaymentsByDate.get(dateStr) ?? 0) + Math.abs(line.amount));
      }
    }
  });

  const lottoPaymentsByDate = new Map<string, number>();
  bankLines.forEach((line) => {
    const desc = line.description.toUpperCase().trim();
    const reconType = allocByLine.get(line.id);
    const isLotto = reconType === "lotto" || (!reconType && desc.includes("ITHUCOLL"));
    if (isLotto) {
      const dateStr = parseBankDate(line.transaction_date);
      if (dateStr) {
        lottoPaymentsByDate.set(dateStr, (lottoPaymentsByDate.get(dateStr) ?? 0) + Math.abs(line.amount));
      }
    }
  });

  type DayRow = {
    date: string;
    bldInvoice: number;
    bldPayment: number;
    easypayInvoice: number;
    easypayCollection: number;
    lottoInvoice: number;
    lottoPayment: number;
    // Commission amounts shown separately
    bldComm: number;
    epComm: number;
    ltComm: number;
  };

  const dailyRows: DayRow[] = days.map((day) => {
    const dateStr = format(day, "yyyy-MM-dd");
    const cashup = cashupByDate.get(dateStr);

    const bldInvoice = cashup
      ? cashup.shop.receipts.filter((r) => r.type === "Blue Label").reduce((s, r) => s + r.amount, 0)
      : 0;
    const easypayInvoice = cashup
      ? cashup.shop.receipts.filter((r) => r.type === "Easypay").reduce((s, r) => s + r.amount, 0)
      : 0;
    const managerEntry = managerEntries.find((e) => e.date === dateStr);
    const deepFrozenCC = managerEntry?.deepFrozenCC ?? 0;
    const bldComm = managerEntry?.blueLabelComm ?? 0;
    const epComm = managerEntry?.easypayComm ?? 0;
    const ltComm = managerEntry?.lottoComm ?? 0;
    const lottoReceipts = cashup
      ? cashup.shop.receipts.filter((r) => r.type === "Lotto Receipts").reduce((s, r) => s + r.amount, 0)
      : 0;
    const lottoPayouts = cashup ? (cashup.shop.lottoPayouts ?? 0) : 0;
    const lottoInvoice = lottoReceipts - lottoPayouts;

    return {
      date: dateStr,
      bldInvoice,
      bldPayment: bldPaymentsByDate.get(dateStr) ?? 0,
      easypayInvoice: easypayInvoice + deepFrozenCC,
      easypayCollection: cashup?.shop.easyPay ?? 0,
      lottoInvoice,
      lottoPayment: lottoPaymentsByDate.get(dateStr) ?? 0,
      bldComm,
      epComm,
      ltComm,
    };
  });

  let bldBalance = openingBalances.bld;
  let easypayBalance = openingBalances.ep;
  let lottoBalance = openingBalances.lt;

  return (
    <div className="space-y-4">
      <div className="bg-card border rounded-lg overflow-x-clip">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
          <h3 className="font-semibold text-sm">Airtime / Lotto Reconciliation — {format(monthStart, "MMMM yyyy")}</h3>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                let bld = openingBalances.bld,
                  ep = openingBalances.ep,
                  lt = openingBalances.lt;
                const csvRows: any[][] = [];
                dailyRows.forEach((r) => {
                  bld = bld - r.bldInvoice + r.bldPayment;
                  ep = ep - r.easypayInvoice + r.easypayCollection;
                  lt = lt - r.lottoInvoice + r.lottoPayment;
                  csvRows.push([
                    r.date,
                    r.bldInvoice,
                    r.bldPayment,
                    bld,
                    r.easypayInvoice,
                    r.easypayCollection,
                    ep,
                    r.lottoInvoice,
                    r.lottoPayment,
                    lt,
                  ]);
                  if (r.bldComm || r.epComm || r.ltComm) {
                    bld += r.bldComm;
                    ep += r.epComm;
                    lt += r.ltComm;
                    csvRows.push([r.date + " (Comm)", "", r.bldComm, bld, "", r.epComm, ep, "", r.ltComm, lt]);
                  }
                });
                csvRows.push(["Final Balance", "", "", bld, "", "", ep, "", "", lt]);
                downloadCsv(
                  [
                    "Date",
                    "BLD Invoice",
                    "BLD Payment",
                    "BLD Balance",
                    "Easypay Invoice",
                    "Easypay Collection",
                    "Easypay Balance",
                    "Lotto Invoice",
                    "Lotto Payment",
                    "Lotto Balance",
                  ],
                  csvRows,
                  `airtime-lotto-recon-${filterMonth}.csv`,
                );
              }}
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[80px]" rowSpan={2}>
                  Date
                </TableHead>
                <TableHead colSpan={3} className="text-center border-l bg-destructive/5">
                  BLD (Creditor)
                </TableHead>
                <TableHead colSpan={3} className="text-center border-l bg-primary/5">
                  Easypay (Debtor)
                </TableHead>
                <TableHead colSpan={3} className="text-center border-l bg-accent/30">
                  Lotto (Creditor)
                </TableHead>
              </TableRow>
              <TableRow>
                <TableHead className="text-right text-xs border-l min-w-[90px]">+ Invoice</TableHead>
                <TableHead className="text-right text-xs min-w-[90px]">− Payment</TableHead>
                <TableHead className="text-right text-xs font-semibold min-w-[100px]">Balance</TableHead>
                <TableHead className="text-right text-xs border-l min-w-[90px]">+ Invoice</TableHead>
                <TableHead className="text-right text-xs min-w-[90px]">− Collection</TableHead>
                <TableHead className="text-right text-xs font-semibold min-w-[100px]">Balance</TableHead>
                <TableHead className="text-right text-xs border-l min-w-[90px]">+ Invoice</TableHead>
                <TableHead className="text-right text-xs min-w-[90px]">− Payment</TableHead>
                <TableHead className="text-right text-xs font-semibold min-w-[100px]">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Opening Balance */}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell className="text-xs">Opening Balance</TableCell>
                <TableCell className="border-l"></TableCell>
                <TableCell></TableCell>
                <TableCell className="text-right text-xs">
                  <span className="inline-flex items-center gap-1">
                    <CurrencyDisplay value={openingBalances.bld} />
                    {isFirstMonth && (
                      <button
                        type="button"
                        onClick={() => setEditTarget({ name: "bld", defaultValue: DEFAULT_SEED_BLD, label: "BLD opening balance (Mar 2026)" })}
                        className="text-muted-foreground hover:text-primary"
                        title="Edit opening balance"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                </TableCell>
                <TableCell className="border-l"></TableCell>
                <TableCell></TableCell>
                <TableCell className="text-right text-xs">
                  <span className="inline-flex items-center gap-1">
                    <CurrencyDisplay value={openingBalances.ep} />
                    {isFirstMonth && (
                      <button
                        type="button"
                        onClick={() => setEditTarget({ name: "easypay", defaultValue: DEFAULT_SEED_EASYPAY, label: "Easypay opening balance (Mar 2026)" })}
                        className="text-muted-foreground hover:text-primary"
                        title="Edit opening balance"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                </TableCell>
                <TableCell className="border-l"></TableCell>
                <TableCell></TableCell>
                <TableCell className="text-right text-xs">
                  <span className="inline-flex items-center gap-1">
                    <CurrencyDisplay value={openingBalances.lt} />
                    {isFirstMonth && (
                      <button
                        type="button"
                        onClick={() => setEditTarget({ name: "lotto", defaultValue: DEFAULT_SEED_LOTTO, label: "Lotto opening balance (Mar 2026)" })}
                        className="text-muted-foreground hover:text-primary"
                        title="Edit opening balance"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                </TableCell>
              </TableRow>
              {dailyRows.map((row) => {
                bldBalance = bldBalance - row.bldInvoice + row.bldPayment;
                easypayBalance = easypayBalance - row.easypayInvoice + row.easypayCollection;
                lottoBalance = lottoBalance - row.lottoInvoice + row.lottoPayment;

                const hasData =
                  row.bldInvoice !== 0 ||
                  row.bldPayment > 0 ||
                  row.easypayInvoice !== 0 ||
                  row.easypayCollection > 0 ||
                  row.lottoInvoice !== 0 ||
                  row.lottoPayment > 0;
                const hasComm = row.bldComm !== 0 || row.epComm !== 0 || row.ltComm !== 0;

                const dayRow = (
                  <TableRow key={row.date} className={!hasData && !hasComm ? "opacity-50" : ""}>
                    <TableCell className="text-xs">
                      <SourceLink date={row.date} source="cashier">{format(new Date(row.date), "dd MMM (EEE)")}</SourceLink>
                    </TableCell>
                    <TableCell className="text-right text-xs border-l">
                      {row.bldInvoice > 0 ? (
                        <SourceLink date={row.date} source="cashier"><CurrencyDisplay value={row.bldInvoice} /></SourceLink>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {row.bldPayment > 0 ? (
                        <span className="text-destructive">
                          <CurrencyDisplay value={row.bldPayment} />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold bg-destructive/10">
                      <CurrencyDisplay value={bldBalance} />
                    </TableCell>
                    <TableCell className="text-right text-xs border-l">
                      {row.easypayInvoice > 0 ? (
                        <SourceLink date={row.date} source="cashier"><CurrencyDisplay value={row.easypayInvoice} /></SourceLink>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {row.easypayCollection > 0 ? (
                        <SourceLink date={row.date} source="cashier" className="text-destructive"><CurrencyDisplay value={row.easypayCollection} /></SourceLink>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold bg-primary/10">
                      <CurrencyDisplay value={easypayBalance} />
                    </TableCell>
                    <TableCell className="text-right text-xs border-l">
                      {row.lottoInvoice !== 0 ? (
                        <SourceLink date={row.date} source="cashier"><CurrencyDisplay value={row.lottoInvoice} /></SourceLink>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {row.lottoPayment > 0 ? (
                        <span className="text-destructive">
                          <CurrencyDisplay value={row.lottoPayment} />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold bg-accent/20">
                      <CurrencyDisplay value={lottoBalance} />
                    </TableCell>
                  </TableRow>
                );

                // Commission row (separate from payments)
                let commRow: React.ReactNode = null;
                if (hasComm) {
                  bldBalance += row.bldComm;
                  easypayBalance += row.epComm;
                  lottoBalance += row.ltComm;
                  commRow = (
                    <TableRow
                      key={row.date + "-comm"}
                      className="bg-blue-50 dark:bg-blue-950/20 italic border-l-4 border-l-blue-500"
                    >
                      <TableCell className="text-xs text-blue-700 dark:text-blue-400 font-semibold pl-6">
                        Commission
                      </TableCell>
                      <TableCell className="border-l"></TableCell>
                      <TableCell className="text-right text-xs">
                        {row.bldComm !== 0 ? (
                          <SourceLink date={row.date} source="manager-daily" className="text-blue-600 dark:text-blue-400 font-semibold">
                            <CurrencyDisplay value={row.bldComm} />
                          </SourceLink>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold bg-destructive/10">
                        <CurrencyDisplay value={bldBalance} />
                      </TableCell>
                      <TableCell className="border-l"></TableCell>
                      <TableCell className="text-right text-xs">
                        {row.epComm !== 0 ? (
                          <SourceLink date={row.date} source="manager-daily" className="text-blue-600 dark:text-blue-400 font-semibold">
                            <CurrencyDisplay value={row.epComm} />
                          </SourceLink>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold bg-primary/10">
                        <CurrencyDisplay value={easypayBalance} />
                      </TableCell>
                      <TableCell className="border-l"></TableCell>
                      <TableCell className="text-right text-xs">
                        {row.ltComm !== 0 ? (
                          <SourceLink date={row.date} source="manager-daily" className="text-blue-600 dark:text-blue-400 font-semibold">
                            <CurrencyDisplay value={row.ltComm} />
                          </SourceLink>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold bg-accent/20">
                        <CurrencyDisplay value={lottoBalance} />
                      </TableCell>
                    </TableRow>
                  );
                }

                return (
                  <React.Fragment key={row.date}>
                    {dayRow}
                    {commRow}
                  </React.Fragment>
                );
              })}
              {/* Closing before commission */}
              <TableRow className="bg-secondary font-semibold">
                <TableCell className="text-xs">Closing Balance</TableCell>
                <TableCell className="text-right text-xs border-l">
                  <CurrencyDisplay value={dailyRows.reduce((s, r) => s + r.bldInvoice, 0)} highlight />
                </TableCell>
                <TableCell className="text-right text-xs">
                  <CurrencyDisplay value={dailyRows.reduce((s, r) => s + r.bldPayment + r.bldComm, 0)} highlight />
                </TableCell>
                <TableCell className="text-right text-xs font-bold">
                  <CurrencyDisplay value={bldBalance} highlight />
                </TableCell>
                <TableCell className="text-right text-xs border-l">
                  <CurrencyDisplay value={dailyRows.reduce((s, r) => s + r.easypayInvoice, 0)} highlight />
                </TableCell>
                <TableCell className="text-right text-xs">
                  <CurrencyDisplay
                    value={dailyRows.reduce((s, r) => s + r.easypayCollection + r.epComm, 0)}
                    highlight
                  />
                </TableCell>
                <TableCell className="text-right text-xs font-bold">
                  <CurrencyDisplay value={easypayBalance} highlight />
                </TableCell>
                <TableCell className="text-right text-xs border-l">
                  <CurrencyDisplay value={dailyRows.reduce((s, r) => s + r.lottoInvoice, 0)} highlight />
                </TableCell>
                <TableCell className="text-right text-xs">
                  <CurrencyDisplay value={dailyRows.reduce((s, r) => s + r.lottoPayment + r.ltComm, 0)} highlight />
                </TableCell>
                <TableCell className="text-right text-xs font-bold">
                  <CurrencyDisplay value={lottoBalance} highlight />
                </TableCell>
              </TableRow>
              {/* Timing Adjustments (manager-entered) */}
              <TableRow className="bg-amber-50 dark:bg-amber-950/20">
                <TableCell className="text-xs font-semibold">Timing Adjustments</TableCell>
                <TableCell className="border-l" colSpan={2}></TableCell>
                <TableCell className="text-right text-xs">
                  <span className="inline-flex items-center gap-1">
                    <CurrencyDisplay value={timingBld} />
                    <button
                      type="button"
                      onClick={() => setEditTiming({ name: "bld", label: `BLD timing adjustment (${format(monthStart, "MMM yyyy")})` })}
                      className="text-muted-foreground hover:text-primary"
                      title="Edit timing adjustment"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </span>
                </TableCell>
                <TableCell className="border-l" colSpan={2}></TableCell>
                <TableCell className="text-right text-xs">
                  <span className="inline-flex items-center gap-1">
                    <CurrencyDisplay value={timingEp} />
                    <button
                      type="button"
                      onClick={() => setEditTiming({ name: "easypay", label: `Easypay timing adjustment (${format(monthStart, "MMM yyyy")})` })}
                      className="text-muted-foreground hover:text-primary"
                      title="Edit timing adjustment"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </span>
                </TableCell>
                <TableCell className="border-l" colSpan={2}></TableCell>
                <TableCell className="text-right text-xs">
                  <span className="inline-flex items-center gap-1">
                    <CurrencyDisplay value={timingLt} />
                    <button
                      type="button"
                      onClick={() => setEditTiming({ name: "lotto", label: `Lotto timing adjustment (${format(monthStart, "MMM yyyy")})` })}
                      className="text-muted-foreground hover:text-primary"
                      title="Edit timing adjustment"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </span>
                </TableCell>
              </TableRow>
              {/* Adjusted closing balance (used to match Monthly Report) */}
              <TableRow className="bg-secondary font-semibold border-t-2">
                <TableCell className="text-xs">Closing Balance (Adjusted)</TableCell>
                <TableCell className="border-l" colSpan={2}></TableCell>
                <TableCell className="text-right text-xs font-bold">
                  <CurrencyDisplay value={bldBalance + timingBld} highlight />
                </TableCell>
                <TableCell className="border-l" colSpan={2}></TableCell>
                <TableCell className="text-right text-xs font-bold">
                  <CurrencyDisplay value={easypayBalance + timingEp} highlight />
                </TableCell>
                <TableCell className="border-l" colSpan={2}></TableCell>
                <TableCell className="text-right text-xs font-bold">
                  <CurrencyDisplay value={lottoBalance + timingLt} highlight />
                </TableCell>
              </TableRow>
              {/* Status bar comparing with Manager Monthly Section 4 */}
              {(() => {
                const monthly = getMonthlyFiguresByMonth(filterMonth);
                const mBld = monthly?.airtimeBldBalance ?? 0;
                const mEp = monthly?.airtimeEasypayBalance ?? 0;
                const mLt = monthly?.airtimeLottoBalance ?? 0;
                const adjBld = bldBalance + timingBld;
                const adjEp = easypayBalance + timingEp;
                const adjLt = lottoBalance + timingLt;
                const diffBld = Math.abs(-adjBld - mBld) < 2 ? 0 : -adjBld - mBld;
                const diffEp = Math.abs(adjEp - mEp) < 2 ? 0 : adjEp - mEp;
                const diffLt = Math.abs(-adjLt - mLt) < 2 ? 0 : -adjLt - mLt;
                const allMatch = diffBld === 0 && diffEp === 0 && diffLt === 0;
                const hasMonthly = !!monthly;
                return (
                  <TableRow
                    className={
                      allMatch && hasMonthly ? "bg-green-50 dark:bg-green-950/20" : "bg-red-50 dark:bg-red-950/20"
                    }
                  >
                    <TableCell className="text-xs font-semibold" colSpan={1}>
                      {!hasMonthly
                        ? "⚠️ No Monthly figures entered"
                        : allMatch
                          ? "✅ Matches Monthly Report"
                          : "❌ Mismatch vs Monthly Report"}
                    </TableCell>
                    <TableCell className="border-l" colSpan={2}></TableCell>
                    <TableCell className="text-right text-xs font-semibold">
                      {hasMonthly &&
                        (diffBld === 0 ? (
                          <span className="text-green-600">✓ Match</span>
                        ) : (
                          <span className="text-destructive">
                            Diff: <CurrencyDisplay value={diffBld} />
                          </span>
                        ))}
                    </TableCell>
                    <TableCell className="border-l" colSpan={2}></TableCell>
                    <TableCell className="text-right text-xs font-semibold">
                      {hasMonthly &&
                        (diffEp === 0 ? (
                          <span className="text-green-600">✓ Match</span>
                        ) : (
                          <span className="text-destructive">
                            Diff: <CurrencyDisplay value={diffEp} />
                          </span>
                        ))}
                    </TableCell>
                    <TableCell className="border-l" colSpan={2}></TableCell>
                    <TableCell className="text-right text-xs font-semibold">
                      {hasMonthly &&
                        (diffLt === 0 ? (
                          <span className="text-green-600">✓ Match</span>
                        ) : (
                          <span className="text-destructive">
                            Diff: <CurrencyDisplay value={diffLt} />
                          </span>
                        ))}
                    </TableCell>
                  </TableRow>
                );
              })()}
            </TableBody>
          </Table>
        </div>
      </div>
      {editTarget && (
        <ReconAdjustDialog
          open={!!editTarget}
          onOpenChange={(o) => { if (!o) setEditTarget(null); }}
          reconType="airtime"
          month="2026-03"
          targetName={editTarget.name}
          field="opening_balance"
          weekIndex={null}
          autoAmount={editTarget.defaultValue}
          currentAdjustment={getOverride(editTarget.name) ?? editTarget.defaultValue}
          fieldLabel={editTarget.label}
          isOverride={true}
          onSave={async (newAmount, changedBy, reason) => {
            await saveOpenAdj({
              target_name: editTarget.name,
              field: "opening_balance",
              week_index: null,
              new_amount: newAmount,
              changed_by: changedBy,
              reason,
            });
          }}
        />
      )}
      {editTiming && (
        <ReconAdjustDialog
          open={!!editTiming}
          onOpenChange={(o) => { if (!o) setEditTiming(null); }}
          reconType="airtime"
          month={filterMonth}
          targetName={editTiming.name}
          field="timing_adjustment"
          weekIndex={null}
          autoAmount={0}
          currentAdjustment={getTiming(editTiming.name)}
          fieldLabel={editTiming.label}
          isOverride={true}
          onSave={async (newAmount, changedBy, reason) => {
            await saveMonthAdj({
              target_name: editTiming.name,
              field: "timing_adjustment",
              week_index: null,
              new_amount: newAmount,
              changed_by: changedBy,
              reason,
            });
          }}
        />
      )}
    </div>
  );
}
