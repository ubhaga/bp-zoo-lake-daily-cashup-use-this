import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMasterDataStore } from '@/store/masterDataStore';
import { CurrencyDisplay } from '@/components/ui/CashupUI';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Trash2, Download, X, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useBankAllocations } from '@/hooks/useBankAllocations';
import { loadBankRules, computeAllocationsFromRules } from '@/lib/bankRules';
import { parseBankStatementDate } from '@/lib/bankStatementDate';
import { useCashupStore } from '@/store/cashupStore';

const DEBTOR_ACCOUNTS = [
  'Mahindra', 'Lancaster Pharmacy', 'Hyde Park Toyota', 'Hltc', 'St Theresas',
  'Sayinile', 'Red cross', 'Umesh', 'Isuzu bakkie', 'Bp Zoolake',
  'Bp Zoolake Account Customer', 'Shell Parkhurst', 'House tech', 'Moses bpzl',
  'Generator', 'Shop Expense',
];

interface BankLine {
  id: string;
  month: string;
  transaction_date: string;
  description: string;
  amount: number;
  matched_terminal: string;
  raw_line: string;
  created_at: string;
}

interface Props {
  filterMonth: string;
  monthLabel: string;
}

export function BankStatementTab({ filterMonth, monthLabel }: Props) {
  const [lines, setLines] = useState<BankLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const { eftSuppliers, accounts, speedpointTerminals } = useMasterDataStore();
  const { allocations, upsert: upsertAllocation } = useBankAllocations(filterMonth);
  const managerEntries = useCashupStore((s) => s.managerEntries);

  // Sundry vendors used in this month's invoices — exposed as allocation targets so
  // bank lines can be linked to a specific sundry vendor. Allocations are scoped per
  // month (via bank_line_allocations.month) so they reset naturally each new month.
  const sundryVendorOptions = useMemo(() => {
    const set = new Set<string>();
    managerEntries
      .filter((e) => e.date.startsWith(filterMonth))
      .forEach((e) => {
        e.eftInvoices.forEach((inv) => {
          if (inv.supplier === 'Sundry Supplier') {
            const v = (inv.vendorName ?? '').trim();
            if (v) set.add(`Sundry: ${v}`);
          }
        });
        e.payoutInvoices.forEach((inv) => {
          if (inv.supplier === 'Sundry Supplier') {
            const v = (inv.vendorName ?? '').trim();
            if (v) set.add(`Sundry: ${v}`);
          }
        });
      });
    return [...set].sort();
  }, [managerEntries, filterMonth]);

  // Optional URL/sessionStorage filter (set when user clicks the bank link from Settings).
  const [terminalFilter, setTerminalFilter] = useState<{ pattern: string; label: string } | null>(null);
  useEffect(() => {
    try {
      const pattern = sessionStorage.getItem('bank_filter_pattern');
      const label = sessionStorage.getItem('bank_filter_label');
      if (pattern) {
        setTerminalFilter({ pattern, label: label || pattern });
        sessionStorage.removeItem('bank_filter_pattern');
        sessionStorage.removeItem('bank_filter_label');
      }
    } catch {
      // noop
    }
  }, [filterMonth]);

  // Build runtime patterns from master data
  const TERMINAL_PATTERNS = useMemo(
    () =>
      speedpointTerminals
        .filter(t => t.bankPattern.trim() !== '')
        .map(t => {
          let pattern: RegExp;
          try { pattern = new RegExp(t.bankPattern, 'i'); }
          catch { pattern = new RegExp(t.bankPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
          return { pattern, terminal: t.name };
        }),
    [speedpointTerminals]
  );

  const loadLines = useCallback(async () => {
    const { data } = await supabase
      .from('bank_statement_lines')
      .select('*')
      .eq('month', filterMonth)
      .order('transaction_date');
    setLines((data ?? []) as unknown as BankLine[]);
  }, [filterMonth]);

  useEffect(() => { loadLines(); }, [loadLines]);

  const matchTerminal = (desc: string): string => {
    for (const { pattern, terminal } of TERMINAL_PATTERNS) {
      if (pattern.test(desc)) return terminal;
    }
    return '';
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);

    try {
      const text = await file.text();
      const csvLines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (csvLines.length < 2) { toast.error('CSV file appears empty'); setLoading(false); return; }

      const parseCSVRow = (row: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        let quoteChar: '"' | "'" | null = null;
        for (const char of row) {
          if (inQuotes) {
            if (char === quoteChar) { inQuotes = false; quoteChar = null; }
            else { current += char; }
          } else if (char === '"' || char === "'") {
            inQuotes = true;
            quoteChar = char as '"' | "'";
          } else if (char === ',') {
            result.push(current.trim()); current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result;
      };

      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(csvLines.length, 20); i++) {
        const lower = csvLines[i].toLowerCase();
        if (lower.includes('date') && (lower.includes('amount') || lower.includes('description') || lower.includes('balance'))) {
          headerRowIdx = i;
          break;
        }
      }
      if (headerRowIdx === -1) {
        toast.error('Could not find header row in CSV.');
        setLoading(false);
        return;
      }

      const headers = parseCSVRow(csvLines[headerRowIdx]).map(h => h.toLowerCase().replace(/["']/g, '').trim()).filter(Boolean);
      const dateIdx = headers.findIndex(h => h.includes('date'));
      const descIdx = headers.findIndex(h => h.includes('description') || h.includes('narrative') || h.includes('detail') || h.includes('reference') || h.includes('particulars'));
      let amountIdx = headers.findIndex(h => h === 'amount' || h === 'transaction amount' || h === 'value');
      const debitIdx = headers.findIndex(h => h.includes('debit') || h === 'dr');
      const creditIdx = headers.findIndex(h => h.includes('credit') || h === 'cr');
      const useDebitCredit = amountIdx === -1 && (debitIdx !== -1 || creditIdx !== -1);

      if (dateIdx === -1 || (descIdx === -1 && amountIdx === -1 && !useDebitCredit)) {
        toast.error(`Could not auto-detect columns. Found headers: ${headers.join(', ')}.`);
        setLoading(false);
        return;
      }

      // Logical-key dedup (date|description|amount) — more robust than raw_line,
      // since a bank may re-export the same transaction with different whitespace
      // or quoting. The DB also enforces this via a unique index as a safety net.
      const existingKeys = new Set(
        lines.map(l => `${l.transaction_date}|${l.description}|${l.amount}`)
      );
      const seenInBatch = new Set<string>();
      const newRows: Omit<BankLine, 'id' | 'created_at'>[] = [];
      let duplicates = 0;
      let outOfMonth = 0;

      for (let i = headerRowIdx + 1; i < csvLines.length; i++) {
        const fields = parseCSVRow(csvLines[i]);
        const maxIdx = Math.max(dateIdx, descIdx !== -1 ? descIdx : 0, useDebitCredit ? Math.max(debitIdx, creditIdx) : amountIdx);
        if (fields.length <= maxIdx) continue;

        const rawLine = csvLines[i];
        const desc = descIdx !== -1 ? fields[descIdx] : fields.slice(Math.max(dateIdx, amountIdx) + 1).join(' ').trim();
        let amt: number;
        if (useDebitCredit) {
          const debit = debitIdx !== -1 ? parseFloat(fields[debitIdx].replace(/[^0-9.\-]/g, '')) || 0 : 0;
          const credit = creditIdx !== -1 ? parseFloat(fields[creditIdx].replace(/[^0-9.\-]/g, '')) || 0 : 0;
          amt = credit - debit;
          if (debit === 0 && credit === 0) continue;
        } else {
          amt = parseFloat(fields[amountIdx].replace(/[^0-9.\-]/g, ''));
          if (isNaN(amt)) continue;
        }

        // Skip rows whose transaction date does not belong to the selected month.
        // filterMonth is "YYYY-MM"; parseBankStatementDate returns "YYYY-MM-DD".
        const isoDate = parseBankStatementDate(fields[dateIdx]);
        if (!isoDate || isoDate.slice(0, 7) !== filterMonth) {
          outOfMonth++;
          continue;
        }

        const key = `${fields[dateIdx]}|${desc}|${amt}`;
        if (existingKeys.has(key) || seenInBatch.has(key)) { duplicates++; continue; }
        seenInBatch.add(key);

        newRows.push({
          month: filterMonth,
          transaction_date: fields[dateIdx],
          description: desc,
          amount: amt,
          matched_terminal: matchTerminal(desc),
          raw_line: rawLine,
        });
      }

      if (newRows.length > 0) {
        // Upsert with ignoreDuplicates against the unique index
        // (month, transaction_date, description, amount). This is an atomic
        // safety net even if two uploads race or local state is stale.
        const { error } = await supabase
          .from('bank_statement_lines')
          .upsert(newRows as never[], {
            onConflict: 'month,transaction_date,description,amount',
            ignoreDuplicates: true,
          });
        if (error) { toast.error('Upload failed: ' + error.message); }
        else {
          const { data: matches } = await supabase
            .from('speedpoint_manual_matches')
            .select('id, bank_line_id, bank_description, bank_amount, bank_batch, bank_terminal')
            .eq('month', filterMonth);
          if (matches && matches.length > 0) {
            const { data: allBankLines } = await supabase
              .from('bank_statement_lines')
              .select('id, description, amount, matched_terminal')
              .eq('month', filterMonth);
            const bankLineIds = new Set((allBankLines ?? []).map(b => b.id));
            const orphaned = (matches as { id: string; bank_line_id: string | null; bank_description: string; bank_amount: number; bank_batch: string; bank_terminal: string }[])
              .filter(m => m.bank_line_id && !bankLineIds.has(m.bank_line_id));
            for (const m of orphaned) {
              const candidates = (allBankLines ?? []).filter(b => Number(b.amount) === Number(m.bank_amount));
              // Prefer terminal + batch match (stable across description format changes)
              let newLine = candidates.find(b => {
                if ((b as { matched_terminal: string }).matched_terminal !== m.bank_terminal) return false;
                if (!m.bank_batch) return true;
                return new RegExp(`(^|\\D)${m.bank_batch}(\\D|$)`).test(b.description);
              });
              if (!newLine) newLine = candidates.find(b => b.description === m.bank_description);
              if (newLine) {
                await supabase.from('speedpoint_manual_matches').update({ bank_line_id: newLine.id } as never).eq('id', m.id);
              }
            }
          }
          // Auto-apply Bank Rules to the freshly-uploaded month so users
          // don't have to remember to click "Apply rules" after every upload.
          // Existing manual allocations are preserved (onConflict skip).
          let autoAllocated = 0;
          try {
            const [rulesData, freshLinesRes, allocRes] = await Promise.all([
              loadBankRules(),
              supabase
                .from('bank_statement_lines')
                .select('id, description, amount')
                .eq('month', filterMonth),
              supabase
                .from('bank_line_allocations')
                .select('bank_line_id')
                .eq('month', filterMonth),
            ]);
            const freshLines = (freshLinesRes.data ?? []) as { id: string; description: string; amount: number }[];
            const allocated = new Set(((allocRes.data ?? []) as { bank_line_id: string }[]).map(a => a.bank_line_id));
            const pending = computeAllocationsFromRules(freshLines, rulesData, allocated);
            if (pending.length > 0) {
              const rows = pending.map(p => ({ ...p, month: filterMonth }));
              const { error: aErr } = await supabase
                .from('bank_line_allocations')
                .upsert(rows as never[], { onConflict: 'bank_line_id' });
              if (!aErr) autoAllocated = pending.length;
            }
          } catch {
            // Rule application is best-effort — never block the upload.
          }
          const parts = [`Uploaded ${newRows.length} lines`];
          if (duplicates > 0) parts.push(`${duplicates} duplicates skipped`);
          if (outOfMonth > 0) parts.push(`${outOfMonth} skipped (outside ${monthLabel})`);
          if (autoAllocated > 0) parts.push(`${autoAllocated} auto-allocated by rules`);
          toast.success(parts.join(', '));
          await loadLines();
        }
      } else {
        const infoParts: string[] = [];
        if (duplicates > 0) infoParts.push(`${duplicates} duplicates`);
        if (outOfMonth > 0) infoParts.push(`${outOfMonth} outside ${monthLabel}`);
        toast.info(infoParts.length > 0 ? `No new lines added (${infoParts.join(', ')})` : 'No valid lines found in CSV');
      }
    } catch (err) {
      toast.error('Failed to parse CSV file');
    }

    setLoading(false);
    e.target.value = '';
  };

  const handleClearMonth = async () => {
    if (!confirm(`Delete all bank statement lines for ${monthLabel}?`)) return;
    await supabase.from('bank_statement_lines').delete().eq('month', filterMonth);
    setLines([]);
    toast.success('Bank statement lines cleared');
  };

  const terminalSummary = TERMINAL_PATTERNS.map(({ terminal }) => {
    const matched = lines.filter(l => l.matched_terminal === terminal);
    return { terminal, total: matched.reduce((s, l) => s + l.amount, 0), count: matched.length };
  });
  const unmatchedLines = lines.filter(l => !l.matched_terminal);
  const unmatchedTotal = unmatchedLines.reduce((s, l) => s + l.amount, 0);
  const grandTotal = lines.reduce((s, l) => s + l.amount, 0);

  // When a terminal filter is active (from Settings), restrict the displayed rows.
  const visibleLines = useMemo(() => {
    if (!terminalFilter) return lines;
    let re: RegExp;
    try { re = new RegExp(terminalFilter.pattern, 'i'); }
    catch { re = new RegExp(terminalFilter.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
    return lines.filter(l => re.test(l.description));
  }, [lines, terminalFilter]);
  const visibleTotal = visibleLines.reduce((s, l) => s + l.amount, 0);

  const exportCSV = () => {
    const headers = ['Date', 'Description', 'Amount', 'Matched Terminal', 'Allocation'];
    const rows = lines.map(l => {
      const alloc = allocations.find(a => a.bank_line_id === l.id);
      const allocLabel = alloc ? `${alloc.recon_type}: ${alloc.target_name}` : '';
      return [l.transaction_date, `"${l.description}"`, l.amount, l.matched_terminal, allocLabel].join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `bank-statement-${filterMonth}.csv`; a.click();
  };

  // Build allocation options
  const allocationOptions = [
    {
      group: 'Creditor',
      items: [
        ...[...eftSuppliers].filter((s) => s !== 'Sundry Supplier').sort(),
        ...sundryVendorOptions,
      ],
    },
    { group: 'Debtor', items: [...(accounts.length > 0 ? accounts : DEBTOR_ACCOUNTS)].sort() },
  ];

  const getAllocationValue = (lineId: string) => {
    const alloc = allocations.find(a => a.bank_line_id === lineId);
    return alloc ? `${alloc.recon_type}::${alloc.target_name}` : '';
  };

  const handleAllocationChange = async (lineId: string, value: string) => {
    if (value === 'none' || !value) {
      await upsertAllocation(lineId, '', '');
    } else {
      const [reconType, targetName] = value.split('::');
      await upsertAllocation(lineId, reconType, targetName);
    }
  };

  const startEditDescription = (l: BankLine) => {
    setEditingId(l.id);
    setEditValue(l.description);
  };

  const saveEditDescription = async () => {
    if (!editingId) return;
    const id = editingId;
    const newDesc = editValue.trim();
    const original = lines.find(l => l.id === id);
    setEditingId(null);
    if (!original || newDesc === original.description) return;
    if (!newDesc) { toast.error('Description cannot be empty'); return; }
    const newTerminal = matchTerminal(newDesc);
    const { error } = await supabase
      .from('bank_statement_lines')
      .update({ description: newDesc, matched_terminal: newTerminal } as never)
      .eq('id', id);
    if (error) { toast.error('Update failed: ' + error.message); return; }
    setLines(prev => prev.map(l => l.id === id ? { ...l, description: newDesc, matched_terminal: newTerminal } : l));
    toast.success('Description updated');
  };

  return (
    <div className="bg-card border rounded-lg overflow-x-clip">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <h3 className="font-semibold text-sm">Bank Statement — {monthLabel}</h3>
        <div className="flex gap-2">
          <label className="cursor-pointer">
            <input type="file" accept=".csv" onChange={handleUpload} className="hidden" disabled={loading} />
            <Button size="sm" variant="outline" asChild disabled={loading}>
              <span><Upload className="h-3.5 w-3.5 mr-1" />{loading ? 'Uploading...' : 'Upload CSV'}</span>
            </Button>
          </label>
          {lines.length > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={exportCSV}>
                <Download className="h-3.5 w-3.5 mr-1" />Export
              </Button>
              <Button size="sm" variant="destructive" onClick={handleClearMonth}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />Clear
              </Button>
            </>
          )}
        </div>
      </div>

      {terminalFilter && (
        <div className="border-b px-4 py-2 bg-primary/5 flex items-center justify-between text-xs">
          <span>
            Filtered by terminal pattern <span className="font-mono font-semibold">{terminalFilter.pattern}</span>
            {terminalFilter.label !== terminalFilter.pattern && <> ({terminalFilter.label})</>}
            {' '}— showing <span className="font-semibold">{visibleLines.length}</span> of {lines.length} lines,
            total <CurrencyDisplay value={visibleTotal} />
          </span>
          <button
            onClick={() => setTerminalFilter(null)}
            className="flex items-center gap-1 text-primary hover:text-primary/70"
          >
            <X className="h-3 w-3" /> Clear filter
          </button>
        </div>
      )}

      {lines.length > 0 && (
        <div className="border-b p-4">
          <h4 className="text-sm font-semibold mb-2">Terminal Matching Summary</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {terminalSummary.map(t => (
              <div key={t.terminal} className="flex justify-between text-sm bg-muted/30 rounded px-2 py-1">
                <span className="text-muted-foreground truncate mr-2">{t.terminal} ({t.count})</span>
                <CurrencyDisplay value={t.total} />
              </div>
            ))}
            <div className="flex justify-between text-sm bg-muted/30 rounded px-2 py-1">
              <span className="text-muted-foreground truncate mr-2">Unmatched ({unmatchedLines.length})</span>
              <CurrencyDisplay value={unmatchedTotal} />
            </div>
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Terminal</TableHead>
            <TableHead className="min-w-[200px]">Allocation</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No bank statement uploaded for this month.</TableCell></TableRow>
          ) : visibleLines.length === 0 ? (
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No lines match the active terminal filter.</TableCell></TableRow>
          ) : (
            <>
              {visibleLines.map(l => (
                <TableRow key={l.id} className={l.matched_terminal ? 'hover:bg-muted/30' : 'bg-muted/10 hover:bg-muted/30'}>
                  <TableCell className="text-sm font-mono">{l.transaction_date}</TableCell>
                  <TableCell className="text-sm max-w-[250px] truncate">{l.description}</TableCell>
                  <TableCell className="text-right"><CurrencyDisplay value={l.amount} /></TableCell>
                  <TableCell className="text-sm">
                    {l.matched_terminal ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">{l.matched_terminal}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="p-1">
                    <Select
                      value={getAllocationValue(l.id) || 'none'}
                      onValueChange={(v) => handleAllocationChange(l.id, v)}
                    >
                      <SelectTrigger className="h-7 text-xs w-full">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {allocationOptions.map(group => (
                          <React.Fragment key={group.group}>
                            <SelectItem value={`__header_${group.group}`} disabled className="font-semibold text-xs text-muted-foreground">
                              ── {group.group}s ──
                            </SelectItem>
                            {group.items.map(item => (
                              <SelectItem key={`${group.group}::${item}`} value={`${group.group.toLowerCase()}::${item}`}>
                                {item}
                              </SelectItem>
                            ))}
                          </React.Fragment>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="p-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={async () => {
                        await supabase.from('bank_statement_lines').delete().eq('id', l.id);
                        setLines(prev => prev.filter(x => x.id !== l.id));
                        toast.success('Line deleted');
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-secondary font-semibold">
                <TableCell colSpan={2}>
                  TOTAL ({visibleLines.length}{terminalFilter ? ` of ${lines.length}` : ''} lines)
                </TableCell>
                <TableCell className="text-right">
                  <CurrencyDisplay value={terminalFilter ? visibleTotal : grandTotal} highlight />
                </TableCell>
                <TableCell colSpan={3}></TableCell>
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
