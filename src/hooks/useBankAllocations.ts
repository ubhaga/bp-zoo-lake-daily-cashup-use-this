import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface BankAllocation {
  id: string;
  bank_line_id: string;
  recon_type: string;
  target_name: string;
  month: string;
}

export function useBankAllocations(month: string) {
  const [allocations, setAllocations] = useState<BankAllocation[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('bank_line_allocations')
      .select('*')
      .eq('month', month);
    setAllocations((data ?? []) as unknown as BankAllocation[]);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const upsert = async (bankLineId: string, reconType: string, targetName: string) => {
    if (!reconType || !targetName) {
      await supabase.from('bank_line_allocations').delete().eq('bank_line_id', bankLineId);
      setAllocations(prev => prev.filter(a => a.bank_line_id !== bankLineId));
      return;
    }
    const { data } = await supabase
      .from('bank_line_allocations')
      .upsert(
        { bank_line_id: bankLineId, recon_type: reconType, target_name: targetName, month } as never,
        { onConflict: 'bank_line_id' }
      )
      .select()
      .single();
    if (data) {
      setAllocations(prev => {
        const filtered = prev.filter(a => a.bank_line_id !== bankLineId);
        return [...filtered, data as unknown as BankAllocation];
      });
    }
  };

  const remove = async (bankLineId: string) => {
    await supabase.from('bank_line_allocations').delete().eq('bank_line_id', bankLineId);
    setAllocations(prev => prev.filter(a => a.bank_line_id !== bankLineId));
  };

  const getAllocationsForRecon = (reconType: string) =>
    allocations.filter(a => a.recon_type === reconType);

  return { allocations, load, upsert, remove, getAllocationsForRecon };
}
