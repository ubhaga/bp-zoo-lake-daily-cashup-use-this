import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useCashupStore } from '@/store/cashupStore';
import { useMasterDataStore } from '@/store/masterDataStore';
import { supabase } from '@/integrations/supabase/client';
import { CurrencyDisplay } from '@/components/ui/CashupUI';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import type { OtherAdjustment } from '@/types/cashup';
import { Button } from '@/components/ui/button';
import { Download, Link2, X } from 'lucide-react';
import { downloadCsv } from '@/lib/csvExport';

interface Props {
  filterMonth: string;
  onNavigateToDate?: (date: string) => void;
}

type AdjLine = {
  date: string;
  adjustmentId: string;
  explanation: string;
  amount: number;
  category: string;
  isNetted: boolean;
  bankClearanceId?: string;
  bankLineId?: string;
};

interface BankLine {
  id: string;
  transaction_date: string;
  description: string;
  amount: number;
}

interface Clearance {
  id: string;
  cashup_date: string;
  adjustment_id: string;
  bank_line_id: string;
  amount: number;
}

export function OtherAdjustmentsRecon({ filterMonth, onNavigateToDate }: Props) {
  const { cashups } = useCashupStore();
  const { categories } = useMasterDataStore();

  const [savedCategories, setSavedCategories] = useState<Record<string, string>>({});
  const [bankLines, setBankLines] = useState<BankLine[]>([]);
  const [clearances, setClearances] = useState<Clearance[]>([]);
  const [clearingLine, setClearingLine] = useState<AdjLine | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const loadCategories = useCallback(async () => {
    const { data } = await supabase
      .from('other_adjustment_categories')
      .select('*')
      .eq('month', filterMonth);
    if (data) {
      const map: Record<string, string> = {};
      (data as { cashup_date: string; adjustment_id: string; category: string }[]).forEach(r => {
        map[`${r.cashup_date}|${r.adjustment_id}`] = r.category;
      });
      setSavedCategories(map);
    }
  }, [filterMonth]);

  const loadBankLines = useCallback(async () => {
    const { data } = await supabase
      .from('bank_statement_lines')
      .select('id, transaction_date, description, amount')
      .eq('month', filterMonth);
    setBankLines((data ?? []) as BankLine[]);
  }, [filterMonth]);

  const loadClearances = useCallback(async () => {
    const { data } = await supabase
      .from('other_adj_bank_clearances')
      .select('*')
      .eq('month', filterMonth);
    setClearances((data ?? []) as unknown as Clearance[]);
  }, [filterMonth]);

  useEffect(() => {
    loadCategories();
    loadBankLines();
    loadClearances();
  }, [loadCategories, loadBankLines, loadClearances]);

  const monthCashups = useMemo(
    () => cashups.filter(c => c.month === filterMonth).sort((a, b) => a.date.localeCompare(b.date)),
    [cashups, filterMonth]
  );

  const clearanceMap = useMemo(() => {
    const m: Record<string, Clearance> = {};
    clearances.forEach(c => { m[`${c.cashup_date}|${c.adjustment_id}`] = c; });
    return m;
  }, [clearances]);

  // Build line items and detect returns that net off
  const lines = useMemo(() => {
    const allLines: AdjLine[] = [];

    const push = (date: string, adjustmentId: string, explanation: string, amount: number) => {
      if (Math.abs(amount) < 0.01) return;
      const key = `${date}|${adjustmentId}`;
      const cl = clearanceMap[key];
      allLines.push({
        date,
        adjustmentId,
        explanation,
        amount,
        category: savedCategories[key] || '',
        isNetted: false,
        bankClearanceId: cl?.id,
        bankLineId: cl?.bank_line_id,
      });
    };

    monthCashups.forEach(c => {
      const adjs = (c.shop.otherAdjustments || []) as OtherAdjustment[];
      adjs.forEach(adj => push(c.date, adj.id, adj.explanation || '', adj.amount));

      push(c.date, '__attendant_short_over__', 'Attendant Short/(Over)', c.shop.attendantShortOver ?? 0);
      push(c.date, '__returns_not_captured__', 'Returns not captured', c.shop.returnsNotCaptured ?? 0);
      push(c.date, '__returns_mop__', 'Returns MOP (Yesterday)', c.shop.returns_mop ?? 0);

      const cName = (c.shop.customerName ?? '').trim();
      push(c.date, '__customer_to_pay__', cName ? `Customer to Pay/(Paid) — ${cName}` : 'Customer to Pay/(Paid)', c.shop.customerToPay ?? 0);

      const eName = (c.shop.customerPaidEFTName ?? '').trim();
      push(c.date, '__customer_paid_eft__', eName ? `Customer Paid EFT — ${eName}` : 'Customer Paid EFT', c.shop.customerPaidEFT ?? 0);

      (c.shop.extraAttendantShortOvers ?? []).forEach((row) => {
        push(c.date, row.id, row.name ? `Attendant Short/(Over) — ${row.name}` : 'Attendant Short/(Over)', row.amount);
      });
      (c.shop.extraCustomerToPays ?? []).forEach((row) => {
        push(c.date, row.id, row.name ? `Customer to Pay/(Paid) — ${row.name}` : 'Customer to Pay/(Paid)', row.amount);
      });
      (c.shop.extraCustomerPaidEFTs ?? []).forEach((row) => {
        push(c.date, row.id, row.name ? `Customer Paid EFT — ${row.name}` : 'Customer Paid EFT', row.amount);
      });
    });

    // Detect returns that net each other off on consecutive days
    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i].isNetted || allLines[i].bankClearanceId) continue;
      for (let j = i + 1; j < allLines.length; j++) {
        if (allLines[j].isNetted || allLines[j].bankClearanceId) continue;
        const a = allLines[i];
        const b = allLines[j];
        if (Math.abs(a.amount + b.amount) < 0.01) {
          const dateA = new Date(a.date);
          const dateB = new Date(b.date);
          const diffDays = Math.abs(dateB.getTime() - dateA.getTime()) / (1000 * 60 * 60 * 24);
          const sameExplanation =
            a.explanation.trim().toLowerCase() === b.explanation.trim().toLowerCase() &&
            a.explanation.trim() !== '';
          const crossMatch =
            (a.adjustmentId === '__returns_not_captured__' && b.adjustmentId === '__returns_mop__' && diffDays === 1 && dateB > dateA) ||
            (a.adjustmentId === '__returns_mop__' && b.adjustmentId === '__returns_not_captured__' && diffDays === 1 && dateA > dateB);
          if ((sameExplanation && diffDays <= 1) || crossMatch) {
            allLines[i].isNetted = true;
            allLines[j].isNetted = true;
          }
        }
      }
    }

    return allLines;
  }, [monthCashups, savedCategories, clearanceMap]);

  const handleCategoryChange = async (date: string, adjustmentId: string, category: string) => {
    const key = `${date}|${adjustmentId}`;
    setSavedCategories(prev => ({ ...prev, [key]: category }));

    const { error } = await supabase
      .from('other_adjustment_categories')
      .upsert(
        { month: filterMonth, cashup_date: date, adjustment_id: adjustmentId, category } as never,
        { onConflict: 'month,cashup_date,adjustment_id' }
      );

    if (error) {
      toast({ title: 'Error saving category', description: error.message, variant: 'destructive' });
    }
  };

  const handleClearToBank = async (line: AdjLine, bankLineId: string) => {
    const { error } = await supabase
      .from('other_adj_bank_clearances')
      .upsert(
        {
          month: filterMonth,
          cashup_date: line.date,
          adjustment_id: line.adjustmentId,
          bank_line_id: bankLineId,
          amount: line.amount,
        } as never,
        { onConflict: 'month,cashup_date,adjustment_id' }
      );
    if (error) {
      toast({ title: 'Error clearing', description: error.message, variant: 'destructive' });
      return;
    }
    setClearingLine(null);
    setSearchTerm('');
    await loadClearances();
    toast({ title: 'Cleared to bank statement' });
  };

  const handleUnclear = async (clearanceId: string) => {
    const { error } = await supabase
      .from('other_adj_bank_clearances')
      .delete()
      .eq('id', clearanceId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    await loadClearances();
  };

  const formatDate = (d: string) => {
    try { return format(new Date(d), 'dd MMM'); } catch { return d; }
  };

  const activeLines = lines.filter(l => !l.isNetted && !l.bankClearanceId);
  const nettedLines = lines.filter(l => l.isNetted);
  const clearedLines = lines.filter(l => !!l.bankClearanceId && !l.isNetted);
  const nonNettedTotal = activeLines.reduce((s, l) => s + l.amount, 0);
  const nettedTotal = nettedLines.reduce((s, l) => s + l.amount, 0);
  const clearedTotal = clearedLines.reduce((s, l) => s + l.amount, 0);

  const bankLineById = useMemo(() => {
    const m: Record<string, BankLine> = {};
    bankLines.forEach(b => { m[b.id] = b; });
    return m;
  }, [bankLines]);

  // Suggested bank lines for the dialog: prefer same absolute amount,
  // then lines whose description shares words from the explanation.
  const suggestedBankLines = useMemo(() => {
    if (!clearingLine) return [];
    const target = Math.abs(clearingLine.amount);
    const usedIds = new Set(clearances.map(c => c.bank_line_id));
    const candidates = bankLines.filter(b => !usedIds.has(b.id));
    return candidates
      .map(b => {
        const sameAmount = Math.abs(Math.abs(b.amount) - target) < 0.01;
        const term = searchTerm.trim().toLowerCase();
        const matchesSearch = !term ||
          b.description.toLowerCase().includes(term) ||
          b.transaction_date.toLowerCase().includes(term) ||
          String(b.amount).includes(term);
        return { b, sameAmount, matchesSearch };
      })
      .filter(x => x.matchesSearch)
      .sort((a, b) => {
        if (a.sameAmount !== b.sameAmount) return a.sameAmount ? -1 : 1;
        return a.b.transaction_date.localeCompare(b.b.transaction_date);
      });
  }, [clearingLine, bankLines, clearances, searchTerm]);

  const categoryTotals = useMemo(() => {
    const map: Record<string, number> = {};
    activeLines.filter(l => l.category).forEach(l => {
      map[l.category] = (map[l.category] || 0) + l.amount;
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [activeLines]);

  const uncategorised = activeLines.filter(l => !l.category);

  return (
    <div className="space-y-4">
      {/* Active Items Table */}
      <div className="bg-card border rounded-lg overflow-x-clip">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
          <h3 className="font-semibold text-sm">Items to Reconcile — {filterMonth}</h3>
          <Button size="sm" variant="outline" onClick={() => {
            downloadCsv(
              ['Date', 'Explanation', 'Amount', 'Category', 'Status'],
              lines.map(l => [
                formatDate(l.date), l.explanation, l.amount, l.category || '',
                l.isNetted ? 'Netted' : l.bankClearanceId ? 'Cleared to bank' : '',
              ]),
              `other-adjustments-recon-${filterMonth}.csv`
            );
          }}>
            <Download className="h-3.5 w-3.5 mr-1" />Export CSV
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Date</TableHead>
              <TableHead>Explanation</TableHead>
              <TableHead className="text-right w-28">Amount</TableHead>
              <TableHead className="w-52">Category</TableHead>
              <TableHead className="w-32 text-center">Bank Clearance</TableHead>
              <TableHead className="w-20 text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeLines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No items to reconcile for this month
                </TableCell>
              </TableRow>
            ) : (
              <>
                {activeLines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{formatDate(l.date)}</TableCell>
                    <TableCell className="text-sm">
                      {onNavigateToDate ? (
                        <button
                          className="text-primary underline hover:text-primary/80 text-left"
                          onClick={() => onNavigateToDate(l.date)}
                        >
                          {l.explanation}
                        </button>
                      ) : (
                        l.explanation
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <CurrencyDisplay value={l.amount} />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={l.category || '__none__'}
                        onValueChange={(v) => handleCategoryChange(l.date, l.adjustmentId, v === '__none__' ? '' : v)}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— Select —</SelectItem>
                          {categories.map(cat => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => { setClearingLine(l); setSearchTerm(''); }}
                      >
                        <Link2 className="h-3 w-3 mr-1" /> Clear to bank
                      </Button>
                    </TableCell>
                    <TableCell className="text-center">
                      {l.category ? (
                        <span className="text-xs bg-green-100 text-green-700 rounded px-1.5 py-0.5">✓</span>
                      ) : (
                        <span className="text-xs bg-yellow-100 text-yellow-700 rounded px-1.5 py-0.5">?</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-secondary font-semibold">
                  <TableCell colSpan={2}>TOTAL (excl. netted &amp; cleared)</TableCell>
                  <TableCell className="text-right"><CurrencyDisplay value={nonNettedTotal} highlight /></TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Category Summary */}
      {categoryTotals.length > 0 && (
        <div className="bg-card border rounded-lg overflow-x-clip">
          <div className="px-4 py-2 border-b bg-muted/30">
            <h3 className="font-semibold text-sm">Category Summary</h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categoryTotals.map(([cat, amt]) => (
                <TableRow key={cat}>
                  <TableCell className="text-sm">{cat}</TableCell>
                  <TableCell className="text-right"><CurrencyDisplay value={amt} /></TableCell>
                </TableRow>
              ))}
              {uncategorised.length > 0 && (
                <TableRow>
                  <TableCell className="text-sm text-yellow-600">Uncategorised ({uncategorised.length} items)</TableCell>
                  <TableCell className="text-right"><CurrencyDisplay value={uncategorised.reduce((s, l) => s + l.amount, 0)} /></TableCell>
                </TableRow>
              )}
              <TableRow className="bg-secondary font-semibold">
                <TableCell>NET TOTAL (excl. netted &amp; cleared)</TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={nonNettedTotal} highlight /></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {/* Cleared to Bank Statement */}
      {clearedLines.length > 0 && (
        <div className="bg-card border rounded-lg overflow-x-clip">
          <div className="px-4 py-2 border-b bg-muted/30">
            <h3 className="font-semibold text-sm">Cleared to Bank Statement</h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Date</TableHead>
                <TableHead>Explanation</TableHead>
                <TableHead className="text-right w-28">Amount</TableHead>
                <TableHead>Bank Line</TableHead>
                <TableHead className="w-16 text-center">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clearedLines.map((l, i) => {
                const bl = l.bankLineId ? bankLineById[l.bankLineId] : undefined;
                return (
                  <TableRow key={i} className="bg-green-50/40">
                    <TableCell className="text-sm">{formatDate(l.date)}</TableCell>
                    <TableCell className="text-sm">{l.explanation}</TableCell>
                    <TableCell className="text-right"><CurrencyDisplay value={l.amount} /></TableCell>
                    <TableCell className="text-xs">
                      {bl ? (
                        <span>
                          {bl.transaction_date} — {bl.description}
                          {' '}<span className="text-muted-foreground">(<CurrencyDisplay value={bl.amount} />)</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">Bank line not found</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <button
                        type="button"
                        onClick={() => l.bankClearanceId && handleUnclear(l.bankClearanceId)}
                        className="text-muted-foreground hover:text-destructive"
                        title="Remove clearance"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-secondary font-semibold">
                <TableCell colSpan={2}>CLEARED TOTAL</TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={clearedTotal} /></TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {/* Netted Items Table */}
      {nettedLines.length > 0 && (
        <div className="bg-card border rounded-lg overflow-x-clip opacity-80">
          <div className="px-4 py-2 border-b bg-muted/30">
            <h3 className="font-semibold text-sm text-muted-foreground">Netted Items (self-cancelling)</h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Date</TableHead>
                <TableHead>Explanation</TableHead>
                <TableHead className="text-right w-28">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nettedLines.map((l, i) => (
                <TableRow key={i} className="bg-muted/20">
                  <TableCell className="text-sm">{formatDate(l.date)}</TableCell>
                  <TableCell className="text-sm">
                    {onNavigateToDate ? (
                      <button
                        className="text-primary underline hover:text-primary/80 text-left"
                        onClick={() => onNavigateToDate(l.date)}
                      >
                        {l.explanation}
                      </button>
                    ) : (
                      l.explanation
                    )}
                  </TableCell>
                  <TableCell className="text-right"><CurrencyDisplay value={l.amount} /></TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-secondary font-semibold">
                <TableCell colSpan={2}>NETTED TOTAL</TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={nettedTotal} /></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {/* Bank Line Picker Dialog */}
      <Dialog open={!!clearingLine} onOpenChange={(open) => { if (!open) { setClearingLine(null); setSearchTerm(''); } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Clear to bank statement line</DialogTitle>
          </DialogHeader>
          {clearingLine && (
            <div className="space-y-3">
              <div className="text-sm bg-muted/40 rounded px-3 py-2">
                <div><span className="text-muted-foreground">Date:</span> {formatDate(clearingLine.date)}</div>
                <div><span className="text-muted-foreground">Item:</span> {clearingLine.explanation}</div>
                <div><span className="text-muted-foreground">Amount:</span> <CurrencyDisplay value={clearingLine.amount} /></div>
              </div>
              <Input
                placeholder="Search by date, description or amount..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
              />
              <div className="max-h-[420px] overflow-y-auto border rounded">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right w-28">Amount</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suggestedBankLines.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No bank lines available</TableCell></TableRow>
                    ) : suggestedBankLines.map(({ b, sameAmount }) => (
                      <TableRow key={b.id} className={sameAmount ? 'bg-green-50/50' : ''}>
                        <TableCell className="text-xs whitespace-nowrap">{b.transaction_date}</TableCell>
                        <TableCell className="text-xs">{b.description}</TableCell>
                        <TableCell className="text-right"><CurrencyDisplay value={b.amount} /></TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => handleClearToBank(clearingLine, b.id)}>
                            Select
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Lines highlighted green match the amount exactly. Pick any line to mark this item as cleared.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
