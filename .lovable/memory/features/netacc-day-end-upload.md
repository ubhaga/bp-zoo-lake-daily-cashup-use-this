---
name: NetAcc Day End Upload
description: Site System "NetAcc" accepts PDF day-end reports; pdfjs extracts text on upload and feeds Cashier, Manager, Fuel
type: feature
---
When `siteSystem === 'NetAcc'` (Settings → Master Data), the Uploads tab accepts `.pdf` (NetPOS Shift File) instead of `.rpt`.

**Flow:** `DayEndUpload` calls `extractPdfText()` (pdfjs-dist), prepends `<<NETACC SHIFT FILE>>` marker, stores text in `day_end_uploads.content` (same column as Branch).

**Parser:** `src/lib/dayEndNetAcc.ts` — `isNetAccContent`, `extractNetAccBatchDate` (from "End: ... dd-Mmm-yyyy"), and 5 extractors:
1. `extractNetAccPumpSales` — Totalisors (Closing minus Open) → MeterSalesControl (adapter in MeterSalesControl converts to PumpVarianceRow shape)
2. `extractNetAccDebtors` — Account Transactions, one row per Invoice → Section 7 MOP Account
3. `extractNetAccBpRewards` — bpRewards Settlements (Batch # + TOTAL) → Section 6 speedpoint named "Redeem" (shop)
4. `extractNetAccSalesTotal` — Sales Summary TOTAL → Section 1 Income (Shop Till)
5. `extractNetAccSafeDepositsTotal` — Manual Safe Deposits TOTAL → read-only validation badge next to Cash Connect Total (sum); green when matches within R0.01, amber otherwise

**One combined PDF per day** populates Shop Till; OPT entered manually. CashierDailyForm autofill effects detect format via `isNetAccContent` and branch.
