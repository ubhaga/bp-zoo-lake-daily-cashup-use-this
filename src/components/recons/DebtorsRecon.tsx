import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useCashupStore } from '@/store/cashupStore';
import { useMasterDataStore } from '@/store/masterDataStore';
import { supabase } from '@/integrations/supabase/client';
import { CurrencyDisplay, CurrencyInput } from '@/components/ui/CashupUI';
import { SourceBreakdown, type BreakdownEntry } from '@/components/ui/SourceBreakdown';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Save, Download, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { downloadCsv } from '@/lib/csvExport';
import { useBankAllocations } from '@/hooks/useBankAllocations';
import { useReconAdjustments } from '@/hooks/useReconAdjustments';
import { ReconAdjustDialog } from './ReconAdjustDialog';

interface DebtorsReconProps {
  filterMonth: string;
}

// Mapping of bank statement description patterns to account names
const BANK_PAYMENT_RULES: { pattern: RegExp; account: string }[] = [
  { pattern: /ST TERESA/i, account: 'St Theresas' },
  { pattern: /OSIRIS.*LANCASTER|LANCASTER.*PHARMACY/i, account: 'Lancaster Pharmacy' },
  { pattern: /FNB OB.*HPT|HYDE PARK TOYOTA/i, account: 'Hyde Park Toyota' },
  { pattern: /CR BP ZOO.*ISUZU/i, account: 'Isuzu bakkie' },
  { pattern: /CR BP ZOO.*MAHINDRA|BP ZOO MAHINDRA/i, account: 'Mahindra' },
  { pattern: /CR BP ZOO.*LAKE.*DSL|BP ZOO LAKE DSL/i, account: 'Bp Zoolake' },
];

const normalizeDebtorAccountName = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

// JE3 writeoff accounts — their purchases are also shown as adjustments (reducing closing balance)
const JE3_WRITEOFF_ACCOUNTS = ['Generator', 'Shop Expense', 'Umesh'];

export function DebtorsRecon({ filterMonth }: DebtorsReconProps) {
  const { cashups } = useCashupStore();
  const accounts = useMasterDataStore(s => s.accounts);
  const { allocations: bankAllocations } = useBankAllocations(filterMonth);
  const { adjustments: debtorAdjustments, getAdjustment, saveAdjustment } = useReconAdjustments(
    'debtor',
    filterMonth,
  );
  const [editingAdj, setEditingAdj] = useState<{ name: string; auto: number } | null>(null);

  // Pull debtor accounts from master data settings so the recon stays in sync
  const DEBTOR_ACCOUNTS = useMemo(() => [...accounts].sort((a, b) => a.localeCompare(b)), [accounts]);
  const DEBTOR_ACCOUNT_LOOKUP = useMemo(() => {
    return DEBTOR_ACCOUNTS.reduce<Record<string, string>>((acc, name) => {
      acc[normalizeDebtorAccountName(name)] = name;
      return acc;
    }, {});
  }, [DEBTOR_ACCOUNTS]);
  const getCanonicalDebtorAccountName = useCallback(
    (value: string) => DEBTOR_ACCOUNT_LOOKUP[normalizeDebtorAccountName(value)] ?? null,
    [DEBTOR_ACCOUNT_LOOKUP],
  );

  const [bankLines, setBankLines] = useState<{ id: string; amount: number; description: string; transaction_date: string }[]>([]);
  const [openingBalances, setOpeningBalances] = useState<Record<string, number>>({});
  const [prevMonthBankLines, setPrevMonthBankLines] = useState<typeof bankLines>([]);
  const [prevMonthOpeningBalances, setPrevMonthOpeningBalances] = useState<Record<string, number>>({});
  const [editingOB, setEditingOB] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const isFirstMonth = filterMonth === '2026-03';

  // Previous month for rolling balances
  const prevMonth = useMemo(() => {
    const d = new Date(filterMonth + '-01');
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  }, [filterMonth]);

  const loadData = useCallback(async () => {
    const [bankRes, obRes] = await Promise.all([
      supabase.from('bank_statement_lines').select('id, amount, description, transaction_date').eq('month', filterMonth),
      supabase.from('creditor_opening_balances').select('*').eq('month', filterMonth),
    ]);
    setBankLines((bankRes.data ?? []) as typeof bankLines);
    // Re-use creditor_opening_balances table for debtors too (with "debtor:" prefix)
    const obMap: Record<string, number> = {};
    ((obRes.data ?? []) as { supplier: string; amount: number }[]).forEach(r => {
      if (r.supplier.startsWith('debtor:')) {
        obMap[r.supplier.replace('debtor:', '')] = Number(r.amount);
      }
    });
    setOpeningBalances(obMap);
    setEditingOB({});

    if (!isFirstMonth) {
      const [prevBankRes, prevObRes] = await Promise.all([
        supabase.from('bank_statement_lines').select('id, amount, description, transaction_date').eq('month', prevMonth),
        supabase.from('creditor_opening_balances').select('*').eq('month', prevMonth),
      ]);

      setPrevMonthBankLines((prevBankRes.data ?? []) as typeof bankLines);

      const prevObMap: Record<string, number> = {};
      ((prevObRes.data ?? []) as { supplier: string; amount: number }[]).forEach(r => {
        if (r.supplier.startsWith('debtor:')) {
          prevObMap[r.supplier.replace('debtor:', '')] = Number(r.amount);
        }
      });
      setPrevMonthOpeningBalances(prevObMap);
    } else {
      setPrevMonthBankLines([]);
      setPrevMonthOpeningBalances({});
    }
  }, [filterMonth, isFirstMonth, prevMonth]);

  useEffect(() => { loadData(); }, [loadData]);

  // Purchases: sum of account entries from cashups for each debtor
  const purchases = useMemo(() => {
    const monthlyCashups = cashups.filter(c => c.month === filterMonth);
    const totals: Record<string, number> = {};
    DEBTOR_ACCOUNTS.forEach(a => { totals[a] = 0; });
    for (const c of monthlyCashups) {
      for (const a of c.shop.accounts ?? []) {
        const canonicalName = getCanonicalDebtorAccountName(a.name);
        if (canonicalName) totals[canonicalName] += a.amount;
      }
      for (const a of c.opt.accounts ?? []) {
        const canonicalName = getCanonicalDebtorAccountName(a.name);
        if (canonicalName) totals[canonicalName] += a.amount;
      }
    }
    return totals;
  }, [filterMonth, cashups]);

  // Per-debtor purchase breakdown (date + amount) for source drilldown
  const purchaseEntries = useMemo(() => {
    const monthlyCashups = cashups.filter(c => c.month === filterMonth);
    const map: Record<string, BreakdownEntry[]> = {};
    DEBTOR_ACCOUNTS.forEach(a => { map[a] = []; });
    for (const c of monthlyCashups) {
      for (const a of c.shop.accounts ?? []) {
        const canonicalName = getCanonicalDebtorAccountName(a.name);
        if (canonicalName && a.amount) map[canonicalName].push({ date: c.date, amount: a.amount, label: 'Shop' });
      }
      for (const a of c.opt.accounts ?? []) {
        const canonicalName = getCanonicalDebtorAccountName(a.name);
        if (canonicalName && a.amount) map[canonicalName].push({ date: c.date, amount: a.amount, label: 'OPT' });
      }
    }
    return map;
  }, [filterMonth, cashups, DEBTOR_ACCOUNTS, getCanonicalDebtorAccountName]);

  const prevMonthPurchases = useMemo(() => {
    const monthlyCashups = cashups.filter(c => c.month === prevMonth);
    const totals: Record<string, number> = {};
    DEBTOR_ACCOUNTS.forEach(a => { totals[a] = 0; });
    for (const c of monthlyCashups) {
      for (const a of c.shop.accounts ?? []) {
        const canonicalName = getCanonicalDebtorAccountName(a.name);
        if (canonicalName) totals[canonicalName] += a.amount;
      }
      for (const a of c.opt.accounts ?? []) {
        const canonicalName = getCanonicalDebtorAccountName(a.name);
        if (canonicalName) totals[canonicalName] += a.amount;
      }
    }
    return totals;
  }, [prevMonth, cashups]);

  // Bank payments mapped to debtors
  const bankPayments = useMemo(() => {
    const totals: Record<string, number> = {};
    DEBTOR_ACCOUNTS.forEach(a => { totals[a] = 0; });
    for (const line of bankLines) {
      if (line.amount <= 0) continue;
      // Check manual allocation first
      const allocation = bankAllocations.find(a => a.bank_line_id === line.id && a.recon_type === 'debtor');
      if (allocation) {
        const canonicalName = getCanonicalDebtorAccountName(allocation.target_name);
        if (canonicalName) totals[canonicalName] = (totals[canonicalName] || 0) + line.amount;
        continue;
      }
      for (const rule of BANK_PAYMENT_RULES) {
        if (rule.pattern.test(line.description)) {
          totals[rule.account] = (totals[rule.account] || 0) + line.amount;
          break;
        }
      }
    }
    return totals;
  }, [bankLines, bankAllocations]);

  const prevMonthBankPayments = useMemo(() => {
    const totals: Record<string, number> = {};
    DEBTOR_ACCOUNTS.forEach(a => { totals[a] = 0; });
    for (const line of prevMonthBankLines) {
      if (line.amount <= 0) continue;
      for (const rule of BANK_PAYMENT_RULES) {
        if (rule.pattern.test(line.description)) {
          totals[rule.account] = (totals[rule.account] || 0) + line.amount;
          break;
        }
      }
    }
    return totals;
  }, [prevMonthBankLines]);

  // ROA payments allocated per debtor using seqNo as debtor reference
  const roaPerDebtor = useMemo(() => {
    const monthlyCashups = cashups.filter(c => c.month === filterMonth);
    const totals: Record<string, number> = {};
    DEBTOR_ACCOUNTS.forEach(a => { totals[a] = 0; });
    for (const c of monthlyCashups) {
      for (const r of c.shop.receipts ?? []) {
        if (r.type === 'Debtors Received on Account ROA' && r.amount > 0) {
          const matched = getCanonicalDebtorAccountName((r.seqNo || '').trim());
          if (matched) {
            totals[matched] = (totals[matched] || 0) + r.amount;
          }
        }
      }
    }
    return totals;
  }, [filterMonth, cashups]);

  const prevMonthRoaPerDebtor = useMemo(() => {
    const monthlyCashups = cashups.filter(c => c.month === prevMonth);
    const totals: Record<string, number> = {};
    DEBTOR_ACCOUNTS.forEach(a => { totals[a] = 0; });
    for (const c of monthlyCashups) {
      for (const r of c.shop.receipts ?? []) {
        if (r.type === 'Debtors Received on Account ROA' && r.amount > 0) {
          const matched = getCanonicalDebtorAccountName((r.seqNo || '').trim());
          if (matched) {
            totals[matched] = (totals[matched] || 0) + r.amount;
          }
        }
      }
    }
    return totals;
  }, [prevMonth, cashups]);

  const effectiveOpeningBalances = useMemo(() => {
    const carriedForward: Record<string, number> = { ...openingBalances };

    if (!isFirstMonth) {
      DEBTOR_ACCOUNTS.forEach(name => {
        if (carriedForward[name] !== undefined) return;

        const prevOb = prevMonthOpeningBalances[name] ?? 0;
        const prevPurchase = prevMonthPurchases[name] || 0;
        const prevBankPmt = (prevMonthBankPayments[name] || 0) + (prevMonthRoaPerDebtor[name] || 0);
        const prevAdjustment = JE3_WRITEOFF_ACCOUNTS.includes(name) ? prevPurchase : 0;
        const closing = prevOb + prevPurchase - prevBankPmt - prevAdjustment;

        if (closing !== 0) {
          carriedForward[name] = closing;
        }
      });
    }

    return carriedForward;
  }, [
    openingBalances,
    isFirstMonth,
    prevMonthOpeningBalances,
    prevMonthPurchases,
    prevMonthBankPayments,
    prevMonthRoaPerDebtor,
  ]);

  // Build rows — JE3 accounts get their purchases as adjustments too
  const rows = DEBTOR_ACCOUNTS.map(name => {
    const ob = isFirstMonth
      ? (editingOB[name] ?? effectiveOpeningBalances[name] ?? 0)
      : (effectiveOpeningBalances[name] ?? 0);
    const purchase = purchases[name] || 0;
    const bankPmt = (bankPayments[name] || 0) + (roaPerDebtor[name] || 0);
    const isJe3 = JE3_WRITEOFF_ACCOUNTS.includes(name);
    const autoAdjustment = isJe3 ? purchase : 0; // JE3 purchases are written off as adjustments
    // Adjustments are an override: if a user value exists, use that; otherwise auto
    const userAdj = debtorAdjustments.find(a => a.target_name === name && a.field === 'adjustment');
    const adjustment = userAdj ? Number(userAdj.amount) : autoAdjustment;
    const closing = ob + purchase - bankPmt - adjustment;
    return { name, ob, purchase, bankPmt, adjustment, autoAdjustment, hasUserAdj: !!userAdj, closing };
  });

  const allRows = rows;

  const totals = allRows.reduce(
    (acc, r) => ({
      ob: acc.ob + r.ob,
      purchase: acc.purchase + r.purchase,
      bankPmt: acc.bankPmt + r.bankPmt,
      adjustment: acc.adjustment + r.adjustment,
      closing: acc.closing + r.closing,
    }),
    { ob: 0, purchase: 0, bankPmt: 0, adjustment: 0, closing: 0 }
  );

  const handleSaveOB = async () => {
    setSaving(true);
    try {
      for (const [name, amount] of Object.entries(editingOB)) {
        const supplier = `debtor:${name}`;
        const { data: existing } = await supabase
          .from('creditor_opening_balances')
          .select('id')
          .eq('month', filterMonth)
          .eq('supplier', supplier);
        if (existing && existing.length > 0) {
          await supabase.from('creditor_opening_balances').update({ amount } as never).eq('id', existing[0].id);
        } else {
          await supabase.from('creditor_opening_balances').insert({ month: filterMonth, supplier, amount } as never);
        }
      }
      toast.success('Opening balances saved');
      loadData();
    } catch {
      toast.error('Failed to save');
    }
    setSaving(false);
  };

  const hasEdits = Object.keys(editingOB).length > 0;

  return (
    <div className="bg-card border rounded-lg overflow-x-clip">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <h3 className="font-semibold text-sm">Debtors Reconciliation — {filterMonth}</h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => {
            downloadCsv(
              ['Debtor', 'Opening Balance', 'Purchases', 'Payments', 'Adjustments (JE3)', 'Closing Balance'],
              rows.map(r => [r.name, r.ob, r.purchase, r.bankPmt, r.adjustment, r.closing]),
              `debtors-recon-${filterMonth}.csv`
            );
          }}>
            <Download className="h-3.5 w-3.5 mr-1" />Export CSV
          </Button>
          {isFirstMonth && hasEdits && (
            <Button size="sm" variant="outline" onClick={handleSaveOB} disabled={saving}>
              <Save className="h-3.5 w-3.5 mr-1" />{saving ? 'Saving...' : 'Save OB'}
            </Button>
          )}
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Debtor</TableHead>
            <TableHead className="text-xs text-right">Opening Balance</TableHead>
            <TableHead className="text-xs text-right">Purchases</TableHead>
            <TableHead className="text-xs text-right">Payments</TableHead>
            <TableHead className="text-xs text-right">Adjustments (JE3)</TableHead>
            <TableHead className="text-xs text-right">Closing Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.name}>
              <TableCell className="text-sm">{r.name}</TableCell>
              <TableCell className="text-right">
                {isFirstMonth ? (
                  <CurrencyInput
                    value={editingOB[r.name] ?? r.ob}
                    onChange={v => setEditingOB(prev => ({ ...prev, [r.name]: v }))}
                    className="w-28 text-right text-xs"
                  />
                ) : (
                  <CurrencyDisplay value={r.ob} />
                )}
              </TableCell>
              <TableCell className="text-right">
                {r.purchase !== 0 && purchaseEntries[r.name]?.length ? (
                  <SourceBreakdown entries={purchaseEntries[r.name]} source="cashier">
                    <CurrencyDisplay value={r.purchase} />
                  </SourceBreakdown>
                ) : (
                  <CurrencyDisplay value={r.purchase} />
                )}
              </TableCell>
              <TableCell className="text-right"><CurrencyDisplay value={r.bankPmt} /></TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1 group">
                  <CurrencyDisplay value={r.adjustment} />
                  {r.hasUserAdj && (
                    <span className="text-[10px] text-amber-600" title="User-edited override">*</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingAdj({ name: r.name, auto: r.autoAdjustment })}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                    title="Edit adjustment"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              </TableCell>
              <TableCell className="text-right font-semibold"><CurrencyDisplay value={r.closing} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-semibold text-sm">Net Debtors Closing Balance</TableCell>
            <TableCell className="text-right"><CurrencyDisplay value={totals.ob} highlight /></TableCell>
            <TableCell className="text-right"><CurrencyDisplay value={totals.purchase} highlight /></TableCell>
            <TableCell className="text-right"><CurrencyDisplay value={totals.bankPmt} highlight /></TableCell>
            <TableCell className="text-right"><CurrencyDisplay value={totals.adjustment} highlight /></TableCell>
            <TableCell className="text-right"><CurrencyDisplay value={totals.closing} highlight /></TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      {editingAdj && (
        <ReconAdjustDialog
          open={!!editingAdj}
          onOpenChange={(o) => !o && setEditingAdj(null)}
          reconType="debtor"
          month={filterMonth}
          targetName={editingAdj.name}
          field="adjustment"
          autoAmount={editingAdj.auto}
          currentAdjustment={getAdjustment(editingAdj.name, 'adjustment')}
          fieldLabel="Adjustment (JE3)"
          isOverride={true}
          onSave={async (newAmount, changedBy, reason) => {
            await saveAdjustment({
              target_name: editingAdj.name,
              field: 'adjustment',
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