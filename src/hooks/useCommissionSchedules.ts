import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CommissionKey, CommissionSchedule, ScheduleType } from "@/lib/commissionSchedules";

interface SchedulesRow {
  id: string;
  commission_key: string;
  schedule_type: string;
  weekday: number | null;
  day_of_month: number | null;
}

function rowToSchedule(r: SchedulesRow): CommissionSchedule {
  return {
    id: r.id,
    commissionKey: r.commission_key as CommissionKey,
    scheduleType: r.schedule_type as ScheduleType,
    weekday: r.weekday,
    dayOfMonth: r.day_of_month,
  };
}

export function useCommissionSchedules() {
  const [schedules, setSchedules] = useState<CommissionSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("commission_schedules")
      .select("*")
      .order("created_at", { ascending: true });
    if (!error && data) {
      setSchedules((data as SchedulesRow[]).map(rowToSchedule));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
    const channel = supabase
      .channel(`commission_schedules_changes_${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "commission_schedules" },
        () => reload(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [reload]);

  const addSchedule = useCallback(async (input: Omit<CommissionSchedule, "id">) => {
    const { error } = await supabase.from("commission_schedules").insert({
      commission_key: input.commissionKey,
      schedule_type: input.scheduleType,
      weekday: input.weekday,
      day_of_month: input.dayOfMonth,
    });
    if (error) throw error;
    await reload();
  }, [reload]);

  const deleteSchedule = useCallback(async (id: string) => {
    const { error } = await supabase.from("commission_schedules").delete().eq("id", id);
    if (error) throw error;
    await reload();
  }, [reload]);

  return { schedules, loading, addSchedule, deleteSchedule, reload };
}
