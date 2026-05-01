---
name: Cash In Transit setting
description: Settings toggle (Cash Connect | Deposita) that swaps Cash Connect/CC labels and hides bank-charges/expected-banking sections
type: feature
---
- Setting lives next to Site System in Master Data Settings.
- Stored in master_data table under key `cashInTransit` ('Cash Connect' | 'Deposita'), default 'Cash Connect'.
- Exposed via `useMasterDataStore` as `cashInTransit` + `setCashInTransit`. Helper `citShort` returns 'CC' or 'Dep'.
- Bank statement identifier per provider: `cashInTransitBankPatterns: Record<CashInTransit, string>` with `setCashInTransitBankPattern(cit, pattern)`. Default Cash Connect = "CCONNECT", Deposita = "" (must be set by user). Used by CashRecon as case-insensitive substring match against bank line description to auto-classify CIT deposits. Configured in Master Data Settings under the CIT tile, one input per provider.
- When Deposita:
  - Manager Daily Form: hide entire Section "2.1 Banking" (rate / Bank Charges / Banking net).
  - Cash Recon table: hide Bank Charges and Expected Banking columns (header, OB row, data rows, totals row, CSV export).
  - Cash Recon Outstanding = Dep Bag Closure less matching Bank Statement amount. Do not include EP Bag Closure or Bag Total in this outstanding calculation.
  - All visible "Cash Connect" / "CC " labels swap to "Deposita" / "Dep " in: Manager Daily Form (column header, CC Bag Closure label, negative-closing field name), Cashier Daily Form (Cash Connect Total Sum), Dashboard (Cash Connect, Cash Connect Balance), Cash Recon title + headers, Reports tab "Cash CC & Coins" → "Cash Dep & Coins".
- DB field/store key names (cashConnectOpeningBalance, ccBagClosureCashConnect, etc.) intentionally NOT renamed — purely a display/UX swap.
