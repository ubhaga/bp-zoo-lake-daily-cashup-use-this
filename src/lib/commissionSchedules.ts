import { format, lastDayOfMonth, parseISO } from "date-fns";

export type CommissionKey = "blue_label" | "easypay" | "lotto";
export type ScheduleType =
  | "last_day_of_month"
  | "first_day_of_month"
  | "weekday"
  | "day_of_month";

export interface CommissionSchedule {
  id: string;
  commissionKey: CommissionKey;
  scheduleType: ScheduleType;
  weekday: number | null; // 0 = Sunday, 6 = Saturday
  dayOfMonth: number | null; // 1..31
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const COMMISSION_LABELS: Record<CommissionKey, string> = {
  blue_label: "Blue Label Commission",
  easypay: "Easy Pay Commission",
  lotto: "Lotto Commission",
};

export function describeSchedule(s: Pick<CommissionSchedule, "scheduleType" | "weekday" | "dayOfMonth">): string {
  switch (s.scheduleType) {
    case "last_day_of_month":
      return "Last day of the month";
    case "first_day_of_month":
      return "First day of the month";
    case "weekday":
      return s.weekday !== null ? `Every ${WEEKDAY_NAMES[s.weekday]}` : "Every (weekday)";
    case "day_of_month":
      return s.dayOfMonth !== null
        ? `Day ${s.dayOfMonth} of each month`
        : "Day (n) of each month";
  }
}

/**
 * Given a date string `yyyy-MM-dd`, decide whether the schedule fires.
 * day_of_month rules with a value greater than the actual month length
 * fall back to the last day of that month.
 */
export function scheduleMatchesDate(
  schedule: Pick<CommissionSchedule, "scheduleType" | "weekday" | "dayOfMonth">,
  dateStr: string,
): boolean {
  const d = parseISO(dateStr);
  if (Number.isNaN(d.getTime())) return false;

  switch (schedule.scheduleType) {
    case "last_day_of_month":
      return format(lastDayOfMonth(d), "yyyy-MM-dd") === dateStr;
    case "first_day_of_month":
      return d.getDate() === 1;
    case "weekday":
      return schedule.weekday !== null && d.getDay() === schedule.weekday;
    case "day_of_month": {
      if (schedule.dayOfMonth === null) return false;
      const last = lastDayOfMonth(d).getDate();
      const target = Math.min(schedule.dayOfMonth, last);
      return d.getDate() === target;
    }
  }
}

export function commissionMatchesDate(
  key: CommissionKey,
  dateStr: string,
  schedules: CommissionSchedule[],
): boolean {
  return schedules.some((s) => s.commissionKey === key && scheduleMatchesDate(s, dateStr));
}
