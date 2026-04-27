import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type ReconType = 'creditor' | 'debtor' | 'airtime';

export interface ReconAdjustment {
  id: string;
  recon_type: ReconType;
  month: string;
  target_name: string;
  field: string;            // 'invoices' | 'payments' | 'adjustment'
  week_index: number | null;
  amount: number;
}

export interface ReconAuditEntry {
  id: string;
  recon_type: string;
  month: string;
  target_name: string;
  field: string;
  week_index: number | null;
  old_amount: number | null;
  new_amount: number;
  changed_by: string;
  reason: string;
  created_at: string;
}

export function useReconAdjustments(reconType: ReconType, month: string) {
  const [adjustments, setAdjustments] = useState<ReconAdjustment[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('recon_adjustments')
      .select('*')
      .eq('recon_type', reconType)
      .eq('month', month);
    setAdjustments((data ?? []) as ReconAdjustment[]);
  }, [reconType, month]);

  useEffect(() => {
    load();
  }, [load]);

  const saveAdjustment = async (params: {
    target_name: string;
    field: string;
    week_index: number | null;
    new_amount: number;
    changed_by: string;
    reason?: string;
  }) => {
    const { target_name, field, week_index, new_amount, changed_by, reason } = params;

    // Find existing
    const existing = adjustments.find(
      a => a.target_name === target_name && a.field === field && (a.week_index ?? null) === (week_index ?? null)
    );
    const old_amount = existing?.amount ?? null;

    if (existing) {
      if (new_amount === 0) {
        await supabase.from('recon_adjustments').delete().eq('id', existing.id);
      } else {
        await supabase.from('recon_adjustments').update({ amount: new_amount } as never).eq('id', existing.id);
      }
    } else if (new_amount !== 0) {
      await supabase.from('recon_adjustments').insert({
        recon_type: reconType,
        month,
        target_name,
        field,
        week_index,
        amount: new_amount,
      } as never);
    }

    // Log audit
    await supabase.from('recon_adjustment_audit').insert({
      recon_type: reconType,
      month,
      target_name,
      field,
      week_index,
      old_amount,
      new_amount,
      changed_by: changed_by || 'unknown',
      reason: reason ?? '',
    } as never);

    await load();
    toast.success('Adjustment saved');
  };

  const getAdjustment = (target_name: string, field: string, week_index: number | null = null) => {
    const found = adjustments.find(
      a => a.target_name === target_name && a.field === field && (a.week_index ?? null) === (week_index ?? null)
    );
    return found?.amount ?? 0;
  };

  return { adjustments, saveAdjustment, getAdjustment, reload: load };
}

export async function fetchAuditLog(reconType: ReconType, month: string, target_name?: string) {
  let q = supabase
    .from('recon_adjustment_audit')
    .select('*')
    .eq('recon_type', reconType)
    .eq('month', month)
    .order('created_at', { ascending: false });
  if (target_name) q = q.eq('target_name', target_name);
  const { data } = await q;
  return (data ?? []) as ReconAuditEntry[];
}
