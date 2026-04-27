import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMasterDataStore } from '@/store/masterDataStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Wand2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  BankRule,
  ReconType,
  RECON_TYPE_LABELS,
  loadBankRules,
  computeAllocationsFromRules,
  BankLineLite,
} from '@/lib/bankRules';

const RECON_TYPES: ReconType[] = ['creditor', 'debtor', 'bld', 'easypay', 'lotto', 'cash_cc'];

interface Props {
  filterMonth: string;
}

export function BankRulesTab({ filterMonth }: Props) {
  const { eftSuppliers, accounts } = useMasterDataStore();
  const [rules, setRules] = useState<BankRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const reload = useCallback(async () => {
    const data = await loadBankRules();
    setRules(data);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const targetOptions = useMemo(() => {
    const sortedCreditors = [...eftSuppliers].sort();
    const sortedDebtors = [...accounts].sort();
    return {
      creditor: sortedCreditors,
      debtor: sortedDebtors,
      bld: ['Blue Label'],
      easypay: ['Easypay'],
      lotto: ['Lotto'],
      cash_cc: ['Cash CC'],
    } as Record<ReconType, string[]>;
  }, [eftSuppliers, accounts]);

  const addRule = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('bank_rules')
      .insert({
        recon_type: 'creditor',
        target_name: targetOptions.creditor[0] ?? '',
        reference: '',
        priority: 0,
        enabled: true,
      } as never)
      .select()
      .single();
    setLoading(false);
    if (error) { toast.error('Failed to add rule: ' + error.message); return; }
    setRules(prev => [data as unknown as BankRule, ...prev]);
  };

  const updateRule = async (id: string, patch: Partial<BankRule>) => {
    // Optimistic update
    setRules(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase
      .from('bank_rules')
      .update(patch as never)
      .eq('id', id);
    if (error) { toast.error('Failed to save rule: ' + error.message); reload(); }
  };

  const deleteRule = async (id: string) => {
    if (!confirm('Delete this rule?')) return;
    await supabase.from('bank_rules').delete().eq('id', id);
    setRules(prev => prev.filter(r => r.id !== id));
  };

  const applyRulesNow = async () => {
    setApplying(true);
    try {
      const [linesRes, allocRes] = await Promise.all([
        supabase
          .from('bank_statement_lines')
          .select('id, description, amount')
          .eq('month', filterMonth),
        supabase
          .from('bank_line_allocations')
          .select('bank_line_id')
          .eq('month', filterMonth),
      ]);
      const lines = (linesRes.data ?? []) as unknown as BankLineLite[];
      const allocated = new Set(
        ((allocRes.data ?? []) as { bank_line_id: string }[]).map(a => a.bank_line_id),
      );
      const pending = computeAllocationsFromRules(lines, rules, allocated);
      if (pending.length === 0) {
        toast.info('No new matches found for this month.');
        return;
      }
      const rows = pending.map(p => ({ ...p, month: filterMonth }));
      const { error } = await supabase
        .from('bank_line_allocations')
        .upsert(rows as never[], { onConflict: 'bank_line_id' });
      if (error) { toast.error('Failed to apply: ' + error.message); return; }
      toast.success(`Allocated ${pending.length} bank lines for ${filterMonth}.`);
    } finally {
      setApplying(false);
    }
  };

  const numOrNull = (v: string): number | null => {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return isNaN(n) ? null : n;
  };

  return (
    <div className="bg-card border rounded-lg overflow-x-clip">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div>
          <h3 className="font-semibold text-sm">Bank Rules</h3>
          <p className="text-xs text-muted-foreground">
            Auto-allocate bank statement lines to debtors, creditors and other recons.
            Reference is matched as space-separated keywords (all must appear, case-insensitive).
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={applyRulesNow} disabled={applying || rules.length === 0}>
            <Wand2 className="h-3.5 w-3.5 mr-1" />
            {applying ? 'Applying…' : `Apply to ${filterMonth}`}
          </Button>
          <Button size="sm" onClick={addRule} disabled={loading}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add rule
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-xs">On</TableHead>
            <TableHead className="w-[140px] text-xs">Type</TableHead>
            <TableHead className="w-[200px] text-xs">Target</TableHead>
            <TableHead className="text-xs">Reference contains (space-separated)</TableHead>
            <TableHead className="w-[120px] text-xs text-right">Min amount</TableHead>
            <TableHead className="w-[120px] text-xs text-right">Max amount</TableHead>
            <TableHead className="w-[80px] text-xs text-right">Priority</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground py-8 text-sm">
                No rules yet. Click <span className="font-semibold">Add rule</span> to create one.
                <br />
                <span className="text-xs">
                  Example — Creditor · Engen · Reference: <code className="font-mono">Engen 000145174</code> · Min: 30000
                </span>
              </TableCell>
            </TableRow>
          ) : (
            rules.map(r => {
              const targets = targetOptions[r.recon_type] ?? [];
              const refTokens = (r.reference || '')
                .split(/\s+/)
                .map(t => t.trim())
                .filter(t => t.length >= 3);
              const hasAmountRange = r.min_amount != null || r.max_amount != null;
              const unsafe = r.enabled && refTokens.length === 0 && !hasAmountRange;
              return (
                <TableRow key={r.id} className={unsafe ? 'bg-destructive/5' : ''}>
                  <TableCell>
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={v => updateRule(r.id, { enabled: v })}
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <Select
                      value={r.recon_type}
                      onValueChange={(v: ReconType) => {
                        const newTargets = targetOptions[v] ?? [];
                        const keep = newTargets.includes(r.target_name);
                        updateRule(r.id, {
                          recon_type: v,
                          target_name: keep ? r.target_name : (newTargets[0] ?? ''),
                        });
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {RECON_TYPES.map(t => (
                          <SelectItem key={t} value={t}>{RECON_TYPE_LABELS[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="p-1">
                    {targets.length <= 1 ? (
                      <Input
                        className="h-8 text-xs"
                        value={r.target_name}
                        onChange={e => updateRule(r.id, { target_name: e.target.value })}
                      />
                    ) : (
                      <Select
                        value={targets.includes(r.target_name) ? r.target_name : ''}
                        onValueChange={v => updateRule(r.id, { target_name: v })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {targets.map(t => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell className="p-1">
                    <div className="flex items-center gap-1">
                      <Input
                        className={`h-8 text-xs font-mono ${unsafe ? 'border-destructive' : ''}`}
                        placeholder="e.g. Engen 000145174"
                        value={r.reference}
                        onChange={e => updateRule(r.id, { reference: e.target.value })}
                      />
                      {unsafe && (
                        <span
                          title="Unsafe rule: no reference tokens (3+ chars) and no amount range. This rule will be ignored to prevent matching every bank line."
                          className="text-destructive shrink-0"
                        >
                          <AlertTriangle className="h-4 w-4" />
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="p-1">
                    <Input
                      className="h-8 text-xs text-right"
                      type="number"
                      step="0.01"
                      placeholder="—"
                      value={r.min_amount ?? ''}
                      onChange={e => updateRule(r.id, { min_amount: numOrNull(e.target.value) })}
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <Input
                      className="h-8 text-xs text-right"
                      type="number"
                      step="0.01"
                      placeholder="—"
                      value={r.max_amount ?? ''}
                      onChange={e => updateRule(r.id, { max_amount: numOrNull(e.target.value) })}
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <Input
                      className="h-8 text-xs text-right"
                      type="number"
                      step="1"
                      value={r.priority}
                      onChange={e => updateRule(r.id, { priority: parseInt(e.target.value || '0', 10) || 0 })}
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteRule(r.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}