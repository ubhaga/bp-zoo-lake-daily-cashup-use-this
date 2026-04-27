---
name: Bank Rules
description: Bank Rules tab (Uploads → Bank Rules) auto-allocates bank statement lines to creditors, debtors, BLD, Easypay, Lotto and Cash CC by reference keywords and amount range
type: feature
---

The **Bank Rules** tab lives next to **Bank Statement** under Uploads. Each rule has:

- **Type**: `creditor`, `debtor`, `bld`, `easypay`, `lotto`, `cash_cc`
- **Target name**: pulled from master data (eftSuppliers for Creditor, accounts for Debtor); fixed for BLD/Easypay/Lotto/Cash CC
- **Reference**: space-separated keywords; ALL must appear (case-insensitive substring) in the bank line description
- **Min / Max amount**: optional inclusive range filter
- **Priority**: integer; higher wins. Tie-breakers: more reference tokens, then tighter amount range
- **Enabled** toggle

### Application

- Rules **auto-apply on CSV upload** in `BankStatementTab.tsx` (best-effort, never blocks upload)
- Manual "Apply to {month}" button on the Bank Rules tab re-runs against existing lines
- Existing manual allocations are **never overwritten** (via `bank_line_allocations.bank_line_id` upsert with conflict skip on already-allocated lines)

### Files

- `src/lib/bankRules.ts` — types, matching, `loadBankRules`, `computeAllocationsFromRules`
- `src/components/reports/BankRulesTab.tsx` — UI
- DB table: `bank_rules` (recon_type, target_name, reference, min_amount, max_amount, priority, enabled)
