import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useCashupStore } from '@/store/cashupStore';
import { useMasterDataStore } from '@/store/masterDataStore';
import { supabase } from '@/integrations/supabase/client';
import { CurrencyDisplay } from '@/components/ui/CashupUI';
import { SourceLink } from '@/components/ui/SourceLink';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Download, X } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, addDays } from 'date-fns';
import type { ManagerDailyEntry } from '@/types/cashup';
import { downloadCsv } from '@/lib/csvExport';
import { parseBankStatementDate } from '@/lib/bankStatementDate';

interface CashReconProps {
  filterMonth: string;
}

// Seed values for Jan 1 2026
const SEED_DATE = '2026-01-01';
const SEED_CC = 2000;
const SEED_EASYPAY = 3500;
const SEED_COINS = 4483.15;
const BANKING_OB_SEED_MONTH = '2026-03'; // first month with banking OB
const BANKING_OB_SEED = 60320.42; // outstanding from Feb

export function CashRecon({ filterMonth }: CashReconProps) {
  const { cashups, managerEntries, getCashupByDate, getManagerEntryByDate } = useCashupStore();
  const cashInTransit = useMasterDataStore(s => s.cashInTransit);
  const citBankPattern = useMasterDataStore(s => s.cashInTransitBankPatterns[s.cashInTransit] ?? '');
  const citBankPatternUpper = citBankPattern.trim().toUpperCase();
  const isDeposita = cashInTransit === 'Deposita';
  const citShortLbl = isDeposita ? 'Dep' : 'CC';
  const citFullLbl = isDeposita ? 'Deposita' : 'Cash Connect';

  type BankLine = { id: string; amount: number; description: string; transaction_date: string };
  const [bankLines, setBankLines] = useState<BankLine[]>([]);
  const [allPriorBankLines, setAllPriorBankLines] = useState<BankLine[]>([]);
  const [allocByLine, setAllocByLine] = useState<Map<string, string>>(new Map());
  const [priorAllocByLine, setPriorAllocByLine] = useState<Map<string, string>>(new Map());

  // Manual matches between bank credits and Bag Closure rows (Deposita).
  // Many-to-many: a single bank line can be split across multiple dates,
  // a single date can receive multiple bank lines.
  type ManualMatch = { id: string; bank_line_id: string; cashup_date: string; amount: number };
  const [manualMatches, setManualMatches] = useState<ManualMatch[]>([]);

  const loadBankLines = useCallback(async () => {
    const [cur, prior, curAlloc, priorAlloc, mm] = await Promise.all([
      supabase.from('bank_statement_lines').select('id, amount, description, transaction_date').eq('month', filterMonth),
      supabase.from('bank_statement_lines').select('id, amount, description, transaction_date').lt('month', filterMonth),
      supabase.from('bank_line_allocations').select('bank_line_id, recon_type').eq('month', filterMonth),
      supabase.from('bank_line_allocations').select('bank_line_id, recon_type').lt('month', filterMonth),
      supabase.from('cash_recon_manual_matches').select('id, bank_line_id, cashup_date, amount').eq('month', filterMonth).eq('recon_kind', 'deposita'),
    ]);
    setBankLines((cur.data ?? []) as BankLine[]);
    setAllPriorBankLines((prior.data ?? []) as BankLine[]);
    const m = new Map<string, string>();
    ((curAlloc.data ?? []) as { bank_line_id: string; recon_type: string }[]).forEach((a) =>
      m.set(a.bank_line_id, a.recon_type),
    );
    setAllocByLine(m);
    const pm = new Map<string, string>();
    ((priorAlloc.data ?? []) as { bank_line_id: string; recon_type: string }[]).forEach((a) =>
      pm.set(a.bank_line_id, a.recon_type),
    );
    setPriorAllocByLine(pm);
    setManualMatches(((mm.data ?? []) as ManualMatch[]).map(r => ({ ...r, amount: Number(r.amount) })));
  }, [filterMonth]);

  useEffect(() => { loadBankLines(); }, [loadBankLines]);

  const monthStart = startOfMonth(new Date(filterMonth + '-01'));
  const monthEnd = endOfMonth(monthStart);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Parse bank date from DD/MM/YYYY to YYYY-MM-DD
  const parseBankDate = (dateStr: string): string | null => parseBankStatementDate(dateStr);

  // ── Identify CIT bank credits for the month ──
  // For Deposita: only POSITIVE amounts count as credits.
  // For Cash Connect: keep historical behaviour (any sign matching pattern).
  type CitLine = BankLine & { parsedDate: string | null };
  const citLines: CitLine[] = bankLines
    .map(line => {
      const desc = line.description.toUpperCase().trim();
      const reconType = allocByLine.get(line.id);
      const isCit = reconType === 'cash_cc' || (!reconType && citBankPatternUpper !== '' && desc.includes(citBankPatternUpper));
      if (!isCit) return null;
      if (isDeposita && Number(line.amount) <= 0) return null;
      return { ...line, parsedDate: parseBankDate(line.transaction_date) };
    })
    .filter((l): l is CitLine => l !== null);

  // Map of manual matches by bank_line_id and by cashup_date
  const manualByBankLine = useMemo(() => {
    const m = new Map<string, ManualMatch[]>();
    manualMatches.forEach(mm => {
      if (!m.has(mm.bank_line_id)) m.set(mm.bank_line_id, []);
      m.get(mm.bank_line_id)!.push(mm);
    });
    return m;
  }, [manualMatches]);

  const manualByDate = useMemo(() => {
    const m = new Map<string, ManualMatch[]>();
    manualMatches.forEach(mm => {
      if (!m.has(mm.cashup_date)) m.set(mm.cashup_date, []);
      m.get(mm.cashup_date)!.push(mm);
    });
    return m;
  }, [manualMatches]);

  // Auto-match: per credit, if (date matches a Bag Closure date AND amount equals
  // its Bag Closure amount AND nothing manually matched there yet AND credit not
  // already manually matched) → auto-pair. Stored as a virtual map keyed by date.
  // Build per-date auto match by walking citLines.
  const autoMatchByDate = new Map<string, { bankLineId: string; amount: number }>();
  const autoMatchedBankIds = new Set<string>();

  if (isDeposita) {
    // Build per-date bag closure map
    const bagClosureByDate = new Map<string, number>();
    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const entry = getManagerEntryByDate(dateStr);
      const closure = Math.abs(entry?.ccBagClosureCashConnect ?? 0);
      if (closure > 0) bagClosureByDate.set(dateStr, closure);
    });
    citLines.forEach(line => {
      if (!line.parsedDate) return;
      // Skip if this line is manually matched anywhere
      if (manualByBankLine.has(line.id)) return;
      // Skip if the date already has a manual or auto match
      if (manualByDate.has(line.parsedDate)) return;
      if (autoMatchByDate.has(line.parsedDate)) return;
      const closure = bagClosureByDate.get(line.parsedDate);
      if (closure === undefined) return;
      if (Math.abs(closure - Number(line.amount)) >= 0.01) return;
      autoMatchByDate.set(line.parsedDate, { bankLineId: line.id, amount: Number(line.amount) });
      autoMatchedBankIds.add(line.id);
    });
  }

  // For Cash Connect mode, retain the legacy by-date sum behaviour.
  const cconnectByDate = new Map<string, number>();
  if (!isDeposita) {
    citLines.forEach(line => {
      if (line.parsedDate) {
        cconnectByDate.set(line.parsedDate, (cconnectByDate.get(line.parsedDate) ?? 0) + Number(line.amount));
      }
    });
  }

  // Bank Stmt amount displayed per Deposita row = auto-match amount + sum of manual matches for that date
  const bankStmtForDate = (dateStr: string): number => {
    if (!isDeposita) return cconnectByDate.get(dateStr) ?? 0;
    const auto = autoMatchByDate.get(dateStr)?.amount ?? 0;
    const manual = (manualByDate.get(dateStr) ?? []).reduce((s, m) => s + Number(m.amount), 0);
    return auto + manual;
  };

  // Unmatched bank credits (Deposita only) with remaining amount
  const unmatchedCredits = useMemo(() => {
    if (!isDeposita) return [];
    return citLines
      .filter(l => !autoMatchedBankIds.has(l.id))
      .map(l => {
        const used = (manualByBankLine.get(l.id) ?? []).reduce((s, m) => s + Number(m.amount), 0);
        const remaining = Number(l.amount) - used;
        return { ...l, used, remaining };
      })
      .filter(l => l.remaining > 0.005);
  }, [citLines, autoMatchedBankIds, manualByBankLine, isDeposita]);

  // Compute banking opening balance for Cash Connect only.
  // Deposita outstanding is per-row only: Dep Bag Closure less same-date Bank Statement amount.
  const bankingOB = (() => {
    if (isDeposita) return 0;

    const monthStartStr = format(monthStart, 'yyyy-MM-dd');

    // Subtract prior CIT bank deposits (matches active provider's bank pattern)
    let priorActual = 0;
    allPriorBankLines.forEach(line => {
      const reconType = priorAllocByLine.get(line.id);
      const isCashCc =
        reconType === 'cash_cc' || (!reconType && citBankPatternUpper !== '' && line.description.toUpperCase().trim().includes(citBankPatternUpper));
      if (isCashCc) {
        priorActual += line.amount;
      }
    });

    // Cash Connect: seed + prior expected banking − prior actual deposits
    let ob = filterMonth >= BANKING_OB_SEED_MONTH ? BANKING_OB_SEED : 0;
    const priorExpected = managerEntries
      .filter(e => e.date >= BANKING_OB_SEED_MONTH + '-01' && e.date < monthStartStr)
      .reduce((s, e) => s + (e.banking ?? 0), 0);
    ob += priorExpected;
    ob -= priorActual;
    return ob;
  })();

  // Compute opening balances by walking from seed date to month start
  const computeOpeningForMonth = (): { ccOpening: number; easypayOpening: number; coinsOpening: number } => {
    const monthStartStr = format(monthStart, 'yyyy-MM-dd');
    if (monthStartStr <= SEED_DATE) {
      return { ccOpening: SEED_CC, easypayOpening: SEED_EASYPAY, coinsOpening: SEED_COINS };
    }

    let cc = SEED_CC;
    let easypay = SEED_EASYPAY;
    let coins = SEED_COINS;

    let d = parseISO(SEED_DATE);
    const end = parseISO(monthStartStr);

    while (d < end) {
      const dateStr = format(d, 'yyyy-MM-dd');
      const cashup = getCashupByDate(dateStr);
      const entry = getManagerEntryByDate(dateStr);

      const dailyCoins = cashup?.shop.coins ?? 0;
      const dailyCC = cashup?.shop.cashDepositedBanking ?? 0;
      const dailyEasypay = cashup?.shop.easyPay ?? 0;
      const deepFrozenCC = entry?.deepFrozenCC ?? 0;
      const closureCoins = Math.abs(entry?.ccBagClosureCoins ?? 0);
      const closureCC = Math.abs(entry?.ccBagClosureCashConnect ?? 0);
      const closureEasypay = Math.abs(entry?.ccBagClosureEasypay ?? 0);
      const transferFromCoins = Math.abs(entry?.transferFromCoins ?? 0);

      coins = coins + dailyCoins - closureCoins - transferFromCoins;
      cc = cc + dailyCC - closureCC + transferFromCoins;
      easypay = easypay + dailyEasypay - closureEasypay;

      d = addDays(d, 1);
    }

    return { ccOpening: cc, easypayOpening: easypay, coinsOpening: coins };
  };

  const { ccOpening: monthCCOpening, easypayOpening: monthEasypayOpening, coinsOpening: monthCoinsOpening } = computeOpeningForMonth();

  // Build daily rows
  type DayRow = {
    date: string;
    ccOpening: number;
    ccDailyCashup: number;
    ccBagClosure: number;
    ccTransferIn: number;
    ccDeepFrozen: number;
    ccClosing: number;
    easypayOpening: number;
    easypayDailyCashup: number;
    easypayBagClosure: number;
    easypayClosing: number;
    totalOpening: number;
    totalClosing: number;
    bankCharges: number;
    bankingExpected: number;
    bankActual: number;
    bankMatched: boolean;
    bankRunningBalance: number;
    coinsOpening: number;
    coinsDailyCashup: number;
    coinsBagClosure: number;
    coinsTransferOut: number;
    coinsClosing: number;
  };

  const dailyRows: DayRow[] = [];
  let runningCC = monthCCOpening;
  let runningEasypay = monthEasypayOpening;
  let runningCoins = monthCoinsOpening;
  let bankRunning = bankingOB; // start with OB from prior months

  days.forEach(day => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const cashup = getCashupByDate(dateStr);
    const entry = getManagerEntryByDate(dateStr);

    const ccDailyCashup = cashup?.shop.cashDepositedBanking ?? 0;
    const ccBagClosure = Math.abs(entry?.ccBagClosureCashConnect ?? 0);
    const transferFromCoins = Math.abs(entry?.transferFromCoins ?? 0);
    const deepFrozenCC = entry?.deepFrozenCC ?? 0;
    const bankCharges = entry?.bankCharges ?? 0;
    const bankingExpected = entry?.banking ?? 0;

    const easypayDailyCashup = cashup?.shop.easyPay ?? 0;
    const easypayBagClosure = Math.abs(entry?.ccBagClosureEasypay ?? 0);

    const coinsDailyCashup = cashup?.shop.coins ?? 0;
    const coinsBagClosure = Math.abs(entry?.ccBagClosureCoins ?? 0);

    const ccOpening = runningCC;
    const easypayOpening = runningEasypay;
    const coinsOpening = runningCoins;

    const ccClosing = ccOpening + ccDailyCashup - ccBagClosure + transferFromCoins;
    const easypayClosing = easypayOpening + easypayDailyCashup - easypayBagClosure;
    const coinsClosing = coinsOpening + coinsDailyCashup - coinsBagClosure - transferFromCoins;

    const bankActual = bankStmtForDate(dateStr);
    const dailyDeposit = isDeposita ? ccBagClosure : bankingExpected;
    const bankOutstanding = isDeposita ? dailyDeposit - bankActual : bankRunning + dailyDeposit - bankActual;
    if (!isDeposita) {
      bankRunning = bankOutstanding;
    }
    const bankMatched = dailyDeposit > 0 && Math.abs(dailyDeposit - bankActual) < 0.01;

    dailyRows.push({
      date: dateStr,
      ccOpening,
      ccDailyCashup,
      ccBagClosure,
      ccTransferIn: transferFromCoins,
      ccDeepFrozen: deepFrozenCC,
      ccClosing,
      easypayOpening,
      easypayDailyCashup,
      easypayBagClosure,
      easypayClosing,
      totalOpening: ccOpening + easypayOpening,
      totalClosing: ccClosing + easypayClosing,
      bankCharges,
      bankingExpected,
      bankActual,
      bankMatched,
      bankRunningBalance: bankOutstanding,
      coinsOpening,
      coinsDailyCashup,
      coinsBagClosure,
      coinsTransferOut: transferFromCoins,
      coinsClosing,
    });

    runningCC = ccClosing;
    runningEasypay = easypayClosing;
    runningCoins = coinsClosing;
  });

  // Totals
  const totalCCDailyCashup = dailyRows.reduce((s, r) => s + r.ccDailyCashup, 0);
  const totalCCBagClosure = dailyRows.reduce((s, r) => s + r.ccBagClosure, 0);
  const totalCCTransferIn = dailyRows.reduce((s, r) => s + r.ccTransferIn, 0);
  const totalCCDeepFrozen = dailyRows.reduce((s, r) => s + r.ccDeepFrozen, 0);
  const totalEasypayDailyCashup = dailyRows.reduce((s, r) => s + r.easypayDailyCashup, 0);
  const totalEasypayBagClosure = dailyRows.reduce((s, r) => s + r.easypayBagClosure, 0);
  const totalBankCharges = dailyRows.reduce((s, r) => s + r.bankCharges, 0);
  const totalBankingExpected = dailyRows.reduce((s, r) => s + r.bankingExpected, 0);
  const totalBankActual = dailyRows.reduce((s, r) => s + r.bankActual, 0);
  const totalBankOutstanding = isDeposita ? totalCCBagClosure - totalBankActual : bankRunning;

  const totalCoinsDailyCashup = dailyRows.reduce((s, r) => s + r.coinsDailyCashup, 0);
  const totalCoinsBagClosure = dailyRows.reduce((s, r) => s + r.coinsBagClosure, 0);
  const totalCoinsTransferOut = dailyRows.reduce((s, r) => s + r.coinsTransferOut, 0);

  // ── Manual match drag & drop (Deposita only) ──
  type DragPayload = { bankLineId: string; remaining: number; description: string; amount: number; date: string };
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [splitDialog, setSplitDialog] = useState<{ payload: DragPayload; cashupDate: string; suggested: number } | null>(null);
  const [splitInput, setSplitInput] = useState('');

  const handleDragStart = (e: React.DragEvent, payload: DragPayload) => {
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleRowDragOver = (e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(dateStr);
  };
  const handleRowDragLeave = () => setDragOverDate(null);

  const persistManualMatch = async (bankLineId: string, cashupDate: string, amount: number) => {
    const { data, error } = await supabase
      .from('cash_recon_manual_matches')
      .insert({ month: filterMonth, cashup_date: cashupDate, bank_line_id: bankLineId, amount, recon_kind: 'deposita' } as never)
      .select('id, bank_line_id, cashup_date, amount')
      .single();
    if (error) { toast({ title: 'Match failed', description: error.message, variant: 'destructive' }); return; }
    if (data) {
      const row = data as ManualMatch;
      setManualMatches(prev => [...prev, { ...row, amount: Number(row.amount) }]);
    }
  };

  const handleRowDrop = async (e: React.DragEvent, cashupDate: string) => {
    e.preventDefault();
    setDragOverDate(null);
    try {
      const payload: DragPayload = JSON.parse(e.dataTransfer.getData('application/json'));
      const entry = getManagerEntryByDate(cashupDate);
      const bagClosure = Math.abs(entry?.ccBagClosureCashConnect ?? 0);
      const alreadyOnDate = (manualByDate.get(cashupDate) ?? []).reduce((s, m) => s + Number(m.amount), 0)
        + (autoMatchByDate.get(cashupDate)?.amount ?? 0);
      const remainingOnRow = Math.max(0, bagClosure - alreadyOnDate);
      const suggested = remainingOnRow > 0 ? Math.min(payload.remaining, remainingOnRow) : payload.remaining;
      if (Math.abs(payload.remaining - suggested) < 0.01 && remainingOnRow > 0) {
        await persistManualMatch(payload.bankLineId, cashupDate, payload.remaining);
        return;
      }
      setSplitInput(suggested.toFixed(2));
      setSplitDialog({ payload, cashupDate, suggested });
    } catch (err) { console.warn('Drop failed', err); }
  };

  const confirmSplit = async () => {
    if (!splitDialog) return;
    const amt = Number(splitInput);
    if (!isFinite(amt) || amt <= 0) { toast({ title: 'Invalid amount', variant: 'destructive' }); return; }
    if (amt > splitDialog.payload.remaining + 0.005) { toast({ title: 'Amount exceeds credit remaining', variant: 'destructive' }); return; }
    await persistManualMatch(splitDialog.payload.bankLineId, splitDialog.cashupDate, amt);
    setSplitDialog(null);
    setSplitInput('');
  };

  const handleRemoveManualMatch = async (matchId: string) => {
    const { error } = await supabase.from('cash_recon_manual_matches').delete().eq('id', matchId);
    if (!error) setManualMatches(prev => prev.filter(m => m.id !== matchId));
  };

  const [unmatchedPanelPos, setUnmatchedPanelPos] = useState<{ top: number; left: number }>(() => {
    try {
      const saved = localStorage.getItem('cash_recon_unmatched_panel_pos');
      if (saved) return JSON.parse(saved);
    } catch { /* noop */ }
    return { top: 120, left: typeof window !== 'undefined' ? window.innerWidth - 360 : 800 };
  });
  const panelDragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const handlePanelDragStart = (e: React.MouseEvent) => {
    panelDragRef.current = { offsetX: e.clientX - unmatchedPanelPos.left, offsetY: e.clientY - unmatchedPanelPos.top };
    const onMove = (ev: MouseEvent) => {
      if (!panelDragRef.current) return;
      const top = Math.max(0, Math.min(window.innerHeight - 80, ev.clientY - panelDragRef.current.offsetY));
      const left = Math.max(0, Math.min(window.innerWidth - 100, ev.clientX - panelDragRef.current.offsetX));
      setUnmatchedPanelPos({ top, left });
    };
    const onUp = () => { panelDragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  useEffect(() => {
    try { localStorage.setItem('cash_recon_unmatched_panel_pos', JSON.stringify(unmatchedPanelPos)); } catch { /* noop */ }
  }, [unmatchedPanelPos]);

  return (
    <div className="space-y-6">
      {/* Cash Connect Recon */}
      <div className="bg-card border rounded-lg overflow-x-clip">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
          <h3 className="font-semibold text-sm">
            {citFullLbl} Reconciliation — {format(monthStart, 'MMMM yyyy')}
          </h3>
          <Button size="sm" variant="outline" onClick={() => {
            const headers = isDeposita
              ? ['Date', `${citShortLbl} Opening`, 'EP Opening', 'Total Opening', `${citShortLbl} Daily`, 'EP Daily', `${citShortLbl} Transfer In`, `${citShortLbl} Bag Closure`, 'EP Bag Closure', 'Bag Total', `Deep Frozen ${citShortLbl}`, `${citShortLbl} Closing`, 'EP Closing', 'Total Closing', 'Bank Stmt', 'Outstanding']
              : ['Date', `${citShortLbl} Opening`, 'EP Opening', 'Total Opening', `${citShortLbl} Daily`, 'EP Daily', `${citShortLbl} Transfer In`, `${citShortLbl} Bag Closure`, 'EP Bag Closure', 'Bag Total', `Deep Frozen ${citShortLbl}`, `${citShortLbl} Closing`, 'EP Closing', 'Total Closing', 'Bank Charges', 'Expected Banking', 'Bank Stmt', 'Outstanding'];
            const rows = isDeposita
              ? dailyRows.map(r => [r.date, r.ccOpening, r.easypayOpening, r.totalOpening, r.ccDailyCashup, r.easypayDailyCashup, r.ccTransferIn, r.ccBagClosure, r.easypayBagClosure, r.ccBagClosure + r.easypayBagClosure, r.ccDeepFrozen, r.ccClosing, r.easypayClosing, r.totalClosing, r.bankActual, r.bankRunningBalance])
              : dailyRows.map(r => [r.date, r.ccOpening, r.easypayOpening, r.totalOpening, r.ccDailyCashup, r.easypayDailyCashup, r.ccTransferIn, r.ccBagClosure, r.easypayBagClosure, r.ccBagClosure + r.easypayBagClosure, r.ccDeepFrozen, r.ccClosing, r.easypayClosing, r.totalClosing, r.bankCharges, r.bankingExpected, r.bankActual, r.bankRunningBalance]);
            downloadCsv(headers, rows, `${isDeposita ? 'deposita' : 'cash-connect'}-recon-${filterMonth}.csv`);
          }}>
            <Download className="h-3.5 w-3.5 mr-1" />Export CSV
          </Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[90px]">Date</TableHead>
                <TableHead className="text-right text-xs min-w-[90px]">{citShortLbl} Opening</TableHead>
                <TableHead className="text-right text-xs min-w-[90px]">+ Easypay Opening</TableHead>
                <TableHead className="text-right text-xs min-w-[90px] font-semibold bg-muted/30">= Total Opening</TableHead>
                <TableHead className="text-right text-xs min-w-[90px] border-l">+ {citShortLbl} Daily</TableHead>
                <TableHead className="text-right text-xs min-w-[90px]">+ EP Daily</TableHead>
                <TableHead className="text-right text-xs min-w-[90px]">+ Transfer In</TableHead>
                <TableHead className="text-right text-xs min-w-[90px] bg-amber-50">− {citShortLbl} Bag Closure</TableHead>
                <TableHead className="text-right text-xs min-w-[90px] bg-amber-50">− EP Bag Closure</TableHead>
                <TableHead className="text-right text-xs min-w-[90px] bg-amber-100 font-semibold">= Bag Total</TableHead>
                <TableHead className="text-right text-xs min-w-[90px]">− Deep Frozen</TableHead>
                <TableHead className="text-right text-xs min-w-[90px] font-semibold">{citShortLbl} Closing</TableHead>
                <TableHead className="text-right text-xs min-w-[90px] font-semibold">EP Closing</TableHead>
                <TableHead className="text-right text-xs min-w-[100px] font-semibold bg-primary/10">= Total Closing</TableHead>
                {!isDeposita && <TableHead className="text-right text-xs border-l min-w-[80px]">Bank Charges</TableHead>}
                {!isDeposita && <TableHead className="text-right text-xs min-w-[90px]">Expected Banking</TableHead>}
                <TableHead className={`text-right text-xs min-w-[90px]${isDeposita ? ' border-l' : ''}`}>Bank Stmt</TableHead>
                <TableHead className="text-right text-xs min-w-[100px]">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Banking Opening Balance row */}
              {bankingOB !== 0 && (
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell className="text-xs">Opening Balance</TableCell>
                  <TableCell colSpan={13}></TableCell>
                  {!isDeposita && <TableCell className="border-l"></TableCell>}
                  {!isDeposita && <TableCell></TableCell>}
                  <TableCell className={isDeposita ? 'border-l' : ''}></TableCell>
                  <TableCell className="text-right text-xs font-semibold">
                    <CurrencyDisplay value={bankingOB} />
                  </TableCell>
                </TableRow>
              )}
              {dailyRows.map(row => {
                const hasData = row.ccDailyCashup > 0 || row.ccBagClosure > 0 || row.ccTransferIn > 0 || row.ccDeepFrozen > 0 || row.easypayDailyCashup > 0 || row.easypayBagClosure > 0;

                return (
                  <TableRow
                    key={row.date}
                    className={`${!hasData ? 'opacity-50' : ''} ${isDeposita && dragOverDate === row.date ? 'bg-primary/10 outline outline-2 outline-primary' : ''}`}
                    onDragOver={isDeposita ? (e) => handleRowDragOver(e, row.date) : undefined}
                    onDragLeave={isDeposita ? handleRowDragLeave : undefined}
                    onDrop={isDeposita ? (e) => handleRowDrop(e, row.date) : undefined}
                  >
                    <TableCell className="text-xs">
                      <SourceLink date={row.date} source="manager-daily">{format(new Date(row.date), 'dd MMM (EEE)')}</SourceLink>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <CurrencyDisplay value={row.ccOpening} />
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <CurrencyDisplay value={row.easypayOpening} />
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold bg-muted/30">
                      <CurrencyDisplay value={row.totalOpening} />
                    </TableCell>
                    <TableCell className="text-right text-xs border-l">
                      {row.ccDailyCashup > 0
                        ? <SourceLink date={row.date} source="cashier"><CurrencyDisplay value={row.ccDailyCashup} /></SourceLink>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {row.easypayDailyCashup > 0
                        ? <SourceLink date={row.date} source="manager-daily"><CurrencyDisplay value={row.easypayDailyCashup} /></SourceLink>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {row.ccTransferIn > 0
                        ? <SourceLink date={row.date} source="manager-daily"><CurrencyDisplay value={row.ccTransferIn} /></SourceLink>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs bg-amber-50">
                      {row.ccBagClosure > 0
                        ? <SourceLink date={row.date} source="manager-daily" className="text-destructive"><CurrencyDisplay value={row.ccBagClosure} /></SourceLink>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs bg-amber-50">
                      {row.easypayBagClosure > 0
                        ? <SourceLink date={row.date} source="manager-daily" className="text-destructive"><CurrencyDisplay value={row.easypayBagClosure} /></SourceLink>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs bg-amber-100 font-semibold">
                      {(row.ccBagClosure + row.easypayBagClosure) > 0
                        ? <CurrencyDisplay value={row.ccBagClosure + row.easypayBagClosure} />
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {row.ccDeepFrozen > 0
                        ? <SourceLink date={row.date} source="manager-daily" className="text-destructive"><CurrencyDisplay value={row.ccDeepFrozen} /></SourceLink>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold">
                      <CurrencyDisplay value={row.ccClosing} />
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold">
                      <CurrencyDisplay value={row.easypayClosing} />
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold bg-primary/10">
                      <CurrencyDisplay value={row.totalClosing} />
                    </TableCell>
                    {/* Bank matching */}
                    {!isDeposita && (
                      <TableCell className="text-right text-xs border-l">
                        {row.bankCharges > 0
                          ? <SourceLink date={row.date} source="manager-daily" className="text-orange-600"><CurrencyDisplay value={row.bankCharges} /></SourceLink>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    )}
                    {!isDeposita && (
                      <TableCell className="text-right text-xs">
                        {row.bankingExpected > 0
                          ? <SourceLink date={row.date} source="manager-daily"><CurrencyDisplay value={row.bankingExpected} /></SourceLink>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    )}
                    <TableCell className={`text-right text-xs${isDeposita ? ' border-l' : ''}`}>
                      {(() => {
                        if (!isDeposita) {
                          return row.bankActual > 0
                            ? <CurrencyDisplay value={row.bankActual} />
                            : <span className="text-muted-foreground">—</span>;
                        }
                        const auto = autoMatchByDate.get(row.date);
                        const manual = manualByDate.get(row.date) ?? [];
                        if (!auto && manual.length === 0) {
                          return <span className="text-muted-foreground">—</span>;
                        }
                        return (
                          <div className="flex flex-col items-end gap-0.5">
                            {auto && (
                              <div className="flex items-center gap-1" title="Auto-matched">
                                <span className="text-[10px] text-green-700">●</span>
                                <CurrencyDisplay value={auto.amount} />
                              </div>
                            )}
                            {manual.map(m => (
                              <div key={m.id} className="flex items-center gap-1" title="Manually matched">
                                <button
                                  onClick={() => handleRemoveManualMatch(m.id)}
                                  className="text-muted-foreground hover:text-destructive"
                                  title="Remove manual match"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                                <span className="text-[10px] text-blue-700">●</span>
                                <CurrencyDisplay value={Number(m.amount)} />
                              </div>
                            ))}
                            {(auto && manual.length > 0) || manual.length > 1 ? (
                              <div className="border-t pt-0.5 font-semibold">
                                <CurrencyDisplay value={row.bankActual} />
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className={`text-right text-xs font-semibold ${
                      Math.abs(row.bankRunningBalance) < 0.01 ? 'bg-green-100 text-green-700' :
                      'bg-destructive/10 text-destructive'
                    }`}>
                      {(row.bankingExpected > 0 || row.bankActual > 0 || row.ccBagClosure > 0 || Math.abs(row.bankRunningBalance) > 0.01)
                        ? (Math.abs(row.bankRunningBalance) < 0.01
                          ? '✓'
                          : <CurrencyDisplay value={row.bankRunningBalance} />)
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {/* Closing / Totals */}
              <TableRow className="bg-secondary font-semibold">
                <TableCell className="text-xs">Totals</TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell className="text-right text-xs border-l">
                  <CurrencyDisplay value={totalCCDailyCashup} highlight />
                </TableCell>
                <TableCell className="text-right text-xs">
                  <CurrencyDisplay value={totalEasypayDailyCashup} highlight />
                </TableCell>
                <TableCell className="text-right text-xs">
                  <CurrencyDisplay value={totalCCTransferIn} highlight />
                </TableCell>
                <TableCell className="text-right text-xs bg-amber-50">
                  <CurrencyDisplay value={totalCCBagClosure} highlight />
                </TableCell>
                <TableCell className="text-right text-xs bg-amber-50">
                  <CurrencyDisplay value={totalEasypayBagClosure} highlight />
                </TableCell>
                <TableCell className="text-right text-xs bg-amber-100 font-bold">
                  <CurrencyDisplay value={totalCCBagClosure + totalEasypayBagClosure} highlight />
                </TableCell>
                <TableCell className="text-right text-xs">
                  <CurrencyDisplay value={totalCCDeepFrozen} highlight />
                </TableCell>
                <TableCell className="text-right text-xs font-bold">
                  <CurrencyDisplay value={runningCC} highlight />
                </TableCell>
                <TableCell className="text-right text-xs font-bold">
                  <CurrencyDisplay value={runningEasypay} highlight />
                </TableCell>
                <TableCell className="text-right text-xs font-bold bg-primary/10">
                  <CurrencyDisplay value={runningCC + runningEasypay} highlight />
                </TableCell>
                {!isDeposita && (
                  <TableCell className="text-right text-xs border-l">
                    <CurrencyDisplay value={totalBankCharges} highlight />
                  </TableCell>
                )}
                {!isDeposita && (
                  <TableCell className="text-right text-xs">
                    <CurrencyDisplay value={totalBankingExpected} highlight />
                  </TableCell>
                )}
                <TableCell className={`text-right text-xs${isDeposita ? ' border-l' : ''}`}>
                  <CurrencyDisplay value={totalBankActual} highlight />
                </TableCell>
                <TableCell className={`text-right text-xs font-bold ${
                  Math.abs(totalBankOutstanding) < 0.01 ? 'text-green-700' : 'text-destructive'
                }`}>
                  <CurrencyDisplay value={totalBankOutstanding} />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Coins Recon */}
      <div className="bg-card border rounded-lg overflow-x-clip">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
          <h3 className="font-semibold text-sm">
            Coins Reconciliation — {format(monthStart, 'MMMM yyyy')}
          </h3>
          <Button size="sm" variant="outline" onClick={() => {
            downloadCsv(
              ['Date', 'Opening', 'Daily Cashup', 'Bag Closure', 'Transfer Out', 'Closing'],
              dailyRows.map(r => [r.date, r.coinsOpening, r.coinsDailyCashup, r.coinsBagClosure, r.coinsTransferOut, r.coinsClosing]),
              `coins-recon-${filterMonth}.csv`
            );
          }}>
            <Download className="h-3.5 w-3.5 mr-1" />Export CSV
          </Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[90px]">Date</TableHead>
                <TableHead className="text-right text-xs min-w-[90px]">Opening</TableHead>
                <TableHead className="text-right text-xs min-w-[90px]">+ Daily Cashup</TableHead>
                <TableHead className="text-right text-xs min-w-[90px]">− Bag Closure</TableHead>
                <TableHead className="text-right text-xs min-w-[90px]">− Transfer Out</TableHead>
                <TableHead className="text-right text-xs min-w-[100px] font-semibold">Closing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dailyRows.map(row => {
                const hasData = row.coinsDailyCashup > 0 || row.coinsBagClosure > 0 || row.coinsTransferOut > 0;

                return (
                  <TableRow key={row.date} className={!hasData ? 'opacity-50' : ''}>
                    <TableCell className="text-xs">
                      <SourceLink date={row.date} source="cashier">{format(new Date(row.date), 'dd MMM (EEE)')}</SourceLink>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <CurrencyDisplay value={row.coinsOpening} />
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {row.coinsDailyCashup > 0
                        ? <SourceLink date={row.date} source="cashier"><CurrencyDisplay value={row.coinsDailyCashup} /></SourceLink>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {row.coinsBagClosure > 0
                        ? <SourceLink date={row.date} source="manager-daily" className="text-destructive"><CurrencyDisplay value={row.coinsBagClosure} /></SourceLink>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {row.coinsTransferOut > 0
                        ? <SourceLink date={row.date} source="manager-daily" className="text-destructive"><CurrencyDisplay value={row.coinsTransferOut} /></SourceLink>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold bg-amber-50">
                      <CurrencyDisplay value={row.coinsClosing} />
                    </TableCell>
                  </TableRow>
                );
              })}
              {/* Totals */}
              <TableRow className="bg-secondary font-semibold">
                <TableCell className="text-xs">Totals</TableCell>
                <TableCell></TableCell>
                <TableCell className="text-right text-xs">
                  <CurrencyDisplay value={totalCoinsDailyCashup} highlight />
                </TableCell>
                <TableCell className="text-right text-xs">
                  <CurrencyDisplay value={totalCoinsBagClosure} highlight />
                </TableCell>
                <TableCell className="text-right text-xs">
                  <CurrencyDisplay value={totalCoinsTransferOut} highlight />
                </TableCell>
                <TableCell className="text-right text-xs font-bold">
                  <CurrencyDisplay value={runningCoins} highlight />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
