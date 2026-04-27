import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useCommissionSchedules } from "@/hooks/useCommissionSchedules";
import {
  COMMISSION_LABELS,
  WEEKDAY_NAMES,
  describeSchedule,
  type CommissionKey,
  type ScheduleType,
} from "@/lib/commissionSchedules";

const COMMISSION_KEYS: CommissionKey[] = ["blue_label", "easypay", "lotto"];

const COLORS: Record<CommissionKey, string> = {
  blue_label: "bg-blue-700",
  easypay: "bg-emerald-700",
  lotto: "bg-amber-700",
};

function ScheduleCard({ commissionKey }: { commissionKey: CommissionKey }) {
  const { schedules, addSchedule, deleteSchedule, loading } = useCommissionSchedules();
  const items = schedules.filter((s) => s.commissionKey === commissionKey);

  const [scheduleType, setScheduleType] = useState<ScheduleType>("last_day_of_month");
  const [weekday, setWeekday] = useState<number>(6);
  const [dayOfMonth, setDayOfMonth] = useState<number>(1);
  const [busy, setBusy] = useState(false);

  const handleAdd = async () => {
    setBusy(true);
    try {
      await addSchedule({
        commissionKey,
        scheduleType,
        weekday: scheduleType === "weekday" ? weekday : null,
        dayOfMonth: scheduleType === "day_of_month" ? dayOfMonth : null,
      });
      toast({ title: "Schedule added", description: `${COMMISSION_LABELS[commissionKey]} updated.` });
    } catch (err) {
      toast({
        title: "Could not add schedule",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSchedule(id);
      toast({ title: "Schedule removed" });
    } catch (err) {
      toast({
        title: "Could not remove",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <div
        className={`${COLORS[commissionKey]} text-white px-4 py-2.5 font-semibold text-sm flex items-center justify-between`}
      >
        <span>{COMMISSION_LABELS[commissionKey]}</span>
        <span className="text-xs font-normal opacity-80">{items.length} rules</span>
      </div>

      {/* Add new */}
      <div className="p-3 border-b bg-muted/20 space-y-2">
        <div className="flex flex-wrap gap-2">
          <select
            value={scheduleType}
            onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
            className="text-sm border border-input rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="last_day_of_month">Last day of month</option>
            <option value="first_day_of_month">First day of month</option>
            <option value="weekday">Specific weekday</option>
            <option value="day_of_month">Specific day-of-month</option>
          </select>

          {scheduleType === "weekday" && (
            <select
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
              className="text-sm border border-input rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {WEEKDAY_NAMES.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
          )}

          {scheduleType === "day_of_month" && (
            <input
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
              className="w-20 text-sm border border-input rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}

          <Button size="sm" onClick={handleAdd} disabled={busy} className="shrink-0 ml-auto">
            <Plus className="h-3.5 w-3.5 mr-1" /> Add rule
          </Button>
        </div>
        {scheduleType === "day_of_month" && (
          <p className="text-xs text-muted-foreground">
            If the chosen day exceeds a month's length (e.g. 31 in February) the rule fires on that
            month's last day instead.
          </p>
        )}
      </div>

      {/* List */}
      <div className="divide-y">
        {items.map((s) => (
          <div key={s.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30 group">
            <span className="flex-1 text-sm">{describeSchedule(s)}</span>
            <button
              onClick={() => handleDelete(s.id)}
              className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/70 p-1 transition-opacity"
              aria-label="Delete schedule"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {!loading && items.length === 0 && (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center">
            No rules — this commission will never appear on Manager Daily.
          </div>
        )}
      </div>
    </div>
  );
}

export function CommissionSchedulesSettings() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {COMMISSION_KEYS.map((key) => (
        <ScheduleCard key={key} commissionKey={key} />
      ))}
    </div>
  );
}
