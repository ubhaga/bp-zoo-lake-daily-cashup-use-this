---
name: Configurable commission schedules
description: Blue Label, Easy Pay, and Lotto commission visibility on Manager Daily is driven by the commission_schedules table, configured in Settings → Master Data
type: feature
---

Blue Label, Easy Pay, and Lotto commission rows in Manager Daily Section 3 are no longer hard-coded to "last day of month" / "every Saturday". They are driven by the `commission_schedules` table.

Schema (`public.commission_schedules`):
- `commission_key` ('blue_label' | 'easypay' | 'lotto')
- `schedule_type` ('last_day_of_month' | 'first_day_of_month' | 'weekday' | 'day_of_month')
- `weekday` (0=Sunday..6=Saturday, only for weekday rules)
- `day_of_month` (1..31, with month-end fallback for shorter months)

Multiple rules per commission stack (any rule firing makes the field visible).

Helper: `src/lib/commissionSchedules.ts` (`commissionMatchesDate`, `describeSchedule`).
Hook: `src/hooks/useCommissionSchedules.ts` (loads + realtime + add/delete).
Settings UI: `src/components/settings/CommissionSchedulesSettings.tsx`, mounted from MasterDataSettings.

Seed defaults match prior hard-coded behaviour: Blue Label & Easy Pay = last_day_of_month, Lotto = weekday 6 (Saturday).

Saved values continue to flow into the Airtime/Lotto recon via `manager_daily_entries` columns (`blue_label_comm`, `easypay_comm`, `lotto_comm`) — the recon now naturally follows whatever days the user has configured.
