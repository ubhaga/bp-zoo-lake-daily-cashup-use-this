---
name: Airtime & Lotto Recon
description: Daily BLD/Easypay/Lotto formulas, seed values, bank payment matching, manager daily commissions as payments
type: feature
---

The Airtime / Lotto reconciliation tab tracks daily balances for Blue Label Distribution (BLD), Easypay, and Lotto.

Seed values (March 2026): BLD -11906.34, Easypay 14392.59, Lotto -7691.21.

Balance formula: Previous day balance - Invoice + Payment.

Deep Frozen paid in CC from Manager Daily is added to the Easypay invoice (debtor) amount each day.

Manager Daily commissions (Section 3) are shown as payments on their specific days:

- Blue Label Commission: entered on the last day of each month, added to BLD payment
- Easy Pay Commission: entered on the first day of each month, added to Easypay collection
- Lotto Commission: entered every Saturday, added to Lotto payment

Bank statement matching: BLD payments matched via "BLD DO" or "BLUE LABEL" descriptions. Lotto payments matched via "ITHUCOLL".

Monthly commission adjustments (from creditor_opening_balances) remain as a separate row for any additional adjustments.
