---
name: Cash In Transit setting
description: Settings toggle (Cash Connect | Deposita) that swaps Cash Connect/CC labels and hides bank-charges/expected-banking sections
type: feature
---
- Setting lives next to Site System in Master Data Settings.
- Stored in master_data table under key `cashInTransit` ('Cash Connect' | 'Deposita'), default 'Cash Connect'.
- Exposed via `useMasterDataStore` as `cashInTransit` + `setCashInTransit`. Helper `citShort` returns 'CC' or 'Dep'.
- When Deposita:
  - Manager Daily Form: hide entire Section "2.1 Banking" (rate / Bank Charges / Banking net).
  - Cash Recon table: hide Bank Charges and Expected Banking columns (header, OB row, data rows, totals row, CSV export).
  - All visible "Cash Connect" / "CC " labels swap to "Deposita" / "Dep " in: Manager Daily Form (column header, CC Bag Closure label, negative-closing field name), Cashier Daily Form (Cash Connect Total Sum), Dashboard (Cash Connect, Cash Connect Balance), Cash Recon title + headers, Reports tab "Cash CC & Coins" → "Cash Dep & Coins".
- DB field/store key names (cashConnectOpeningBalance, ccBagClosureCashConnect, etc.) intentionally NOT renamed — purely a display/UX swap.
