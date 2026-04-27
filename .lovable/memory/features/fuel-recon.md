---
name: Fuel Recon Tabs
description: Four fuel recon sub-tabs parsing day-end RPT files for tank, meter, and POS variance analysis
type: feature
---
The Fuel Recon tab has 4 sub-tabs:
1. **Daily Summ Dashboard** — Summary comparing Tank vs Pump vs Meter sales per day with variance highlighting and status icons. Includes variance guide explaining what each variance type means (tank leak, meter calibration, pump test).
2. **Fuel Sales Control per Tank** — Pulls from "Fuel Sales Control - MTD Summary" in day-end RPTs. Shows daily pump/tank volumes, purchases, dips, and cumulative variance per grade.
3. **Meter Sales Control** — Pulls from "EOD Pump Variance" in day-end RPTs. Shows meter start/end readings per pump with calculated vs actual volumes.
4. **POS Sales Per Tank** — Pulls from "Fuel Sales Control - EOD Short" in day-end RPTs. Shows POS fuel sales by grade per batch.

Data source: `day_end_uploads` table content, parsed by `src/lib/fuelReportParser.ts`.
Tank descriptions (number, grade, size) are managed in Settings under "Fuel Tanks" and stored in master_data with key "tanks".
