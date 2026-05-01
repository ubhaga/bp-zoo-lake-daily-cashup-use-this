# Project Memory

## Core
- BP Zoolake daily cashup system replacing manual spreadsheet.
- All dates prior to 1 January 2026 are locked and read-only.
- Format all financial amounts with thousand separators and 2 decimal places (4 for bank charge rates).
- Master Data settings drive all dropdowns (Invoice Suppliers/Categories, Accounts, Cashiers, Managers).
- Day is reconciled if Shop Till ±20, OPT is 0, and Invoices/VAT/Receipts/Payouts match.
- Prevent save if Coins, Easy Pay, or Cash Connect closing balances are negative.
- Speedpoint terminals: Term 247608, Forecourt 929661, Retail 200660, Scan to pay, V Plus.

## Memories
- [Manager Daily Form](mem://architecture/sheet-structure) — UI layout: Payout Invoices, EFT Invoices, Invoice Recon, Cash Recon, Banking
- [Cashier Daily Form](mem://logic/cashier-daily-structure) — Side-by-side Shop Till and OPT shifts, grouped sections, synced logic
- [Cashier Balancing Logic](mem://logic/cashier-balancing) — Formulas for Shop Till and OPT Short/(Over) balances
- [Manager Monthly Recon](mem://logic/manager-monthly-reconciliation) — Compare spreadsheet totals vs branch figures with 4-column variance grids
- [Project Initialization](mem://logic/project-initialization) — 1 Jan 2026 starting values for Opening Balances, CC Bag Closures, Transfers
- [Banking Calculations](mem://logic/banking-calculations) — Bank charges rate calculation and forward propagation logic
- [Manager Invoice Management](mem://logic/manager-invoice-management) — 15% VAT tracking, payout automatic pulls from Cashier Daily
- [Manager Cash Reconciliation](mem://logic/manager-cash-reconciliation) — Coins, Easy Pay, Cash Connect, Bag Closure, Transfer, Deep Frozen logic
- [Cash Connect Calculation](mem://logic/cash-connect-total-calculation) — Contextual calculation differences for Cash (CC) vs Cash Connect
- [Cashier Validation Rules](mem://logic/cashier-validation-rules) — Mandatory fields, conditional rules, over-balance confirmations
- [Manager Validation Rules](mem://logic/manager-validation-rules) — Integrity checks and mandatory field requirements before save
- [Dashboard Layout](mem://features/dashboard) — Monthly overview table layout, explanation column, sequence gap tracking
- [Master Data Management](mem://features/master-data-management) — Dynamic system lists for invoices, accounts, and personnel
- [Date Locking](mem://constraints/date-locking) — Restriction rules for dates prior to 1 Jan 2026
- [Currency Input Formatting](mem://logic/currency-input-formatting) — Thousand separators, fixed decimals rounding
- [Speedpoint Naming Convention](mem://logic/speedpoint-terminal-naming) — Standardized terminal names and historical data migration
- [Bank Statement Uploads](mem://features/bank-reconciliation) — CSV parsing, manual line deletion, deduplication via raw lines
- [Bank Statement Parsing Logic](mem://logic/bank-statement-parsing) — CSV metadata scanning, regex terminal extraction from descriptions
- [Navigation Layout](mem://architecture/navigation-layout) — Main tabs: Dashboard, Cashier Daily, Manager Daily, Monthly Report, Reports, Recons, Fuel Recon, AFS, Uploads, Settings
- [Speedpoints Recon](mem://features/recons/speedpoints-recon) — Terminal/batch matching, DB UUID persistence, manual pairing/clearing
- [Creditors Recon](mem://features/recons/creditors-recon) — Weekly supplier balances, Fuel Creditors vs DAWN CONSULTANTS, regex matching
- [Payouts Recon Report](mem://features/reports/payouts-reconciliation) — Cashier payouts vs manager invoices vendor matching, color coding
- [Daily Summary Report](mem://features/reports/daily-summary) — High-level cashier activity, specific inclusions/exclusions per column
- [Cashier UI Enhancements](mem://features/cashier-daily/ui-enhancements) — Spacer rows for visual alignment between Shop and OPT net sales
- [Cash CC & Coins Recon](mem://features/recons/cash-cc-coins-recon) — Daily balance tracking, seed values, Deep Frozen deductions
- [Other Adjustments Recon](mem://features/recons/other-adjustments-recon) — Section 8 items matching, cross-type netting, source navigation links
- [Debtors Recon](mem://features/recons/debtors-recon) — Monthly balances, regex bank payments, automated offsets for Generator/Shop Expense/Umesh
- [Airtime & Lotto Recon](mem://features/recons/airtime-lotto-recon) — Daily BLD/Easypay/Lotto formulas, seed values, bank payment matching
- [AFS Monthly Report](mem://features/afs/monthly-report) — Income Statement and Balance Sheet section classifications and subtotals
- [AFS Shift Clearing](mem://logic/shift-clearing-formula) — JE 1 formula for total cash deposited for banking excluding manager bank charges
- [AFS JE1 Turnover Logic](mem://logic/afs/je1-turnover-logic) — Turnover aggregation, provisions, C-Store splits, clearing accounts
- [AFS JE2 Invoices Logic](mem://logic/afs/je2-invoices-logic) — 3-column debit structure (Excl. VAT, VAT, No VAT) and category aggregation
- [AFS JE3 Writeoffs Logic](mem://logic/afs/je3-writeoffs-logic) — Debtors account write-off mapping for Generator, Shop Expense, Staff Refreshments
- [Fuel Recon](mem://features/fuel-recon) — 4 sub-tabs parsing day-end RPTs for tank/meter/POS variance analysis, tank config in Settings
- [Day End Debtors Auto-Fill](mem://features/day-end-debtors-autofill) — Section 7 MOP Account auto-populates from EOD Debtors Transactions on .rpt upload
- [Bank Rules](mem://features/bank-rules) — Auto-allocate bank lines to creditors/debtors/BLD/Easypay/Lotto/Cash CC by reference keywords + amount range
- [Cash In Transit Setting](mem://features/cash-in-transit-setting) — Cash Connect | Deposita toggle; swaps labels and hides 2.1 Banking + Bank Charges/Expected Banking when Deposita
