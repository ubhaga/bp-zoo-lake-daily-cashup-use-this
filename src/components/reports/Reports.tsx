import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from '@/hooks/use-toast';
import { useCashupStore } from '@/store/cashupStore';
import { useMasterDataStore } from '@/store/masterDataStore';
import { supabase } from '@/integrations/supabase/client';
import { CurrencyDisplay } from '@/components/ui/CashupUI';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { extractTerminalNumber, getCanonicalSpeedpointTerminal, extractBatchFromDescription, normalizeBatch } from '@/lib/speedpointMatching';
import { SourceLink } from '@/components/ui/SourceLink';

import { DailySummaryReport } from './DailySummaryReport';
import { CreditorsRecon } from '@/components/recons/CreditorsRecon';
import { AirtimeRecon } from '@/components/recons/AirtimeRecon';
import { CashRecon } from '@/components/recons/CashRecon';
import { OtherAdjustmentsRecon } from '@/components/recons/OtherAdjustmentsRecon';
import { DebtorsRecon } from '@/components/recons/DebtorsRecon';

const parseBankReconDate = (dateStr: string): number => {
  if (!dateStr) return Number.MAX_SAFE_INTEGER;

  const iso = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const mdy = dateStr.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (mdy) {
    const year = Number(mdy[3]) < 100 ? 2000 + Number(mdy[3]) : Number(mdy[3]);
    return Date.UTC(year, Number(mdy[1]) - 1, Number(mdy[2]));
  }

  return Number.MAX_SAFE_INTEGER;
};

export function Reports({ mode = 'reports', onNavigateToDate, selectedDate }: { mode?: 'reports' | 'recons'; onNavigateToDate?: (date: string) => void; selectedDate?: string }) {
  const { cashups, managerEntries } = useCashupStore();
  const { speedpointTerminals, cashInTransit } = useMasterDataStore();
  const filterMonth = (selectedDate ?? new Date().toISOString().slice(0, 10)).slice(0, 7);

  const monthCashups = cashups.filter(c => c.month === filterMonth);
  const monthManagers = managerEntries.filter(e => e.date.startsWith(filterMonth));

  // Compute previous month string
  const prevMonth = (() => {
    const d = new Date(filterMonth + '-01');
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();
  const prevMonthCashups = cashups.filter(c => c.month === prevMonth);

  // Load bank statement lines for reconciliation
  const [bankLines, setBankLines] = useState<{ id: string; matched_terminal: string; amount: number; description: string; transaction_date: string }[]>([]);
  const [prevBankLines, setPrevBankLines] = useState<{ id: string; matched_terminal: string; amount: number; description: string; transaction_date: string }[]>([]);
  const loadBankLines = useCallback(async () => {
    const [cur, prev] = await Promise.all([
      supabase.from('bank_statement_lines').select('id, matched_terminal, amount, description, transaction_date').eq('month', filterMonth),
      supabase.from('bank_statement_lines').select('id, matched_terminal, amount, description, transaction_date').eq('month', prevMonth),
    ]);
    setBankLines((cur.data ?? []) as typeof bankLines);
    setPrevBankLines((prev.data ?? []) as typeof prevBankLines);
  }, [filterMonth, prevMonth]);
  useEffect(() => { loadBankLines(); }, [loadBankLines]);

  // Manual match state: key = "cashupDate|terminal", value = array of manually matched bank lines
  type BankParsedLine = { terminal: string; batch: string; amount: number; date: string; description: string; idx: number; bankLineId: string };
  const [manualMatches, setManualMatches] = useState<Record<string, BankParsedLine[]>>({});
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  // Load saved manual matches from DB (current + previous month for OB rows)
  const [prevManualMatches, setPrevManualMatches] = useState<Record<string, BankParsedLine[]>>({});
  const loadManualMatches = useCallback(async () => {
    const { data } = await supabase
      .from('speedpoint_manual_matches')
      .select('*')
      .in('month', [filterMonth, prevMonth]);
    if (data && data.length > 0) {
      // Self-heal: re-link any manual matches whose stored bank_line_id no
      // longer points to an existing bank statement line (e.g. after a
      // re-upload or duplicate cleanup). Match by month + amount + batch +
      // terminal — these are stable across re-uploads even if the bank
      // statement description format changes.
      try {
        const months = Array.from(new Set(data.map(d => (d as { month: string }).month)));
        const { data: allBank } = await supabase
          .from('bank_statement_lines')
          .select('id, month, amount, description, matched_terminal')
          .in('month', months);
        const bankById = new Map<string, { id: string; month: string; amount: number; description: string; matched_terminal: string }>();
        (allBank ?? []).forEach(b => bankById.set(b.id, b as never));
        const heals: { id: string; bank_line_id: string; bank_terminal: string }[] = [];
        (data as { id: string; month: string; bank_line_id: string | null; bank_amount: number; bank_batch: string; bank_terminal: string; bank_description: string }[]).forEach(m => {
          if (m.bank_line_id && bankById.has(m.bank_line_id)) return;
          // First try (amount + batch + terminal); fall back to (amount + description)
          const candidates = (allBank ?? []).filter(b => b.month === m.month && Number(b.amount) === Number(m.bank_amount));
          let pick = candidates.find(b => {
            const bankTerminalNumber = extractTerminalNumber(b.matched_terminal);
            const matchTerminalNumber = extractTerminalNumber(m.bank_terminal);
            const sameTerminal = bankTerminalNumber && matchTerminalNumber
              ? bankTerminalNumber === matchTerminalNumber
              : b.matched_terminal === m.bank_terminal;
            if (!sameTerminal) return false;
            if (!m.bank_batch) return true;
            return new RegExp(`(^|\\D)${m.bank_batch}(\\D|$)`).test(b.description);
          });
          if (!pick) pick = candidates.find(b => b.description === m.bank_description);
          if (pick && pick.id !== m.bank_line_id) {
            heals.push({ id: m.id, bank_line_id: pick.id, bank_terminal: pick.matched_terminal });
            // Patch in-memory so the rest of the load sees the correct id
            (m as { bank_line_id: string | null }).bank_line_id = pick.id;
            (m as { bank_terminal: string }).bank_terminal = pick.matched_terminal;
          }
        });
        if (heals.length > 0) {
          await Promise.all(
            heals.map(h => supabase
              .from('speedpoint_manual_matches')
              .update({ bank_line_id: h.bank_line_id, bank_terminal: h.bank_terminal } as never)
              .eq('id', h.id))
          );
        }
      } catch (e) {
        console.warn('Manual match self-heal failed', e);
      }

      const loaded: Record<string, BankParsedLine[]> = {};
      const prevLoaded: Record<string, BankParsedLine[]> = {};
      const invalidMatchIds: string[] = [];
      const seenBankLineAssignments = new Map<string, string>();
      (data as { id: string; month: string; cashup_date: string; terminal: string; bank_line_idx: number; bank_amount: number; bank_description: string; bank_date: string; bank_terminal: string; bank_batch: string; bank_line_id: string | null }[]).forEach(row => {
        const key = `${row.cashup_date}|${row.terminal}`;
        // Cross-terminal manual matches are allowed (e.g. assigning an
        // unmatched bank line to a different speedpoint terminal).

        const bankLineId = row.bank_line_id || `legacy-${row.bank_line_idx}`;
        const existingAssignment = row.bank_line_id ? seenBankLineAssignments.get(row.bank_line_id) : undefined;
        if (existingAssignment && existingAssignment !== key) {
          invalidMatchIds.push(row.id);
          return;
        }

        if (row.bank_line_id) {
          seenBankLineAssignments.set(row.bank_line_id, key);
        }

        if (row.month === filterMonth) {
          if (!loaded[key]) loaded[key] = [];
          loaded[key].push({ terminal: row.bank_terminal, batch: row.bank_batch, amount: Number(row.bank_amount), date: row.bank_date, description: row.bank_description, idx: row.bank_line_idx, bankLineId });
        } else {
          if (!prevLoaded[key]) prevLoaded[key] = [];
          prevLoaded[key].push({ terminal: row.bank_terminal, batch: row.bank_batch, amount: Number(row.bank_amount), date: row.bank_date, description: row.bank_description, idx: row.bank_line_idx, bankLineId });
        }
      });
      setManualMatches(loaded);
      setPrevManualMatches(prevLoaded);
      if (invalidMatchIds.length > 0) {
        await supabase.from('speedpoint_manual_matches').delete().in('id', invalidMatchIds);
      }
    } else {
      setManualMatches({});
      setPrevManualMatches({});
    }
  }, [filterMonth, prevMonth]);
  useEffect(() => { loadManualMatches(); }, [loadManualMatches]);

  // User-unmatched auto matches: bank line ids that should not auto-match anymore
  const [unmatchedAutoIds, setUnmatchedAutoIds] = useState<Set<string>>(new Set());
  const loadUnmatchedAuto = useCallback(async () => {
    const { data } = await supabase
      .from('speedpoint_unmatched_auto')
      .select('bank_line_id')
      .eq('month', filterMonth);
    setUnmatchedAutoIds(new Set((data ?? []).map(r => (r as { bank_line_id: string }).bank_line_id)));
  }, [filterMonth]);
  useEffect(() => { loadUnmatchedAuto(); }, [loadUnmatchedAuto]);

  // Diff clearances: groups of differences that offset each other (2+ entries that sum to zero)
  type DiffClearance = { id: string; month: string; terminal: string; date_1: string; date_2: string; amount: number; group_id: string | null };
  const [diffClearances, setDiffClearances] = useState<DiffClearance[]>([]);
  const [pendingDiffSelection, setPendingDiffSelection] = useState<{ date: string; terminal: string; diff: number }[]>([]);
  const [prevDiffClearances, setPrevDiffClearances] = useState<DiffClearance[]>([]);

  const loadDiffClearances = useCallback(async () => {
    const { data } = await supabase
      .from('speedpoint_diff_clearances')
      .select('*')
      .in('month', [filterMonth, prevMonth]);

    const mapped = (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      month: r.month as string,
      terminal: r.terminal as string,
      date_1: r.date_1 as string,
      date_2: r.date_2 as string,
      amount: Number(r.amount),
      group_id: (r.group_id as string | null) ?? null,
    }));

    setDiffClearances(mapped.filter(r => r.month === filterMonth));
    setPrevDiffClearances(mapped.filter(r => r.month === prevMonth));
  }, [filterMonth, prevMonth]);
  useEffect(() => { loadDiffClearances(); }, [loadDiffClearances]);

  // Check if a date+terminal diff is cleared
  const isDiffCleared = useCallback((date: string, terminal: string) => {
    return diffClearances.some(c => c.terminal === terminal && (c.date_1 === date || c.date_2 === date));
  }, [diffClearances]);

  const isPrevDiffCleared = useCallback((date: string, terminal: string) => {
    return prevDiffClearances.some(c => c.terminal === terminal && (c.date_1 === date || c.date_2 === date));
  }, [prevDiffClearances]);

  const getClearanceForCell = useCallback((date: string, terminal: string) => {
    return diffClearances.find(c => c.terminal === terminal && (c.date_1 === date || c.date_2 === date));
  }, [diffClearances]);

  const handleDiffClick = async (date: string, terminal: string, diff: number) => {
    // If already cleared, remove the entire clearance group
    const existing = getClearanceForCell(date, terminal);
    if (existing) {
      if (existing.group_id) {
        await supabase.from('speedpoint_diff_clearances').delete().eq('group_id', existing.group_id);
        setDiffClearances(prev => prev.filter(c => c.group_id !== existing.group_id));
      } else {
        await supabase.from('speedpoint_diff_clearances').delete().eq('id', existing.id);
        setDiffClearances(prev => prev.filter(c => c.id !== existing.id));
      }
      toast({ title: 'Clearance removed', description: `Unlinked ${date} from its offsetting group.` });
      return;
    }

    // Toggle membership in the pending selection (must all be the same terminal)
    setPendingDiffSelection(prev => {
      // If clicked again, remove it
      const idx = prev.findIndex(p => p.date === date && p.terminal === terminal);
      if (idx >= 0) {
        const next = [...prev];
        next.splice(idx, 1);
        return next;
      }
      if (prev.length > 0 && prev[0].terminal !== terminal) {
        toast({ title: 'Terminal mismatch', description: 'All offsetting differences must be for the same terminal.', variant: 'destructive' });
        return prev;
      }
      return [...prev, { date, terminal, diff }];
    });
  };

  const confirmDiffGroup = async () => {
    if (pendingDiffSelection.length < 2) return;
    const sum = pendingDiffSelection.reduce((s, p) => s + p.diff, 0);
    if (Math.abs(sum) > 0.01) {
      toast({ title: 'Group does not balance', description: `Selected differences sum to ${sum.toFixed(2)} (must be zero).`, variant: 'destructive' });
      return;
    }
    const terminal = pendingDiffSelection[0].terminal;
    // Generate a single group_id client-side so all rows share it
    const groupId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const rows = pendingDiffSelection.map(p => ({
      month: filterMonth,
      terminal,
      date_1: p.date,
      date_2: p.date,
      amount: p.diff,
      group_id: groupId,
    }));
    const { data } = await supabase.from('speedpoint_diff_clearances').insert(rows as never).select();
    if (data && data.length > 0) {
      const newRows = (data as Record<string, unknown>[]).map(r => ({
        id: r.id as string,
        month: (r.month as string) || filterMonth,
        terminal: r.terminal as string,
        date_1: r.date_1 as string,
        date_2: r.date_2 as string,
        amount: Number(r.amount),
        group_id: (r.group_id as string | null) ?? null,
      }));
      setDiffClearances(prev => [...prev, ...newRows]);
    }
    toast({ title: 'Differences cleared', description: `Grouped ${pendingDiffSelection.length} offsetting differences for ${terminal}.` });
    setPendingDiffSelection([]);
  };

  // Build lookup: vendor -> array of dates with invoices (and categories)
  const managerPayoutByVendor = new Map<string, Map<string, { count: number; categories: string[] }>>();
  monthManagers.forEach(e => {
    e.payoutInvoices.forEach(inv => {
      const vendor = inv.supplier.toLowerCase().trim();
      if (!managerPayoutByVendor.has(vendor)) managerPayoutByVendor.set(vendor, new Map());
      const dateMap = managerPayoutByVendor.get(vendor)!;
      const existing = dateMap.get(e.date) ?? { count: 0, categories: [] };
      existing.count += 1;
      existing.categories.push(inv.category || '');
      dateMap.set(e.date, existing);
    });
  });
  // Track consumption: vendor+date -> consumed count
  const invoiceConsumed = new Map<string, number>();

  type MatchStatus = 'matched' | 'matched-other-day' | 'unmatched';

  const matchPayout = (payoutDate: string, vendor: string): { status: MatchStatus; category: string } => {
    const v = vendor.toLowerCase().trim();
    const dateMap = managerPayoutByVendor.get(v);
    if (!dateMap) return { status: 'unmatched', category: '' };
    // Try same-day first
    const sameKey = `${v}|${payoutDate}`;
    const sameEntry = dateMap.get(payoutDate);
    const sameAvail = sameEntry ? sameEntry.count - (invoiceConsumed.get(sameKey) ?? 0) : 0;
    if (sameAvail > 0) {
      const idx = invoiceConsumed.get(sameKey) ?? 0;
      invoiceConsumed.set(sameKey, idx + 1);
      return { status: 'matched', category: sameEntry!.categories[idx] || '' };
    }
    // Try other days
    for (const [date, entry] of dateMap) {
      const otherKey = `${v}|${date}`;
      const idx = invoiceConsumed.get(otherKey) ?? 0;
      const otherAvail = entry.count - idx;
      if (otherAvail > 0) {
        invoiceConsumed.set(otherKey, idx + 1);
        return { status: 'matched-other-day', category: entry.categories[idx] || '' };
      }
    }
    return { status: 'unmatched', category: '' };
  };

  const cashupByDate = new Map(monthCashups.map(c => [c.date, c]));

  const payoutReport = monthManagers.some(e => e.payoutInvoices.length > 0)
    ? monthManagers.flatMap(e => {
        const cashup = cashupByDate.get(e.date);
        return e.payoutInvoices
          .filter(inv => inv.inclusive !== 0)
          .map(inv => ({
            date: e.date,
            cashier: cashup?.cashierName || '',
            vendor: inv.supplier,
            category: inv.category,
            amount: inv.inclusive,
            status: 'matched' as MatchStatus,
          }));
      })
    : monthCashups.flatMap(c =>
        c.shop.payouts.map(p => {
          const match = matchPayout(c.date, p.vendor);
          return {
            date: c.date,
            cashier: c.cashierName,
            vendor: p.vendor,
            category: match.category,
            amount: p.amount,
            status: match.status as MatchStatus,
          };
        })
      ).concat(monthCashups.map(c => {
        const match = matchPayout(c.date, 'Lotto');
        return {
          date: c.date,
          cashier: c.cashierName,
          vendor: 'Lotto',
          category: match.category,
          amount: c.shop.lottoPayouts,
          status: match.status as MatchStatus,
        };
      }).filter(r => r.amount > 0));
  const payoutTotal = payoutReport.reduce((s, r) => s + r.amount, 0);

  // Receipts report
  const receiptsReport = monthCashups.flatMap(c =>
    c.shop.receipts.filter(r => r.amount !== 0).map(r => ({
      date: c.date,
      cashier: c.cashierName,
      type: r.type,
      seqNo: r.seqNo,
      amount: r.amount,
    }))
  );
  const receiptsTotal = receiptsReport.reduce((s, r) => s + r.amount, 0);

  // Speedpoints report — one row per date, columns per terminal.
  // Recon set excludes terminals without a bank match pattern (e.g. V Plus, Scan-to-pay variants
  // that don't show up on the bank statement). Settings → Speedpoint Terminals controls the list.
  const SP_TERMINALS = useMemo(
    () => speedpointTerminals.filter(t => t.bankPattern.trim() !== '').map(t => t.name),
    [speedpointTerminals]
  );
  const [selectedTerminal, setSelectedTerminal] = useState<string>('all');
  const [hideEmptyTerminals, setHideEmptyTerminals] = useState(true);

  // Floating draggable Unmatched panel position (persisted to localStorage)
  const [unmatchedPanelPos, setUnmatchedPanelPos] = useState<{ top: number; left: number }>(() => {
    try {
      const saved = localStorage.getItem('unmatched_panel_pos');
      if (saved) return JSON.parse(saved);
    } catch { /* noop */ }
    const left = typeof window !== 'undefined' ? Math.max(window.innerWidth - 340, 16) : 16;
    return { top: 120, left };
  });
  const unmatchedDragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const handleUnmatchedDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startLeft = unmatchedPanelPos.left;
    const startTop = unmatchedPanelPos.top;
    unmatchedDragRef.current = { offsetX: e.clientX - startLeft, offsetY: e.clientY - startTop };
    const onMove = (ev: MouseEvent) => {
      if (!unmatchedDragRef.current) return;
      const top = Math.max(0, Math.min(window.innerHeight - 80, ev.clientY - unmatchedDragRef.current.offsetY));
      const left = Math.max(0, Math.min(window.innerWidth - 100, ev.clientX - unmatchedDragRef.current.offsetX));
      setUnmatchedPanelPos({ top, left });
    };
    const onUp = () => {
      unmatchedDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  useEffect(() => {
    try { localStorage.setItem('unmatched_panel_pos', JSON.stringify(unmatchedPanelPos)); } catch { /* noop */ }
  }, [unmatchedPanelPos]);
  type SpDateRow = {
    date: string;
    terminals: Record<string, { batchNo: string; shopAmount: number; optAmount: number; total: number }>;
    total: number;
  };
  const applyBpPaySumMatching = (
    parsedLines: BankParsedLine[],
    dateRows: Array<{ date: string; terminals: SpDateRow['terminals'] }>,
    terminal: string,
  ) => {
    if (!terminal) return;
    const claimedDates = new Set<string>();
    const bpBankLines = parsedLines
      .filter(bp => bp.terminal === terminal && !bp.batch)
      .slice()
      .sort((a, b) => parseBankReconDate(a.date) - parseBankReconDate(b.date));
    const bpCashupDays = dateRows
      .filter(r => (r.terminals[terminal]?.total ?? 0) > 0.005)
      .map(r => r.date)
      .sort();

    for (const bp of bpBankLines) {
      const bpTs = parseBankReconDate(bp.date);
      const candidates = bpCashupDays
        .filter(d => parseBankReconDate(d) < bpTs && !claimedDates.has(d))
        .reverse();
      let chosen: string[] | null = null;
      for (let size = 1; size <= 4 && size <= candidates.length; size++) {
        const group = candidates.slice(0, size);
        const sum = group.reduce((s, d) => {
          const row = dateRows.find(r => r.date === d);
          return s + (row?.terminals[terminal]?.total ?? 0);
        }, 0);
        if (Math.abs(sum - bp.amount) < 0.01) { chosen = group; break; }
      }
      if (!chosen) continue;
      const synthBatch = `BPP-${bp.bankLineId.slice(0, 8)}`;
      bp.batch = synthBatch;
      chosen.forEach(d => {
        claimedDates.add(d);
        const row = dateRows.find(r => r.date === d);
        const td = row?.terminals[terminal];
        if (td) td.batchNo = synthBatch;
      });
    }
  };
  const applyUnbatchedBankGroupMatching = (
    parsedLines: BankParsedLine[],
    dateRows: Array<{ date: string; terminals: SpDateRow['terminals'] }>,
    terminal: string,
  ) => {
    if (!terminal) return;
    const claimedBankIds = new Set<string>();
    const rows = dateRows
      .filter(r => (r.terminals[terminal]?.total ?? 0) > 0.005)
      .slice()
      .sort((a, b) => parseBankReconDate(a.date) - parseBankReconDate(b.date));

    rows.forEach(row => {
      const td = row.terminals[terminal];
      if (!td || (td.batchNo && td.batchNo.trim().toUpperCase() !== 'X')) return;
      const rowTs = parseBankReconDate(row.date);
      const candidates = parsedLines.filter(bp => {
        if (bp.terminal !== terminal || bp.batch || claimedBankIds.has(bp.bankLineId)) return false;
        const bankTs = parseBankReconDate(bp.date);
        return bankTs > rowTs && bankTs - rowTs <= 7 * 24 * 60 * 60 * 1000;
      });
      const byBankDate = new Map<string, BankParsedLine[]>();
      candidates.forEach(bp => byBankDate.set(bp.date, [...(byBankDate.get(bp.date) ?? []), bp]));
      const match = [...byBankDate.entries()]
        .sort((a, b) => parseBankReconDate(a[0]) - parseBankReconDate(b[0]))
        .find(([, lines]) => Math.abs(lines.reduce((s, bp) => s + bp.amount, 0) - td.total) < 0.01);
      if (!match) return;
      const lines = match[1];
      const synthBatch = `SET-${row.date}-${terminal}`;
      td.batchNo = synthBatch;
      lines.forEach(bp => {
        bp.batch = synthBatch;
        claimedBankIds.add(bp.bankLineId);
      });
    });
  };
  const speedpointByDate: SpDateRow[] = monthCashups.map(c => {
    const termMap: SpDateRow['terminals'] = {};
    SP_TERMINALS.forEach(t => { termMap[t] = { batchNo: '', shopAmount: 0, optAmount: 0, total: 0 }; });
    c.shop.speedpoints.forEach(sp => {
      if (!termMap[sp.terminal]) termMap[sp.terminal] = { batchNo: '', shopAmount: 0, optAmount: 0, total: 0 };
      const nb = normalizeBatch(sp.batchNo);
      if (nb) termMap[sp.terminal].batchNo = nb;
      termMap[sp.terminal].shopAmount += sp.shopAmount;
    });
    c.opt.speedpoints.forEach(sp => {
      if (!termMap[sp.terminal]) termMap[sp.terminal] = { batchNo: '', shopAmount: 0, optAmount: 0, total: 0 };
      const nb = normalizeBatch(sp.batchNo);
      if (nb) termMap[sp.terminal].batchNo = nb;
      termMap[sp.terminal].optAmount += sp.optAmount;
    });
    let rowTotal = 0;
    SP_TERMINALS.forEach(t => {
      const v = termMap[t];
      if (v) { v.total = v.shopAmount + v.optAmount; rowTotal += v.total; }
    });
    // Also compute totals for non-SP terminals but don't add to rowTotal
    Object.entries(termMap).forEach(([k, v]) => {
      if (!SP_TERMINALS.includes(k)) { v.total = v.shopAmount + v.optAmount; }
    });
    return { date: c.date, terminals: termMap, total: rowTotal };
  });
  const spColumnTotals: Record<string, number> = {};
  SP_TERMINALS.forEach(t => { spColumnTotals[t] = speedpointByDate.reduce((s, r) => s + (r.terminals[t]?.total ?? 0), 0); });
  const spGrandTotal = speedpointByDate.reduce((s, r) => s + r.total, 0);

  // Extract terminal number from SP_TERMINALS name (e.g., 'Term 247608' -> '247608')
  const TERMINAL_NUM_MAP: Record<string, string> = {};
  SP_TERMINALS.forEach(t => {
    const terminalNumber = extractTerminalNumber(t);
    if (terminalNumber) TERMINAL_NUM_MAP[t] = terminalNumber;
  });
  const bpPayTerminal = SP_TERMINALS.find(t => t.toUpperCase().replace(/[^A-Z0-9]/g, '').includes('BPPAY')) || '';
  const bpRewardsTerminal = SP_TERMINALS.find(t => t.toUpperCase().replace(/[^A-Z0-9]/g, '').includes('BPREWARDS')) || '';

  // Parse bank lines: extract batch number from description and build lookup by terminal+batch
  const bankParsed: BankParsedLine[] = [];
  bankLines.forEach((l, idx) => {
    // BP Rewards lines ("SB EFTPOS SET ...") never reconcile against speedpoint
    // cashups — surface them in the Unmatched panel so the user can see them.
    if (/SB\s+EFTPOS\s+SET\b/i.test(l.description)) {
      if (bpRewardsTerminal) bankParsed.push({ terminal: bpRewardsTerminal, batch: '', amount: l.amount, date: l.transaction_date, description: l.description, idx, bankLineId: l.id });
      return;
    }
    const canonicalTerminal = getCanonicalSpeedpointTerminal(l.matched_terminal, SP_TERMINALS);
    if (!canonicalTerminal || !SP_TERMINALS.includes(canonicalTerminal)) return;
    const batch = extractBatchFromDescription(l.description, TERMINAL_NUM_MAP[canonicalTerminal] || '');
    bankParsed.push({ terminal: canonicalTerminal, batch, amount: l.amount, date: l.transaction_date, description: l.description, idx, bankLineId: l.id });
  });

  // ── BP Pay sum-matching ──
  // BP Pay bank descriptions (e.g. "SB EFTPOS bpPAY 7632231") never carry a daily
  // batch number. BP also settles 1 banking day later, and weekend/holiday sales are
  // bundled into a single Monday deposit. So we sum-match: for each BP pay bank line
  // (in date order) we look back across un-claimed prior cashup days (1..4 days)
  // for the BP pay terminal and find the smallest contiguous group whose totals
  // match the bank amount. We then synthesise a shared batch key on both sides so
  // the existing terminal|batch matcher can do the rest.
  if (bpPayTerminal) {
    applyBpPaySumMatching(bankParsed, speedpointByDate, bpPayTerminal);
  }


  // Collect all manually matched bank line IDs first — these take precedence over auto-match
  const manuallyMatchedIds = new Set<string>();
  Object.values(manualMatches).forEach(arr => arr.forEach(bp => manuallyMatchedIds.add(bp.bankLineId)));

  // Build auto-match lookup: key = "terminal|batch" -> bank amount
  // Skip bank lines that are already manually matched (otherwise they'd be counted twice)
  // or that the user explicitly released from auto-matching.
  const bankLookup: Record<string, number> = {};
  bankParsed.forEach(bp => {
    if (!bp.batch) return;
    if (unmatchedAutoIds.has(bp.bankLineId)) return;
    if (manuallyMatchedIds.has(bp.bankLineId)) return;
    const key = `${bp.terminal}|${bp.batch}`;
    bankLookup[key] = (bankLookup[key] || 0) + bp.amount;
  });

  // Build per-row match data including manual matches
  // Each bank amount is consumed by the first cashup row that claims it
  type SpRowMatch = Record<string, { bankAmount: number; diff: number; matched: boolean; manual: boolean; auto: boolean }>;
  const consumedBankKeys = new Set<string>();
  const speedpointMatches: SpRowMatch[] = speedpointByDate.map(r => {
    const rowMatch: SpRowMatch = {};
    SP_TERMINALS.forEach(t => {
      const td = r.terminals[t];
      if (!td || td.total === 0) { rowMatch[t] = { bankAmount: 0, diff: 0, matched: false, manual: false, auto: false }; return; }
      // Auto match by terminal+batch — only if not already consumed by a prior row
      const key = `${t}|${td.batchNo}`;
      let bankAmt = 0;
      let isManual = false;
      let isAuto = false;
      if (!consumedBankKeys.has(key)) {
        bankAmt = bankLookup[key] ?? 0;
        if (bankAmt > 0) { consumedBankKeys.add(key); isAuto = true; }
      }
      // Add manual matches for this cell
      const manualKey = `${r.date}|${t}`;
      const manualLines = manualMatches[manualKey] || [];
      if (manualLines.length > 0) {
        bankAmt += manualLines.reduce((s, ml) => s + ml.amount, 0);
        isManual = true;
      }
      const diff = td.total - bankAmt;
      rowMatch[t] = { bankAmount: bankAmt, diff, matched: bankAmt > 0 && Math.abs(diff) < 0.01, manual: isManual, auto: isAuto };
    });
    return rowMatch;
  });

  // ── Validator: each bank line should map to only ONE speedpoint source (date+terminal) ──
  // Tracks where each bank_line_id is consumed (auto via terminal|batch lookup, or manual).
  // Auto matches that share a terminal|batch key resolve to the same set of bank lines, so if the
  // same key is claimed by multiple cashup rows it counts as a duplicate. Manual matches duplicate
  // when the same bank_line_id is attached to more than one (date|terminal) cell, OR when a bank
  // line is both auto-consumed and manually attached elsewhere.
  const bankLineUsage = useMemo(() => {
    const usage = new Map<string, Array<{ date: string; terminal: string; via: 'auto' | 'manual' }>>();
    const push = (id: string, entry: { date: string; terminal: string; via: 'auto' | 'manual' }) => {
      if (!id) return;
      if (!usage.has(id)) usage.set(id, []);
      usage.get(id)!.push(entry);
    };
    // Auto: walk speedpointByDate in the same order as the matcher above
    const autoConsumed = new Set<string>();
    speedpointByDate.forEach(r => {
      SP_TERMINALS.forEach(t => {
        const td = r.terminals[t];
        if (!td || td.total === 0 || !td.batchNo) return;
        const key = `${t}|${td.batchNo}`;
        if (autoConsumed.has(key)) return;
        const lines = bankParsed.filter(bp => bp.terminal === t && bp.batch === td.batchNo
          && !unmatchedAutoIds.has(bp.bankLineId) && !manuallyMatchedIds.has(bp.bankLineId));
        if (lines.length === 0) return;
        autoConsumed.add(key);
        lines.forEach(bp => push(bp.bankLineId, { date: r.date, terminal: t, via: 'auto' }));
      });
    });
    // Manual: explicit user matches
    Object.entries(manualMatches).forEach(([k, arr]) => {
      const [date, terminal] = k.split('|');
      arr.forEach(bp => push(bp.bankLineId, { date, terminal, via: 'manual' }));
    });
    return usage;
  }, [speedpointByDate, SP_TERMINALS, bankParsed, unmatchedAutoIds, manuallyMatchedIds, manualMatches]);

  const duplicateBankLineWarnings = useMemo(() => {
    const dupes: Array<{ bankLineId: string; description: string; amount: number; date: string; sources: Array<{ date: string; terminal: string; via: 'auto' | 'manual' }> }> = [];
    bankLineUsage.forEach((sources, id) => {
      if (sources.length < 2) return;
      const line = bankLines.find(l => l.id === id);
      dupes.push({
        bankLineId: id,
        description: line?.description ?? '(unknown)',
        amount: line?.amount ?? 0,
        date: line?.transaction_date ?? '',
        sources,
      });
    });
    return dupes;
  }, [bankLineUsage, bankLines]);

  // ── Opening Balance: previous month's unmatched batches ──
  // Parse previous month bank lines
  const prevBankParsed: BankParsedLine[] = [];
  prevBankLines.forEach((l, idx) => {
    if (/SB\s+EFTPOS\s+SET\b/i.test(l.description)) {
      if (bpRewardsTerminal) prevBankParsed.push({ terminal: bpRewardsTerminal, batch: '', amount: l.amount, date: l.transaction_date, description: l.description, idx: idx + 100000, bankLineId: l.id });
      return;
    }
    const canonicalTerminal = getCanonicalSpeedpointTerminal(l.matched_terminal, SP_TERMINALS);
    if (!canonicalTerminal || !SP_TERMINALS.includes(canonicalTerminal)) return;
    const batch = extractBatchFromDescription(l.description, TERMINAL_NUM_MAP[canonicalTerminal] || '');
    prevBankParsed.push({ terminal: canonicalTerminal, batch, amount: l.amount, date: l.transaction_date, description: l.description, idx: idx + 100000, bankLineId: l.id });
  });
  const prevManuallyMatchedIds = new Set<string>();
  Object.values(prevManualMatches).forEach(arr => arr.forEach(bp => prevManuallyMatchedIds.add(bp.bankLineId)));

  // Build previous month speedpoint data
  const prevSpeedpointByDate = prevMonthCashups.map(c => {
    const termMap: SpDateRow['terminals'] = {};
    SP_TERMINALS.forEach(t => { termMap[t] = { batchNo: '', shopAmount: 0, optAmount: 0, total: 0 }; });
    c.shop.speedpoints.forEach(sp => {
      if (!termMap[sp.terminal]) termMap[sp.terminal] = { batchNo: '', shopAmount: 0, optAmount: 0, total: 0 };
      const nb = normalizeBatch(sp.batchNo);
      if (nb) termMap[sp.terminal].batchNo = nb;
      termMap[sp.terminal].shopAmount += sp.shopAmount;
    });
    c.opt.speedpoints.forEach(sp => {
      if (!termMap[sp.terminal]) termMap[sp.terminal] = { batchNo: '', shopAmount: 0, optAmount: 0, total: 0 };
      const nb = normalizeBatch(sp.batchNo);
      if (nb) termMap[sp.terminal].batchNo = nb;
      termMap[sp.terminal].optAmount += sp.optAmount;
    });
    SP_TERMINALS.forEach(t => { const v = termMap[t]; if (v) v.total = v.shopAmount + v.optAmount; });
    return { date: c.date, terminals: termMap };
  });

  if (bpPayTerminal) {
    applyBpPaySumMatching(prevBankParsed, prevSpeedpointByDate, bpPayTerminal);
  }
  SP_TERMINALS
    .filter(t => t !== bpPayTerminal)
    .forEach(t => applyUnbatchedBankGroupMatching(prevBankParsed, prevSpeedpointByDate, t));

  const openingBankLookup: Record<string, { amount: number; ids: string[] }> = {};
  prevBankParsed.forEach(bp => {
    if (!bp.batch) return;
    if (prevManuallyMatchedIds.has(bp.bankLineId)) return;
    const k = `${bp.terminal}|${bp.batch}`;
    if (!openingBankLookup[k]) openingBankLookup[k] = { amount: 0, ids: [] };
    openingBankLookup[k].amount += bp.amount;
    openingBankLookup[k].ids.push(bp.bankLineId);
  });
  const openingAutoMatchedIds = new Set<string>();

  // Find unmatched batches from previous month
  type OBRow = { date: string; terminal: string; batchNo: string; cashupAmount: number; bankAmount: number; diff: number; manualBankAmount: number };
  const openingBalanceRows: OBRow[] = [];
  const prevConsumedBatchKeys = new Set<string>();
  prevSpeedpointByDate.forEach(r => {
    SP_TERMINALS.forEach(t => {
      const td = r.terminals[t];
      if (!td || td.total === 0) return;
      if (isPrevDiffCleared(r.date, t)) return;
      // For auto-match dedup, use terminal+batch — but only skip if batch is non-empty and already consumed
      const batchKey = `${t}|${td.batchNo}`;
      const hasMeaningfulBatch = td.batchNo && td.batchNo.trim().toUpperCase() !== 'X' && td.batchNo.trim() !== '';
      if (hasMeaningfulBatch && prevConsumedBatchKeys.has(batchKey)) return;
      if (hasMeaningfulBatch) prevConsumedBatchKeys.add(batchKey);
      
      const openingAutoMatch = openingBankLookup[batchKey];
      const autoBankAmt = openingAutoMatch?.amount ?? 0;
      
      // Check manual matches from previous month
      const prevManualKey = `${r.date}|${t}`;
      const prevManualLines = prevManualMatches[prevManualKey] || [];
      const prevManualAmt = prevManualLines.reduce((s, ml) => s + ml.amount, 0);
      const totalBank = autoBankAmt + prevManualAmt;
      const diff = td.total - totalBank;
      if (Math.abs(diff) <= 0.01) {
        openingAutoMatch?.ids.forEach(id => openingAutoMatchedIds.add(id));
        return;
      }
      if (Math.abs(diff) > 0.01) {
        // Current-month manual matches clear the carried-forward item inside April,
        // but the row must still appear because it was outstanding at March month-end.
        const obKey = `OB-${r.date}|${t}`;
        const obManualLines = manualMatches[obKey] || [];
        const obManualAmt = obManualLines.reduce((s, ml) => s + ml.amount, 0);
        const finalDiff = diff - obManualAmt;
        openingBalanceRows.push({
          date: r.date,
          terminal: t,
          batchNo: td.batchNo,
          cashupAmount: diff, // The outstanding amount carried forward
          bankAmount: obManualAmt,
          diff: finalDiff,
          manualBankAmount: obManualAmt,
        });
      }
    });
  });

  // Bank totals per terminal
  const bankTerminalTotals: Record<string, number> = {};
  SP_TERMINALS.forEach(t => { bankTerminalTotals[t] = bankParsed.filter(bp => bp.terminal === t).reduce((s, bp) => s + bp.amount, 0); });
  const bankMatchedGrandTotal = Object.values(bankTerminalTotals).reduce((s, v) => s + v, 0);

  // Unmatched: bank lines not auto-matched and not manually matched
  // Use consumedBankKeys from matching above instead of re-deriving
  const unmatchedTerminalLines = bankParsed.filter(bp => {
    if (openingAutoMatchedIds.has(bp.bankLineId)) return false;
    if (manuallyMatchedIds.has(bp.bankLineId)) return false;
    if (unmatchedAutoIds.has(bp.bankLineId)) return true;
    if (!bp.batch) return true;
    return !consumedBankKeys.has(`${bp.terminal}|${bp.batch}`);
  });

  // Active terminals = terminals with any cashup, OB, or bank activity in the month.
  // Used to hide empty columns (e.g. EFT terminals with no entries for the month).
  const activeTerminals = useMemo(() => {
    const active = new Set<string>();
    speedpointByDate.forEach(r => {
      SP_TERMINALS.forEach(t => {
        const td = r.terminals[t];
        if (td && (td.shopAmount !== 0 || td.optAmount !== 0 || (td.batchNo && td.batchNo.trim() !== ''))) {
          active.add(t);
        }
      });
    });
    openingBalanceRows.forEach(ob => active.add(ob.terminal));
    return SP_TERMINALS.filter(t => active.has(t));
  }, [speedpointByDate, openingBalanceRows, SP_TERMINALS]);

  // Visible terminals respects the per-terminal filter and the "hide empty" toggle.
  const visibleTerminals = selectedTerminal === 'all'
    ? (hideEmptyTerminals ? activeTerminals : SP_TERMINALS)
    : [selectedTerminal];

  // Filter unmatched bank lines by the selected terminal so the side panel
  // narrows down to the terminal currently being reconciled.
  const filteredUnmatchedTerminalLines = (selectedTerminal === 'all'
    ? unmatchedTerminalLines
    : unmatchedTerminalLines.filter(l => l.terminal === selectedTerminal)
  ).slice().sort((a, b) => parseBankReconDate(a.date) - parseBankReconDate(b.date));

  // Auto-scroll during drag
  const scrollIntervalRef = useRef<number | null>(null);
  const clearScrollInterval = () => {
    if (scrollIntervalRef.current) { clearInterval(scrollIntervalRef.current); scrollIntervalRef.current = null; }
  };

  // Drag-and-drop handlers
  const handleDragStart = (e: React.DragEvent, bp: BankParsedLine) => {
    e.dataTransfer.setData('application/json', JSON.stringify(bp));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTarget(targetKey);
  };

  const handleDragLeave = () => {
    setDragOverTarget(null);
  };

  // Global drag-over handler for auto-scrolling near edges
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      const EDGE = 80;
      const SPEED = 12;
      clearScrollInterval();
      if (e.clientY < EDGE) {
        scrollIntervalRef.current = window.setInterval(() => window.scrollBy(0, -SPEED), 16);
      } else if (e.clientY > window.innerHeight - EDGE) {
        scrollIntervalRef.current = window.setInterval(() => window.scrollBy(0, SPEED), 16);
      }
    };
    const onDragEnd = () => clearScrollInterval();
    const onDrop = () => clearScrollInterval();
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragend', onDragEnd);
    window.addEventListener('drop', onDrop);
    return () => {
      clearScrollInterval();
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragend', onDragEnd);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  const applyManualMatch = useCallback(async (bp: BankParsedLine, targetKey: string) => {
    const [cashupDate, terminal] = targetKey.split('|');

    const existingTargetKey = Object.entries(manualMatches).find(([, lines]) => lines.some(line => line.bankLineId === bp.bankLineId))?.[0];
    if (existingTargetKey && existingTargetKey !== targetKey) {
      toast({ title: 'Duplicate bank line', description: 'That bank line is already manually matched to another speedpoint source.', variant: 'destructive' });
      return;
    }
    if ((manualMatches[targetKey] || []).some(line => line.bankLineId === bp.bankLineId)) return;

    setManualMatches(prev => ({
      ...prev,
      [targetKey]: [...(prev[targetKey] || []), bp],
    }));
    await supabase.from('speedpoint_manual_matches').insert({
      month: filterMonth,
      cashup_date: cashupDate,
      terminal,
      bank_line_idx: bp.idx,
      bank_amount: bp.amount,
      bank_description: bp.description,
      bank_date: bp.date,
      bank_terminal: bp.terminal,
      bank_batch: bp.batch,
      bank_line_id: bp.bankLineId,
    } as never);
  }, [manualMatches, filterMonth]);

  const handleDrop = async (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    setDragOverTarget(null);
    try {
      const bp: BankParsedLine = JSON.parse(e.dataTransfer.getData('application/json'));
      await applyManualMatch(bp, targetKey);
    } catch {}
  };

  const handleRemoveManualMatch = async (targetKey: string, bankLineId: string) => {
    setManualMatches(prev => {
      const updated = { ...prev };
      updated[targetKey] = (updated[targetKey] || []).filter(bp => bp.bankLineId !== bankLineId);
      if (updated[targetKey].length === 0) delete updated[targetKey];
      return updated;
    });
    // Delete from DB using bank_line_id if available, fallback to old method
    const [cashupDate, terminal] = targetKey.split('|');
    await supabase.from('speedpoint_manual_matches').delete()
      .eq('month', filterMonth)
      .eq('cashup_date', cashupDate)
      .eq('terminal', terminal)
      .eq('bank_line_id', bankLineId);
  };

  // Unmatch all auto-matched bank lines for a given terminal+batch (the cell's auto-match)
  const handleUnmatchAuto = async (terminal: string, batch: string) => {
    if (!batch) return;
    const ids = bankParsed
      .filter(bp => bp.terminal === terminal && bp.batch === batch && !unmatchedAutoIds.has(bp.bankLineId))
      .map(bp => bp.bankLineId);
    if (ids.length === 0) return;
    setUnmatchedAutoIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });
    await supabase.from('speedpoint_unmatched_auto').insert(
      ids.map(id => ({ month: filterMonth, bank_line_id: id, terminal, batch })) as never
    );
  };

  // Re-match: remove a bank line from the user-unmatched list so it auto-matches again
  const handleRematchAuto = async (bankLineId: string) => {
    setUnmatchedAutoIds(prev => {
      const next = new Set(prev);
      next.delete(bankLineId);
      return next;
    });
    await supabase.from('speedpoint_unmatched_auto').delete().eq('bank_line_id', bankLineId);
  };

  // Accounts report — shop + OPT combined per day
  const accountsReport = monthCashups.flatMap(c => {
    const shopRows = c.shop.accounts.map(a => ({
      date: c.date,
      cashier: c.cashierName,
      shift: 'Shop' as const,
      name: a.name,
      amount: a.amount,
    }));
    const optRows = c.opt.accounts.map(a => ({
      date: c.date,
      cashier: c.cashierName,
      shift: 'OPT' as const,
      name: a.name,
      amount: a.amount,
    }));
    return [...shopRows, ...optRows];
  });
  const accountsTotal = accountsReport.reduce((s, r) => s + r.amount, 0);

  // Invoice report
  const [invoiceTypeFilter, setInvoiceTypeFilter] = useState<'all' | 'Payout' | 'EFT'>('all');
  const invoiceReportAll = monthManagers.flatMap(e => [
    ...e.payoutInvoices.map(i => ({ date: e.date, type: 'Payout', supplier: i.supplier, category: i.category, docNum: i.branchDocNum, inclusive: i.inclusive, vat: i.vat })),
    ...e.eftInvoices.map(i => ({ date: e.date, type: 'EFT', supplier: i.supplier, category: i.category, docNum: i.branchDocNum, inclusive: i.inclusive, vat: i.vat })),
  ]);
  const invoiceReport = invoiceTypeFilter === 'all' ? invoiceReportAll : invoiceReportAll.filter(r => r.type === invoiceTypeFilter);
  const invoiceTotal = invoiceReport.reduce((s, r) => s + r.inclusive, 0);
  const invoiceVatTotal = invoiceReport.reduce((s, r) => s + r.vat, 0);

  // MOP report — Cash (CC) uses cashConnectTotal from section 5 MOP Cash.
  // Speedpoints split: terminals with a bankPattern roll into Shop/OPT speedpoint columns;
  // Scan to pay and V Plus get their own dedicated columns (special instruments).
  const SPECIAL_TERMINALS = new Set(['Scan to pay', 'V Plus']);
  const mopReport = monthCashups.map(c => {
    const spTerminals = speedpointTerminals
      .filter(t => t.bankPattern.trim() !== '' && !SPECIAL_TERMINALS.has(t.name))
      .map(t => t.name);
    const shopSP = c.shop.speedpoints.filter(sp => spTerminals.includes(sp.terminal)).reduce((s, sp) => s + sp.shopAmount, 0);
    const optSP = c.opt.speedpoints.filter(sp => spTerminals.includes(sp.terminal)).reduce((s, sp) => s + sp.optAmount, 0);
    const scanToPay = c.shop.speedpoints.filter(sp => sp.terminal === 'Scan to pay').reduce((s, sp) => s + sp.shopAmount, 0)
      + c.opt.speedpoints.filter(sp => sp.terminal === 'Scan to pay').reduce((s, sp) => s + sp.optAmount, 0);
    const vPlus = c.shop.speedpoints.filter(sp => sp.terminal === 'V Plus').reduce((s, sp) => s + sp.shopAmount, 0)
      + c.opt.speedpoints.filter(sp => sp.terminal === 'V Plus').reduce((s, sp) => s + sp.optAmount, 0);
    const shopAcc = c.shop.accounts.reduce((s, a) => s + a.amount, 0);
    const optAcc = c.opt.accounts.reduce((s, a) => s + a.amount, 0);
    const cash = c.shop.cashDepositedBanking + c.shop.easyPay + c.shop.coins;
    return {
      date: c.date,
      cash,
      shopSpeedpoint: shopSP,
      optSpeedpoint: optSP,
      totalSpeedpoint: shopSP + optSP,
      scanToPay,
      vPlus,
      accounts: shopAcc + optAcc,
      total: cash + shopSP + optSP + scanToPay + vPlus + shopAcc + optAcc,
    };
  });

  const exportCSV = (data: Record<string, string | number>[], filename: string) => {
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const rows = data.map(r => headers.map(h => r[h]).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
  };

  const formatDate = (d: string) => {
    try { return format(new Date(d), 'dd MMM yyyy'); } catch { return d; }
  };

  const monthLabel = format(new Date(filterMonth + '-01'), 'MMMM yyyy');

  return (
    <div className="space-y-4">
      <div className="bg-card border rounded-lg p-3 flex items-center gap-3">
        <span className="text-sm font-medium">{monthLabel}</span>
        <span className="text-sm text-muted-foreground ml-2">
          {monthCashups.length} cashup days · {monthManagers.length} manager entries
        </span>
      </div>

      <Tabs defaultValue={mode === 'recons' ? 'speedpoints' : 'daily-summary'}>
        {mode === 'reports' ? (
        <TabsList className="grid grid-cols-6 w-full">
          <TabsTrigger value="daily-summary">Daily Summary</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
          <TabsTrigger value="receipts">Receipts</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="mop">MOP</TabsTrigger>
        </TabsList>
        ) : (
        <TabsList className="grid grid-cols-6 w-full max-w-4xl">
          <TabsTrigger value="speedpoints">Speedpoints</TabsTrigger>
          <TabsTrigger value="creditors">Creditors</TabsTrigger>
          <TabsTrigger value="debtors">Debtors</TabsTrigger>
          <TabsTrigger value="airtime">Airtime / Lotto</TabsTrigger>
          <TabsTrigger value="cash">{cashInTransit === 'Deposita' ? 'Deposita & Coins' : 'Cash CC & Coins'}</TabsTrigger>
          <TabsTrigger value="other-adj">Other Adj.</TabsTrigger>
        </TabsList>
        )}

        {/* Daily Summary */}
        <TabsContent value="daily-summary">
          <DailySummaryReport filterMonth={filterMonth} />
        </TabsContent>

        {/* Payouts */}
        <TabsContent value="payouts">
          <div className="bg-card border rounded-lg overflow-x-clip">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <h3 className="font-semibold text-sm">Detailed Payouts — {monthLabel}</h3>
              <Button size="sm" variant="outline" onClick={() => exportCSV(payoutReport.map(({status, ...rest}) => ({...rest, invoice: status === 'matched' ? 'Yes' : status === 'matched-other-day' ? 'Yes (diff day)' : 'No'})), `payouts-${filterMonth}.csv`)}>
                <Download className="h-3.5 w-3.5 mr-1" />Export CSV
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount (Incl.)</TableHead>
                  <TableHead className="text-center">Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payoutReport.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No payout data for this month</TableCell></TableRow>
                ) : (
                  <>
                    {payoutReport.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{formatDate(r.date)}</TableCell>
                        <TableCell className="text-sm">{r.cashier}</TableCell>
                        <TableCell className="text-sm">
                          {onNavigateToDate ? (
                            <button
                              type="button"
                              className="text-primary underline hover:text-primary/80 cursor-pointer text-left"
                              onClick={() => onNavigateToDate(r.date)}
                            >
                              {r.vendor}
                            </button>
                          ) : r.vendor}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.category || '—'}</TableCell>
                        <TableCell className="text-right"><CurrencyDisplay value={r.amount} /></TableCell>
                        <TableCell className="text-center">
                          {r.status === 'matched'
                            ? <span className="text-green-600 font-bold">✓</span>
                            : r.status === 'matched-other-day'
                            ? <span className="text-orange-500 font-bold">✓</span>
                            : <span className="text-destructive font-bold">✗</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-secondary font-semibold">
                      <TableCell colSpan={5}>TOTAL</TableCell>
                      <TableCell className="text-right"><CurrencyDisplay value={payoutTotal} highlight /></TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
            {payoutReport.length > 0 && (
              <div className="border-t p-4">
                <h4 className="text-sm font-semibold mb-2">Summary by Category - PAYOUTS</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Incl. Amount</TableHead>
                      <TableHead className="text-right">VAT</TableHead>
                      <TableHead className="text-right">Excl. Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const catTotals = payoutReport.reduce((acc, r) => {
                        const cat = r.category || 'Uncategorised';
                        acc[cat] = (acc[cat] || 0) + r.amount;
                        return acc;
                      }, {} as Record<string, number>);
                      const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
                      const grandIncl = sorted.reduce((s, [, v]) => s + v, 0);
                      const grandVat = grandIncl * 15 / 115;
                      const grandExcl = grandIncl - grandVat;
                      return (
                        <>
                          {sorted.map(([cat, incl]) => {
                            const vat = incl * 15 / 115;
                            const excl = incl - vat;
                            return (
                              <TableRow key={cat}>
                                <TableCell className="text-sm">{cat}</TableCell>
                                <TableCell className="text-right"><CurrencyDisplay value={incl} /></TableCell>
                                <TableCell className="text-right"><CurrencyDisplay value={vat} /></TableCell>
                                <TableCell className="text-right"><CurrencyDisplay value={excl} /></TableCell>
                              </TableRow>
                            );
                          })}
                          <TableRow className="bg-secondary font-semibold">
                            <TableCell>TOTAL</TableCell>
                            <TableCell className="text-right"><CurrencyDisplay value={grandIncl} highlight /></TableCell>
                            <TableCell className="text-right"><CurrencyDisplay value={grandVat} highlight /></TableCell>
                            <TableCell className="text-right"><CurrencyDisplay value={grandExcl} highlight /></TableCell>
                          </TableRow>
                        </>
                      );
                    })()}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Receipts */}
        <TabsContent value="receipts">
          <div className="bg-card border rounded-lg overflow-x-clip">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <h3 className="font-semibold text-sm">Detailed Receipts — {monthLabel}</h3>
              <Button size="sm" variant="outline" onClick={() => exportCSV(receiptsReport, `receipts-${filterMonth}.csv`)}>
                <Download className="h-3.5 w-3.5 mr-1" />Export CSV
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Seq No.</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receiptsReport.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No receipt data for this month</TableCell></TableRow>
                ) : (
                  <>
                    {receiptsReport.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{formatDate(r.date)}</TableCell>
                        <TableCell className="text-sm">{r.cashier}</TableCell>
                        <TableCell className="text-sm">{r.type}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.seqNo}</TableCell>
                        <TableCell className="text-right"><CurrencyDisplay value={r.amount} /></TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-secondary font-semibold">
                      <TableCell colSpan={4}>TOTAL</TableCell>
                      <TableCell className="text-right"><CurrencyDisplay value={receiptsTotal} highlight /></TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
            {receiptsReport.length > 0 && (
              <div className="border-t p-4">
                <h4 className="text-sm font-semibold mb-2">Summary by Type</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {Object.entries(
                    receiptsReport.reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + r.amount; return acc; }, {} as Record<string, number>)
                  ).sort((a, b) => b[1] - a[1]).map(([type, total]) => (
                    <div key={type} className="flex justify-between text-sm bg-muted/30 rounded px-2 py-1">
                      <span className="text-muted-foreground truncate mr-2">{type}</span>
                      <CurrencyDisplay value={total} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Speedpoints */}
        <TabsContent value="speedpoints">
          {duplicateBankLineWarnings.length > 0 && (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
              <div className="font-semibold text-destructive mb-1">
                ⚠ {duplicateBankLineWarnings.length} bank line{duplicateBankLineWarnings.length === 1 ? '' : 's'} matched to multiple speedpoint sources
              </div>
              <ul className="space-y-1 max-h-40 overflow-auto">
                {duplicateBankLineWarnings.slice(0, 20).map(d => (
                  <li key={d.bankLineId} className="text-muted-foreground">
                    <span className="font-mono">{d.date}</span> · <CurrencyDisplay value={d.amount} /> ·{' '}
                    <span className="truncate">{d.description}</span>
                    <span className="ml-1 text-foreground">
                      → {d.sources.map(s => `${s.date} ${s.terminal} (${s.via})`).join(' & ')}
                    </span>
                  </li>
                ))}
                {duplicateBankLineWarnings.length > 20 && (
                  <li className="italic">…and {duplicateBankLineWarnings.length - 20} more</li>
                )}
              </ul>
            </div>
          )}
          <div className={`flex gap-4 ${filteredUnmatchedTerminalLines.length > 0 ? '' : ''}`}>
            {/* Main speedpoint report */}
            <div className={`bg-card border rounded-lg overflow-x-clip ${filteredUnmatchedTerminalLines.length > 0 ? 'flex-1 min-w-0' : 'w-full'}`}>
              <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-sm">Speedpoint Report — {monthLabel}</h3>
                  {pendingDiffSelection.length > 0 && (() => {
                    const sum = pendingDiffSelection.reduce((s, p) => s + p.diff, 0);
                    const balanced = Math.abs(sum) < 0.01 && pendingDiffSelection.length >= 2;
                    return (
                      <div className="flex items-center gap-2 bg-primary/10 rounded px-2 py-1 text-xs">
                        <span className="text-primary font-medium">
                          {pendingDiffSelection.length} selected for {pendingDiffSelection[0].terminal} — sum {sum.toFixed(2)}
                        </span>
                        {balanced && (
                          <button
                            onClick={confirmDiffGroup}
                            className="bg-primary text-primary-foreground px-2 py-0.5 rounded font-medium hover:bg-primary/90"
                          >
                            Clear group
                          </button>
                        )}
                        <button onClick={() => setPendingDiffSelection([])} className="text-destructive font-bold hover:text-destructive/80">✕</button>
                      </div>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={hideEmptyTerminals}
                      onChange={(e) => setHideEmptyTerminals(e.target.checked)}
                      className="h-3 w-3"
                    />
                    Hide empty terminals
                  </label>
                  <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
                    <button onClick={() => setSelectedTerminal('all')} className={`px-2 py-1 text-xs rounded ${selectedTerminal === 'all' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}>All</button>
                    {(hideEmptyTerminals ? activeTerminals : SP_TERMINALS).map(t => (
                      <button key={t} onClick={() => setSelectedTerminal(t)} className={`px-2 py-1 text-xs rounded ${selectedTerminal === t ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}>{t}</button>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => {
                    const rows = speedpointByDate.map(r => {
                      const row: Record<string, string | number> = { Date: r.date };
                      SP_TERMINALS.forEach(t => {
                        row[`Batch# ${t}`] = r.terminals[t]?.batchNo ?? '';
                        row[t] = r.terminals[t]?.total ?? 0;
                      });
                      row.Total = r.total;
                      return row;
                    });
                    exportCSV(rows, `speedpoints-${filterMonth}.csv`);
                  }}>
                    <Download className="h-3.5 w-3.5 mr-1" />Export CSV
                  </Button>
                </div>
              </div>
              <TooltipProvider>
                <div
                  ref={(el) => {
                    if (!el) return;
                    if ((el as HTMLDivElement & { __wheelBound?: boolean }).__wheelBound) return;
                    (el as HTMLDivElement & { __wheelBound?: boolean }).__wheelBound = true;
                    el.addEventListener('wheel', (e) => {
                      // Shift+wheel = native horizontal scroll. Plain wheel only
                      // intercepts when the user is hovering the table area AND
                      // the table actually has horizontal overflow — keeps page
                      // vertical scroll working everywhere else.
                      if (e.shiftKey || el.scrollWidth <= el.clientWidth) return;
                      // Only horizontal-scroll if the gesture is mostly vertical
                      // and there's room to move horizontally — otherwise let the
                      // page handle it.
                      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                        const atStart = el.scrollLeft <= 0 && e.deltaY < 0;
                        const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0;
                        if (atStart || atEnd) return;
                        el.scrollLeft += e.deltaY;
                        e.preventDefault();
                      }
                    }, { passive: false });
                  }}
                  className="overflow-x-auto"
                >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead rowSpan={2} className="align-bottom sticky left-0 z-30 bg-background">Date</TableHead>
                      {visibleTerminals.map(t => (
                        <TableHead key={t} colSpan={bankLines.length > 0 ? 4 : 2} className="text-center border-l">{t}</TableHead>
                      ))}
                      <TableHead rowSpan={2} className="text-right align-bottom border-l">Total</TableHead>
                    </TableRow>
                    <TableRow>
                      {visibleTerminals.map(t => (
                        <React.Fragment key={t}>
                          <TableHead className="text-center border-l text-xs text-muted-foreground">Batch#</TableHead>
                          <TableHead className="text-right text-xs text-muted-foreground">Cashup</TableHead>
                          {bankLines.length > 0 && (
                            <>
                              <TableHead className="text-right text-xs text-muted-foreground">Bank</TableHead>
                              <TableHead className="text-right text-xs text-muted-foreground">Diff</TableHead>
                            </>
                          )}
                        </React.Fragment>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {speedpointByDate.length === 0 ? (
                      <TableRow><TableCell colSpan={2 + visibleTerminals.length * (bankLines.length > 0 ? 4 : 2)} className="text-center text-muted-foreground py-8">No speedpoint data for this month</TableCell></TableRow>
                    ) : (
                      <>
                        {/* Opening Balance rows — previous month unmatched batches */}
                        {openingBalanceRows.length > 0 && (
                          <>
                            <TableRow className="bg-amber-50 dark:bg-amber-950/30 border-b-2">
                              <TableCell colSpan={2 + visibleTerminals.length * (bankLines.length > 0 ? 4 : 2)} className="font-semibold text-sm text-amber-800 dark:text-amber-300 py-1">
                                Opening Balance — Outstanding from {format(new Date(prevMonth + '-01'), 'MMMM yyyy')}
                              </TableCell>
                            </TableRow>
                            {openingBalanceRows
                              .filter(ob => visibleTerminals.includes(ob.terminal))
                              .map((ob, obIdx) => {
                                const obDropKey = `OB-${ob.date}|${ob.terminal}`;
                                const obManualLines = manualMatches[obDropKey] || [];
                                const isDragOver = dragOverTarget === obDropKey;
                                const isMatched = Math.abs(ob.diff) < 0.01;
                                return (
                                  <TableRow key={`ob-${obIdx}`} className={`${isMatched ? 'bg-green-50 dark:bg-green-950/20' : 'bg-amber-50/50 dark:bg-amber-950/10'} hover:bg-muted/30`}>
                                    <TableCell className="text-sm font-mono text-muted-foreground sticky left-0 z-10 bg-inherit">{format(new Date(ob.date), 'dd/MM/yyyy')}</TableCell>
                                    {visibleTerminals.map(t => {
                                      if (t !== ob.terminal) {
                                        return (
                                          <React.Fragment key={t}>
                                            <TableCell className="border-l"></TableCell>
                                            <TableCell></TableCell>
                                            {bankLines.length > 0 && (<><TableCell></TableCell><TableCell></TableCell></>)}
                                          </React.Fragment>
                                        );
                                      }
                                      return (
                                        <React.Fragment key={t}>
                                          <TableCell className="text-center text-sm text-muted-foreground border-l">{ob.batchNo}</TableCell>
                                          <TableCell className="text-right"><CurrencyDisplay value={ob.cashupAmount} /></TableCell>
                                          {bankLines.length > 0 && (
                                            <>
                                              <TableCell
                                                className={`text-right text-sm ${!isMatched ? 'cursor-pointer' : ''} ${isDragOver ? 'bg-primary/20 ring-2 ring-primary ring-inset' : ''}`}
                                                onDragOver={!isMatched ? (e) => handleDragOver(e, obDropKey) : undefined}
                                                onDragLeave={!isMatched ? handleDragLeave : undefined}
                                                onDrop={!isMatched ? (e) => handleDrop(e, obDropKey) : undefined}
                                              >
                                                {ob.bankAmount > 0 ? (
                                                  <span className="inline-flex items-center gap-1 justify-end">
                                                    <Tooltip>
                                                      <TooltipTrigger asChild>
                                                        <span className={`${isMatched ? 'text-green-600 font-medium' : ''} underline decoration-dashed cursor-help`}>
                                                          <CurrencyDisplay value={ob.bankAmount} />
                                                        </span>
                                                      </TooltipTrigger>
                                                      <TooltipContent>
                                                        <div className="text-xs space-y-1">
                                                          <div className="font-semibold mb-1">Manual matches:</div>
                                                          {obManualLines.map(ml => (
                                                            <div key={ml.bankLineId} className="flex items-center gap-2">
                                                              <span>{ml.description} = <CurrencyDisplay value={ml.amount} /></span>
                                                              <button onClick={() => handleRemoveManualMatch(obDropKey, ml.bankLineId)} className="text-destructive hover:text-destructive/80 text-xs font-bold">✕</button>
                                                            </div>
                                                          ))}
                                                        </div>
                                                      </TooltipContent>
                                                    </Tooltip>
                                                    {obManualLines.length > 0 && (
                                                      <button
                                                        onClick={() => {
                                                          obManualLines.forEach(ml => handleRemoveManualMatch(obDropKey, ml.bankLineId));
                                                        }}
                                                        className="text-destructive hover:text-destructive/80 text-xs font-bold leading-none"
                                                        title={obManualLines.length === 1 ? 'Remove this manual match' : `Remove all ${obManualLines.length} manual matches`}
                                                      >
                                                        ✕
                                                      </button>
                                                    )}
                                                  </span>
                                                ) : (
                                                  <span className={`text-xs ${isDragOver ? 'text-primary font-medium' : 'text-destructive'}`}>
                                                    {isDragOver ? '⬇ Drop here' : '—'}
                                                  </span>
                                                )}
                                              </TableCell>
                                              <TableCell className="text-right text-sm">
                                                {isMatched ? (
                                                  <span className="text-green-600 text-xs">✓</span>
                                                ) : (() => {
                                                  const obClearKey = `OB-${ob.date}`;
                                                  const cleared = isDiffCleared(obClearKey, ob.terminal);
                                                  const isSelected = pendingDiffSelection.some(p => p.date === obClearKey && p.terminal === ob.terminal);
                                                  return (
                                                    <button
                                                      onClick={() => handleDiffClick(obClearKey, ob.terminal, ob.diff)}
                                                      className={`cursor-pointer px-1 py-0.5 rounded transition-colors ${
                                                        cleared ? 'bg-green-100 dark:bg-green-900/30 line-through text-green-600' :
                                                        isSelected ? 'bg-primary/20 ring-2 ring-primary font-bold' :
                                                        'text-destructive font-semibold hover:bg-destructive/10'
                                                      }`}
                                                      title={cleared ? 'Click to remove clearance' : 'Click to add to offsetting group'}
                                                    >
                                                      <CurrencyDisplay value={ob.diff} />
                                                      {cleared && ' ✓'}
                                                    </button>
                                                  );
                                                })()}
                                              </TableCell>
                                            </>
                                          )}
                                        </React.Fragment>
                                      );
                                    })}
                                    <TableCell className="text-right border-l"><CurrencyDisplay value={ob.cashupAmount} /></TableCell>
                                  </TableRow>
                                );
                              })}
                            {/* OB subtotal */}
                            <TableRow className="bg-amber-100/50 dark:bg-amber-950/20 border-b-2 font-semibold">
                              <TableCell className="text-sm sticky left-0 z-10 bg-inherit">OB Total</TableCell>
                              {visibleTerminals.map(t => {
                                const termOBRows = openingBalanceRows.filter(ob => ob.terminal === t);
                                const obCashup = termOBRows.reduce((s, ob) => s + ob.cashupAmount, 0);
                                const obBank = termOBRows.reduce((s, ob) => s + ob.bankAmount, 0);
                                const obDiff = obCashup - obBank;
                                return (
                                  <React.Fragment key={t}>
                                    <TableCell className="border-l"></TableCell>
                                    <TableCell className="text-right"><CurrencyDisplay value={obCashup} /></TableCell>
                                    {bankLines.length > 0 && (
                                      <>
                                        <TableCell className="text-right"><CurrencyDisplay value={obBank} /></TableCell>
                                        <TableCell className={`text-right ${Math.abs(obDiff) > 0.01 ? 'text-destructive' : 'text-green-600'}`}><CurrencyDisplay value={obDiff} /></TableCell>
                                      </>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                              <TableCell className="text-right border-l"><CurrencyDisplay value={openingBalanceRows.filter(ob => visibleTerminals.includes(ob.terminal)).reduce((s, ob) => s + ob.cashupAmount, 0)} /></TableCell>
                            </TableRow>
                          </>
                        )}
                        {speedpointByDate.map((r, rowIdx) => {
                          const matchData = speedpointMatches[rowIdx];
                          const allMatched = bankLines.length > 0 && visibleTerminals.every(t => {
                            const td = r.terminals[t];
                            return !td || td.total === 0 || matchData[t]?.matched || isDiffCleared(r.date, t);
                          });
                          return (
                            <TableRow key={r.date} className={allMatched ? 'bg-green-50 dark:bg-green-950/20' : 'bg-card hover:bg-muted/30'}>
                              <TableCell className="text-sm font-mono sticky left-0 z-10 bg-inherit">{format(new Date(r.date), 'dd/MM/yyyy')}</TableCell>
                              {visibleTerminals.map(t => {
                                const td = r.terminals[t];
                                const m = matchData[t];
                                return (
                                  <React.Fragment key={t}>
                                    <TableCell className="text-center text-sm text-muted-foreground border-l">{td?.batchNo || ''}</TableCell>
                                    <TableCell className="text-right">
                                      {td && td.total > 0 ? (
                                        <SourceLink date={r.date} source="cashier">
                                          <CurrencyDisplay value={td.total} />
                                        </SourceLink>
                                      ) : (
                                        <span className="text-muted-foreground">0</span>
                                      )}
                                    </TableCell>
                                    {bankLines.length > 0 && (() => {
                                      const dropKey = `${r.date}|${t}`;
                                      const isDropTarget = td && td.total > 0 && !m.matched;
                                      const isDragOver = dragOverTarget === dropKey;
                                      const manualLines = manualMatches[dropKey] || [];
                                      return (
                                        <>
                                          <TableCell
                                            className={`text-right text-sm ${isDropTarget ? 'cursor-pointer' : ''} ${isDragOver ? 'bg-primary/20 ring-2 ring-primary ring-inset' : ''}`}
                                            onDragOver={isDropTarget ? (e) => handleDragOver(e, dropKey) : undefined}
                                            onDragLeave={isDropTarget ? handleDragLeave : undefined}
                                            onDrop={isDropTarget ? (e) => handleDrop(e, dropKey) : undefined}
                                          >
                                            {m.bankAmount > 0 ? (
                                              <span className="inline-flex items-center gap-1 justify-end">
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <span className={`${m.matched ? 'text-green-600 font-medium' : ''} ${m.manual ? 'underline decoration-dashed cursor-help' : ''}`}>
                                                    <CurrencyDisplay value={m.bankAmount} />
                                                  </span>
                                                </TooltipTrigger>
                                                {m.manual && (
                                                  <TooltipContent>
                                                    <div className="text-xs space-y-1">
                                                      <div className="font-semibold mb-1">Manual matches:</div>
                                                      {manualLines.map(ml => (
                                                        <div key={ml.bankLineId} className="flex items-center gap-2">
                                                          <span>{ml.description} = <CurrencyDisplay value={ml.amount} /></span>
                                                          <button onClick={() => handleRemoveManualMatch(dropKey, ml.bankLineId)} className="text-destructive hover:text-destructive/80 text-xs font-bold">✕</button>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  </TooltipContent>
                                                )}
                                              </Tooltip>
                                              {m.auto && td && td.batchNo && (
                                                <button
                                                  onClick={() => handleUnmatchAuto(t, td.batchNo)}
                                                  className="text-destructive hover:text-destructive/80 text-xs font-bold leading-none"
                                                  title="Unmatch this auto-matched bank line"
                                                >
                                                  ✕
                                                </button>
                                              )}
                                              {m.manual && manualLines.length > 0 && (
                                                <button
                                                  onClick={() => {
                                                    manualLines.forEach(ml => handleRemoveManualMatch(dropKey, ml.bankLineId));
                                                  }}
                                                  className="text-destructive hover:text-destructive/80 text-xs font-bold leading-none"
                                                  title={manualLines.length === 1 ? 'Remove this manual match' : `Remove all ${manualLines.length} manual matches`}
                                                >
                                                  ✕
                                                </button>
                                              )}
                                              </span>
                                            ) : td && td.total > 0 ? (
                                              <span className={`text-xs ${isDragOver ? 'text-primary font-medium' : 'text-destructive'}`}>
                                                {isDragOver ? '⬇ Drop here' : '—'}
                                              </span>
                                            ) : <span className="text-muted-foreground">—</span>}
                                          </TableCell>
                                          <TableCell className="text-right text-sm">
                                            {td && td.total > 0 && !m.matched ? (() => {
                                              const cleared = isDiffCleared(r.date, t);
                                              const isSelected = pendingDiffSelection.some(p => p.date === r.date && p.terminal === t);
                                              return (
                                                <button
                                                  onClick={() => handleDiffClick(r.date, t, m.diff)}
                                                  className={`cursor-pointer px-1 py-0.5 rounded transition-colors ${
                                                    cleared ? 'bg-green-100 dark:bg-green-900/30 line-through text-green-600' :
                                                    isSelected ? 'bg-primary/20 ring-2 ring-primary font-bold' :
                                                    'text-destructive font-semibold hover:bg-destructive/10'
                                                  }`}
                                                  title={cleared ? 'Click to remove clearance' : 'Click to add to offsetting group'}
                                                >
                                                  <CurrencyDisplay value={m.diff} />
                                                  {cleared && ' ✓'}
                                                </button>
                                              );
                                            })() : m.matched ? (
                                              <span className="text-green-600 text-xs">✓</span>
                                            ) : <span className="text-muted-foreground">—</span>}
                                          </TableCell>
                                        </>
                                      );
                                    })()}
                                  </React.Fragment>
                                );
                              })}
                              <TableCell className="text-right font-semibold border-l"><CurrencyDisplay value={selectedTerminal === 'all' ? r.total : visibleTerminals.reduce((s, t) => s + (r.terminals[t]?.total ?? 0), 0)} /></TableCell>
                            </TableRow>
                          );
                        })}
                        <TableRow className="bg-secondary font-semibold border-t-2">
                          <TableCell className="sticky left-0 z-10 bg-inherit">TOTAL (incl. OB)</TableCell>
                          {visibleTerminals.map(t => {
                            const obRows = openingBalanceRows.filter(ob => ob.terminal === t);
                            const obCashup = obRows.reduce((s, ob) => s + ob.cashupAmount, 0);
                            const obBank = obRows.reduce((s, ob) => s + ob.bankAmount, 0);
                            const cashupColTotal = (spColumnTotals[t] ?? 0) + obCashup;
                            const bankColTotal = speedpointMatches.reduce((s, rm) => s + (rm[t]?.bankAmount ?? 0), 0) + obBank;
                            const diffColTotal = cashupColTotal - bankColTotal;
                            return (
                              <React.Fragment key={t}>
                                <TableCell className="border-l"></TableCell>
                                <TableCell className="text-right"><CurrencyDisplay value={cashupColTotal} highlight /></TableCell>
                                {bankLines.length > 0 && (
                                  <>
                                    <TableCell className="text-right"><CurrencyDisplay value={bankColTotal} /></TableCell>
                                    <TableCell className={`text-right ${Math.abs(diffColTotal) > 0.01 ? 'text-destructive' : 'text-green-600'}`}>
                                      <CurrencyDisplay value={diffColTotal} />
                                    </TableCell>
                                  </>
                                )}
                              </React.Fragment>
                            );
                          })}
                          <TableCell className="text-right border-l"><CurrencyDisplay value={(selectedTerminal === 'all' ? spGrandTotal : visibleTerminals.reduce((s, t) => s + (spColumnTotals[t] ?? 0), 0)) + openingBalanceRows.filter(ob => visibleTerminals.includes(ob.terminal)).reduce((s, ob) => s + ob.cashupAmount, 0)} highlight /></TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
                </div>
              </TooltipProvider>
            </div>

            {/* Unmatched terminal lines — floating, draggable panel */}
            {filteredUnmatchedTerminalLines.length > 0 && (
              <div
                className="bg-card border rounded-lg shadow-lg overflow-x-clip w-80 fixed z-50"
                style={{ top: unmatchedPanelPos.top, left: unmatchedPanelPos.left }}
              >
                <div
                  onMouseDown={handleUnmatchedDragStart}
                  className="px-3 py-2 border-b bg-destructive/10 cursor-move select-none"
                  title="Drag to move"
                >
                  <h3 className="font-semibold text-sm text-destructive flex items-center gap-2">
                    <span className="text-muted-foreground">⠿</span>
                    Unmatched ({filteredUnmatchedTerminalLines.length}{selectedTerminal !== 'all' ? ` · ${selectedTerminal}` : ''})
                  </h3>
                  <p className="text-xs text-muted-foreground">Drag header to move · Drag rows to match</p>
                </div>
                <div className="max-h-[70vh] overflow-y-auto">
                  {filteredUnmatchedTerminalLines.map((l, i) => {
                    // Best-match suggestion: find an unmatched cashup cell on the
                    // same terminal whose total is closest to this bank amount.
                    // Exact match wins; otherwise closest within R20 tolerance.
                    let best: { date: string; terminal: string; total: number; diff: number } | null = null;
                    speedpointByDate.forEach((r, ri) => {
                      const td = r.terminals[l.terminal];
                      const m = speedpointMatches[ri]?.[l.terminal];
                      if (!td || td.total === 0 || !m || m.matched) return;
                      // Skip if this cell already has any auto/manual amount
                      if (m.bankAmount > 0) return;
                      const diff = Math.abs(td.total - l.amount);
                      if (best === null || diff < best.diff) {
                        best = { date: r.date, terminal: l.terminal, total: td.total, diff };
                      }
                    });
                    const showBest = best && (best as { diff: number }).diff <= 20;
                    return (
                    <div
                      key={i}
                      draggable
                      onDragStart={(e) => handleDragStart(e, l)}
                      className="cursor-grab active:cursor-grabbing hover:bg-muted/30 border-b last:border-b-0 px-3 py-2 text-xs flex flex-col gap-0.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-muted-foreground">{(() => { const ts = parseBankReconDate(l.date); return ts === Number.MAX_SAFE_INTEGER ? l.date : format(new Date(ts), 'dd/MM/yyyy'); })()}</span>
                        <span className="font-semibold"><CurrencyDisplay value={l.amount} /></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">⠿</span>
                        <span className="truncate">{l.terminal} · B{l.batch || '—'}</span>
                        {unmatchedAutoIds.has(l.bankLineId) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRematchAuto(l.bankLineId); }}
                            className="ml-auto text-primary hover:underline text-[10px]"
                            title="Restore the original auto-match"
                          >
                            ↺ re-match
                          </button>
                        )}
                      </div>
                      {showBest && best && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            applyManualMatch(l, `${(best as { date: string }).date}|${(best as { terminal: string }).terminal}`);
                          }}
                          className="text-left text-[10px] text-primary hover:underline mt-0.5"
                          title={`Match to cashup ${(best as { date: string }).date} (cashup total ${(best as { total: number }).total.toFixed(2)}, diff ${(best as { diff: number }).diff.toFixed(2)})`}
                        >
                          ⇢ Best match: {format(new Date((best as { date: string }).date), 'dd/MM')} · <CurrencyDisplay value={(best as { total: number }).total} />
                          {(best as { diff: number }).diff > 0.01 && <> (Δ <CurrencyDisplay value={(best as { diff: number }).diff} />)</>}
                        </button>
                      )}
                    </div>
                    );
                  })}
                  <div className="px-3 py-2 bg-secondary font-semibold text-xs flex justify-between">
                    <span>Total</span>
                    <CurrencyDisplay value={filteredUnmatchedTerminalLines.reduce((s, l) => s + l.amount, 0)} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Accounts */}
        <TabsContent value="accounts">
          <div className="bg-card border rounded-lg overflow-x-clip">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <h3 className="font-semibold text-sm">Accounts Report — {monthLabel}</h3>
              <Button size="sm" variant="outline" onClick={() => exportCSV(accountsReport, `accounts-${filterMonth}.csv`)}>
                <Download className="h-3.5 w-3.5 mr-1" />Export CSV
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>Account Name</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accountsReport.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No accounts data for this month</TableCell></TableRow>
                ) : (
                  <>
                    {accountsReport.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{formatDate(r.date)}</TableCell>
                        <TableCell className="text-sm">{r.cashier}</TableCell>
                        <TableCell>
                          <span className={`text-xs rounded px-1.5 py-0.5 ${r.shift === 'Shop' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>{r.shift}</span>
                        </TableCell>
                        <TableCell className="text-sm">{r.name}</TableCell>
                        <TableCell className="text-right"><CurrencyDisplay value={r.amount} /></TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-secondary font-semibold">
                      <TableCell colSpan={4}>TOTAL</TableCell>
                      <TableCell className="text-right"><CurrencyDisplay value={accountsTotal} highlight /></TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
            {accountsReport.length > 0 && (
              <div className="border-t p-4">
                <h4 className="text-sm font-semibold mb-2">Summary by Account</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {Object.entries(
                    accountsReport.reduce((acc, r) => { acc[r.name] = (acc[r.name] || 0) + r.amount; return acc; }, {} as Record<string, number>)
                  ).sort((a, b) => b[1] - a[1]).map(([name, total]) => (
                    <div key={name} className="flex justify-between text-sm bg-muted/30 rounded px-2 py-1">
                      <span className="text-muted-foreground truncate mr-2">{name}</span>
                      <CurrencyDisplay value={total} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Invoices */}
        <TabsContent value="invoices">
          <div className="bg-card border rounded-lg overflow-x-clip">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <h3 className="font-semibold text-sm">1. Detailed Invoices Per Day</h3>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Type:</label>
                <select
                  value={invoiceTypeFilter}
                  onChange={(e) => setInvoiceTypeFilter(e.target.value as 'all' | 'Payout' | 'EFT')}
                  className="h-8 rounded border bg-background px-2 text-xs"
                >
                  <option value="all">Payout & EFT</option>
                  <option value="Payout">Payout</option>
                  <option value="EFT">EFT</option>
                </select>
                <Button size="sm" variant="outline" onClick={() => exportCSV(invoiceReport, `invoices-${filterMonth}.csv`)}>
                  <Download className="h-3.5 w-3.5 mr-1" />Export CSV
                </Button>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Doc No.</TableHead>
                  <TableHead className="text-right">Inclusive</TableHead>
                  <TableHead className="text-right">VAT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoiceReport.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No invoice data for this month</TableCell></TableRow>
                ) : (
                  <>
                    {invoiceReport.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{formatDate(r.date)}</TableCell>
                        <TableCell><span className={`text-xs rounded px-1.5 py-0.5 ${r.type === 'Payout' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{r.type}</span></TableCell>
                        <TableCell className="text-sm">{r.supplier}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.category}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.docNum}</TableCell>
                        <TableCell className="text-right"><CurrencyDisplay value={r.inclusive} /></TableCell>
                        <TableCell className="text-right"><CurrencyDisplay value={r.vat} /></TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-secondary font-semibold">
                      <TableCell colSpan={5}>TOTAL</TableCell>
                      <TableCell className="text-right"><CurrencyDisplay value={invoiceTotal} highlight /></TableCell>
                      <TableCell className="text-right"><CurrencyDisplay value={invoiceVatTotal} /></TableCell>
                    </TableRow>

                    {/* Summary by Category — EFTs */}
                    {(() => {
                      const eftLines = invoiceReport.filter(r => r.type === 'EFT');
                      const catMap: Record<string, { incl: number; vat: number }> = {};
                      eftLines.forEach(r => {
                        const key = r.category || 'Uncategorised';
                        if (!catMap[key]) catMap[key] = { incl: 0, vat: 0 };
                        catMap[key].incl += r.inclusive;
                        catMap[key].vat += r.vat;
                      });

                      const isCosFuelCategory = (category: string) => category.trim().toLowerCase() === 'cos fuel';
                      const cosFuelEntries = Object.entries(catMap).filter(([k]) => isCosFuelCategory(k));
                      const cosFuel = cosFuelEntries.reduce(
                        (a, [, v]) => ({ incl: a.incl + v.incl, vat: a.vat + v.vat }),
                        { incl: 0, vat: 0 }
                      );
                      const hasCosFuel = cosFuelEntries.length > 0;
                      const otherCats = Object.entries(catMap)
                        .filter(([k]) => !isCosFuelCategory(k))
                        .sort((a, b) => a[0].localeCompare(b[0]))
                        .map(([category, v]) => ({
                          category, incl: v.incl, vat: v.vat, excl: v.incl - v.vat,
                        }));
                      const otherTotals = otherCats.reduce((a, r) => ({ incl: a.incl + r.incl, vat: a.vat + r.vat, excl: a.excl + r.excl }), { incl: 0, vat: 0, excl: 0 });
                      const eftTotals = {
                        incl: cosFuel.incl + otherTotals.incl,
                        vat: cosFuel.vat + otherTotals.vat,
                        excl: (cosFuel.incl - cosFuel.vat) + otherTotals.excl,
                      };

                      return (
                        <>
                          <TableRow><TableCell colSpan={7} className="pt-6 pb-1"><span className="font-semibold text-sm">2. Summary by Category — EFTs</span></TableCell></TableRow>

                          {otherCats.length > 0 && (
                            <>
                              <TableRow className="bg-muted/30">
                                <TableCell colSpan={3} className="font-medium text-xs text-muted-foreground">Category</TableCell>
                                <TableCell className="text-right font-medium text-xs text-muted-foreground">Incl. Amount</TableCell>
                                <TableCell className="text-right font-medium text-xs text-muted-foreground">VAT</TableCell>
                                <TableCell className="text-right font-medium text-xs text-muted-foreground">Excl. Amount</TableCell>
                                <TableCell />
                              </TableRow>
                              {otherCats.map((r, i) => (
                                <TableRow key={`ec-${i}`}>
                                  <TableCell colSpan={3} className="text-sm">{r.category}</TableCell>
                                  <TableCell className="text-right"><CurrencyDisplay value={r.incl} /></TableCell>
                                  <TableCell className="text-right"><CurrencyDisplay value={r.vat} /></TableCell>
                                  <TableCell className="text-right"><CurrencyDisplay value={r.excl} /></TableCell>
                                  <TableCell />
                                </TableRow>
                              ))}
                            </>
                          )}

                          <TableRow className="bg-secondary font-semibold">
                            <TableCell colSpan={3}>EFTs Total</TableCell>
                            <TableCell className="text-right"><CurrencyDisplay value={otherTotals.incl} highlight /></TableCell>
                            <TableCell className="text-right"><CurrencyDisplay value={otherTotals.vat} /></TableCell>
                            <TableCell className="text-right"><CurrencyDisplay value={otherTotals.excl} /></TableCell>
                            <TableCell />
                          </TableRow>

                          {hasCosFuel && (
                            <>
                              <TableRow>
                                <TableCell colSpan={3} className="text-sm">COS Fuel</TableCell>
                                <TableCell className="text-right"><CurrencyDisplay value={cosFuel.incl} /></TableCell>
                                <TableCell className="text-right"><CurrencyDisplay value={cosFuel.vat} /></TableCell>
                                <TableCell className="text-right"><CurrencyDisplay value={cosFuel.incl - cosFuel.vat} /></TableCell>
                                <TableCell />
                              </TableRow>
                              <TableRow className="bg-secondary font-semibold">
                                <TableCell colSpan={3}>EFT Incl Fuel TOTAL</TableCell>
                                <TableCell className="text-right"><CurrencyDisplay value={eftTotals.incl} highlight /></TableCell>
                                <TableCell className="text-right"><CurrencyDisplay value={eftTotals.vat} /></TableCell>
                                <TableCell className="text-right"><CurrencyDisplay value={eftTotals.excl} /></TableCell>
                                <TableCell />
                              </TableRow>
                            </>
                          )}
                        </>
                      );
                    })()}

                    {/* Summary by Category — ALL INVOICES AND PAYOUTS */}
                    {(() => {
                      const catMap: Record<string, { incl: number; vat: number }> = {};
                      invoiceReport.forEach(r => {
                        const key = r.category || 'Uncategorised';
                        if (!catMap[key]) catMap[key] = { incl: 0, vat: 0 };
                        catMap[key].incl += r.inclusive;
                        catMap[key].vat += r.vat;
                      });
                      const catSummary = Object.entries(catMap).sort((a, b) => a[0].localeCompare(b[0])).map(([category, v]) => ({
                        category, incl: v.incl, vat: v.vat, excl: v.incl - v.vat,
                      }));
                      const catTotals = catSummary.reduce((a, r) => ({ incl: a.incl + r.incl, vat: a.vat + r.vat, excl: a.excl + r.excl }), { incl: 0, vat: 0, excl: 0 });

                      return (
                        <>
                          <TableRow><TableCell colSpan={7} className="pt-6 pb-1"><span className="font-semibold text-sm">Summary by Category - ALL INVOICES AND PAYOUTS</span></TableCell></TableRow>
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={3} className="font-medium text-xs text-muted-foreground">Category</TableCell>
                            <TableCell className="text-right font-medium text-xs text-muted-foreground">Incl. Amount</TableCell>
                            <TableCell className="text-right font-medium text-xs text-muted-foreground">VAT</TableCell>
                            <TableCell className="text-right font-medium text-xs text-muted-foreground">Excl. Amount</TableCell>
                            <TableCell />
                          </TableRow>
                          {catSummary.map((r, i) => (
                            <TableRow key={`all-${i}`}>
                              <TableCell colSpan={3} className="text-sm">{r.category}</TableCell>
                              <TableCell className="text-right"><CurrencyDisplay value={r.incl} /></TableCell>
                              <TableCell className="text-right"><CurrencyDisplay value={r.vat} /></TableCell>
                              <TableCell className="text-right"><CurrencyDisplay value={r.excl} /></TableCell>
                              <TableCell />
                            </TableRow>
                          ))}
                          <TableRow className="bg-secondary font-semibold">
                            <TableCell colSpan={3}>All Invoices &amp; Payouts Total</TableCell>
                            <TableCell className="text-right"><CurrencyDisplay value={catTotals.incl} highlight /></TableCell>
                            <TableCell className="text-right"><CurrencyDisplay value={catTotals.vat} /></TableCell>
                            <TableCell className="text-right"><CurrencyDisplay value={catTotals.excl} /></TableCell>
                            <TableCell />
                          </TableRow>
                        </>
                      );
                    })()}
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* MOP */}
        <TabsContent value="mop">
          <div className="bg-card border rounded-lg overflow-x-clip">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <h3 className="font-semibold text-sm">Method of Payment Report — {monthLabel}</h3>
              <Button size="sm" variant="outline" onClick={() => exportCSV(mopReport, `mop-${filterMonth}.csv`)}>
                <Download className="h-3.5 w-3.5 mr-1" />Export CSV
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Cash (CC)</TableHead>
                  <TableHead className="text-right">Shop SP</TableHead>
                  <TableHead className="text-right">OPT SP</TableHead>
                  <TableHead className="text-right">Total SP</TableHead>
                  <TableHead className="text-right">Scan to Pay</TableHead>
                  <TableHead className="text-right">V Plus</TableHead>
                  <TableHead className="text-right">Accounts</TableHead>
                  <TableHead className="text-right">Total MOP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mopReport.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No data for this month</TableCell></TableRow>
                ) : (
                  <>
                    {mopReport.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{formatDate(r.date)}</TableCell>
                        <TableCell className="text-right"><CurrencyDisplay value={r.cash} /></TableCell>
                        <TableCell className="text-right"><CurrencyDisplay value={r.shopSpeedpoint} /></TableCell>
                        <TableCell className="text-right"><CurrencyDisplay value={r.optSpeedpoint} /></TableCell>
                        <TableCell className="text-right"><CurrencyDisplay value={r.totalSpeedpoint} /></TableCell>
                        <TableCell className="text-right"><CurrencyDisplay value={r.scanToPay} /></TableCell>
                        <TableCell className="text-right"><CurrencyDisplay value={r.vPlus} /></TableCell>
                        <TableCell className="text-right"><CurrencyDisplay value={r.accounts} /></TableCell>
                        <TableCell className="text-right font-semibold"><CurrencyDisplay value={r.total} highlight /></TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-secondary font-semibold">
                      <TableCell>TOTAL</TableCell>
                      <TableCell className="text-right"><CurrencyDisplay value={mopReport.reduce((s, r) => s + r.cash, 0)} highlight /></TableCell>
                      <TableCell className="text-right"><CurrencyDisplay value={mopReport.reduce((s, r) => s + r.shopSpeedpoint, 0)} highlight /></TableCell>
                      <TableCell className="text-right"><CurrencyDisplay value={mopReport.reduce((s, r) => s + r.optSpeedpoint, 0)} highlight /></TableCell>
                      <TableCell className="text-right"><CurrencyDisplay value={mopReport.reduce((s, r) => s + r.totalSpeedpoint, 0)} highlight /></TableCell>
                      <TableCell className="text-right"><CurrencyDisplay value={mopReport.reduce((s, r) => s + r.scanToPay, 0)} highlight /></TableCell>
                      <TableCell className="text-right"><CurrencyDisplay value={mopReport.reduce((s, r) => s + r.vPlus, 0)} highlight /></TableCell>
                      <TableCell className="text-right"><CurrencyDisplay value={mopReport.reduce((s, r) => s + r.accounts, 0)} highlight /></TableCell>
                      <TableCell className="text-right"><CurrencyDisplay value={mopReport.reduce((s, r) => s + r.total, 0)} highlight /></TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Creditors */}
        <TabsContent value="creditors">
          <CreditorsRecon filterMonth={filterMonth} />
        </TabsContent>

        {/* Debtors */}
        <TabsContent value="debtors">
          <DebtorsRecon filterMonth={filterMonth} />
        </TabsContent>

        {/* Airtime */}
        <TabsContent value="airtime">
          <AirtimeRecon filterMonth={filterMonth} />
        </TabsContent>

        {/* Other Adjustments */}
        <TabsContent value="other-adj">
          <OtherAdjustmentsRecon filterMonth={filterMonth} onNavigateToDate={onNavigateToDate} />
        </TabsContent>

        {/* Cash Connect & Coins */}
        <TabsContent value="cash">
          <CashRecon filterMonth={filterMonth} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
