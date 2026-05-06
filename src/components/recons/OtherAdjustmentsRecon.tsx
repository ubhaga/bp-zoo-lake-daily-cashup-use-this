import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useCashupStore } from '@/store/cashupStore';
import { useMasterDataStore } from '@/store/masterDataStore';
import { supabase } from '@/integrations/supabase/client';
import { CurrencyDisplay } from '@/components/ui/CashupUI';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addDays } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import type { OtherAdjustment } from '@/types/cashup';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
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
  isNetted: boolean; // returns that net each other off
};

export function OtherAdjustmentsRecon({ filterMonth, onNavigateToDate }: Props) {
  const { cashups } = useCashupStore();
  const { categories } = useMasterDataStore();

  const [savedCategories, setSavedCategories] = useState<Record<string, string>>({});

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

  useEffect(() => { loadCategories(); }, [loadCategories]);

  const monthCashups = useMemo(
    () => cashups.filter(c => c.month === filterMonth).sort((a, b) => a.date.localeCompare(b.date)),
    [cashups, filterMonth]
  );

  // Build line items and detect returns that net off
  const lines = useMemo(() => {
    const allLines: AdjLine[] = [];

    monthCashups.forEach(c => {
      const adjs = (c.shop.otherAdjustments || []) as OtherAdjustment[];
      adjs.forEach(adj => {
        if (Math.abs(adj.amount) < 0.01) return;
        const key = `${c.date}|${adj.id}`;
        allLines.push({
          date: c.date,
          adjustmentId: adj.id,
          explanation: adj.explanation || '',
          amount: adj.amount,
          category: savedCategories[key] || '',
          isNetted: false,
        });
      });

      // Include Attendant Short/(Over) as a line item
      const attendant = c.shop.attendantShortOver ?? 0;
      if (Math.abs(attendant) >= 0.01) {
        const attKey = `${c.date}|__attendant_short_over__`;
        allLines.push({
          date: c.date,
          adjustmentId: '__attendant_short_over__',
          explanation: 'Attendant Short/(Over)',
          amount: attendant,
          category: savedCategories[attKey] || '',
          isNetted: false,
        });
      }

      // Include Returns not captured as a line item
      const returnsNC = c.shop.returnsNotCaptured ?? 0;
      if (Math.abs(returnsNC) >= 0.01) {
        const rncKey = `${c.date}|__returns_not_captured__`;
        allLines.push({
          date: c.date,
          adjustmentId: '__returns_not_captured__',
          explanation: 'Returns not captured',
          amount: returnsNC,
          category: savedCategories[rncKey] || '',
          isNetted: false,
        });
      }

      // Include Returns MOP (Returns from Yesterday) as a line item
      const returnsMop = c.shop.returns_mop ?? 0;
      if (Math.abs(returnsMop) >= 0.01) {
        const mopKey = `${c.date}|__returns_mop__`;
        allLines.push({
          date: c.date,
          adjustmentId: '__returns_mop__',
          explanation: 'Returns MOP (Yesterday)',
          amount: returnsMop,
          category: savedCategories[mopKey] || '',
          isNetted: false,
        });
      }

      // Include base Customer to Pay/(Paid) as a line item
      const baseCustomer = c.shop.customerToPay ?? 0;
      if (Math.abs(baseCustomer) >= 0.01) {
        const cKey = `${c.date}|__customer_to_pay__`;
        const cName = (c.shop.customerName ?? '').trim();
        allLines.push({
          date: c.date,
          adjustmentId: '__customer_to_pay__',
          explanation: cName ? `Customer to Pay/(Paid) — ${cName}` : 'Customer to Pay/(Paid)',
          amount: baseCustomer,
          category: savedCategories[cKey] || '',
          isNetted: false,
        });
      }

      // Include base Customer Paid EFT as a line item
      const baseCustomerEFT = c.shop.customerPaidEFT ?? 0;
      if (Math.abs(baseCustomerEFT) >= 0.01) {
        const ekey = `${c.date}|__customer_paid_eft__`;
        const eName = (c.shop.customerPaidEFTName ?? '').trim();
        allLines.push({
          date: c.date,
          adjustmentId: '__customer_paid_eft__',
          explanation: eName ? `Customer Paid EFT — ${eName}` : 'Customer Paid EFT',
          amount: baseCustomerEFT,
          category: savedCategories[ekey] || '',
          isNetted: false,
        });
      }

      // Include extra Attendant Short/(Over) rows as line items
      (c.shop.extraAttendantShortOvers ?? []).forEach((row) => {
        if (Math.abs(row.amount) < 0.01) return;
        const key = `${c.date}|${row.id}`;
        allLines.push({
          date: c.date,
          adjustmentId: row.id,
          explanation: row.name ? `Attendant Short/(Over) — ${row.name}` : 'Attendant Short/(Over)',
          amount: row.amount,
          category: savedCategories[key] || '',
          isNetted: false,
        });
      });

      // Include extra Customer to Pay/(Paid) rows as line items
      (c.shop.extraCustomerToPays ?? []).forEach((row) => {
        if (Math.abs(row.amount) < 0.01) return;
        const key = `${c.date}|${row.id}`;
        allLines.push({
          date: c.date,
          adjustmentId: row.id,
          explanation: row.name ? `Customer to Pay/(Paid) — ${row.name}` : 'Customer to Pay/(Paid)',
          amount: row.amount,
          category: savedCategories[key] || '',
          isNetted: false,
        });
      });

      // Include extra Customer Paid EFT rows as line items
      (c.shop.extraCustomerPaidEFTs ?? []).forEach((row) => {
        if (Math.abs(row.amount) < 0.01) return;
        const key = `${c.date}|${row.id}`;
        allLines.push({
          date: c.date,
          adjustmentId: row.id,
          explanation: row.name ? `Customer Paid EFT — ${row.name}` : 'Customer Paid EFT',
          amount: row.amount,
          category: savedCategories[key] || '',
          isNetted: false,
        });
      });
    });

    // Detect returns that net each other off on consecutive days
    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i].isNetted) continue;
      for (let j = i + 1; j < allLines.length; j++) {
        if (allLines[j].isNetted) continue;
        const a = allLines[i];
        const b = allLines[j];
        if (Math.abs(a.amount + b.amount) < 0.01) {
          const dateA = new Date(a.date);
          const dateB = new Date(b.date);
          const diffDays = Math.abs(dateB.getTime() - dateA.getTime()) / (1000 * 60 * 60 * 24);
          // Same explanation match (consecutive days)
          const sameExplanation =
            a.explanation.trim().toLowerCase() === b.explanation.trim().toLowerCase() &&
            a.explanation.trim() !== '';
          // Cross-type match: Returns not captured (Day N) vs Returns MOP (Day N+1)
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
  }, [monthCashups, savedCategories]);

  const handleCategoryChange = async (date: string, adjustmentId: string, category: string) => {
    const key = `${date}|${adjustmentId}`;
    setSavedCategories(prev => ({ ...prev, [key]: category }));

    const { error } = await supabase
      .from('other_adjustment_categories')
      .upsert(
        {
          month: filterMonth,
          cashup_date: date,
          adjustment_id: adjustmentId,
          category,
        } as never,
        { onConflict: 'month,cashup_date,adjustment_id' }
      );

    if (error) {
      toast({ title: 'Error saving category', description: error.message, variant: 'destructive' });
    }
  };

  const formatDate = (d: string) => {
    try { return format(new Date(d), 'dd MMM'); } catch { return d; }
  };

  const activeLines = lines.filter(l => !l.isNetted);
  const nettedLines = lines.filter(l => l.isNetted);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const nonNettedTotal = activeLines.reduce((s, l) => s + l.amount, 0);
  const nettedTotal = nettedLines.reduce((s, l) => s + l.amount, 0);

  // Group by category for summary
  const categoryTotals = useMemo(() => {
    const map: Record<string, number> = {};
    lines.filter(l => !l.isNetted && l.category).forEach(l => {
      map[l.category] = (map[l.category] || 0) + l.amount;
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [lines]);

  const uncategorised = lines.filter(l => !l.isNetted && !l.category);

  return (
    <div className="space-y-4">
      {/* Active Items Table */}
      <div className="bg-card border rounded-lg overflow-x-clip">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
          <h3 className="font-semibold text-sm">Items to Reconcile — {filterMonth}</h3>
          <Button size="sm" variant="outline" onClick={() => {
            downloadCsv(
              ['Date', 'Explanation', 'Amount', 'Category', 'Netted'],
              lines.map(l => [formatDate(l.date), l.explanation, l.amount, l.category || '', l.isNetted ? 'Yes' : 'No']),
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
              <TableHead className="w-20 text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeLines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
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
                      {l.category ? (
                        <span className="text-xs bg-green-100 text-green-700 rounded px-1.5 py-0.5">✓</span>
                      ) : (
                        <span className="text-xs bg-yellow-100 text-yellow-700 rounded px-1.5 py-0.5">?</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-secondary font-semibold">
                  <TableCell colSpan={2}>TOTAL (excl. netted)</TableCell>
                  <TableCell className="text-right"><CurrencyDisplay value={nonNettedTotal} highlight /></TableCell>
                  <TableCell colSpan={2} />
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
                <TableCell>NET TOTAL (excl. netted)</TableCell>
                <TableCell className="text-right"><CurrencyDisplay value={nonNettedTotal} highlight /></TableCell>
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
    </div>
  );
}
