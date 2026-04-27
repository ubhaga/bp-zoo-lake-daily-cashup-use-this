## Goal

1. Make the Cashier Daily top bar (date navigation + Save) **sticky** on scroll — same behavior as Manager Daily.
2. Freeze (sticky) the **table column headers** in all Reports, Daily Sales Recons, and Fuel Recons so they remain visible while scrolling vertically.

---

## 1. Cashier Daily — sticky header bar

In `src/components/cashier/CashierDailyForm.tsx` (around line 595):

- The current top bar only has Previous Day / Date / Next Day. It is not sticky and has no Save button.
- Change it to mirror the Manager Daily pattern (lines 730–749):
  - Add `sticky top-0 z-30 shadow-sm` classes to the wrapper.
  - Insert a **Save Cashup** button (using the existing `handleSave` at line 385) between the date label and the Next Day button.
  - Keep the existing bottom Save button as-is (it acts as a secondary action; matches Manager Daily which also keeps the bottom save).

Result: the day label, ◀ Previous, Save Cashup, and Next ▶ all stick to the top while scrolling — identical to Manager Daily.

---

## 2. Sticky table headers across reports & recons

### Approach

The shadcn `Table` component (`src/components/ui/table.tsx`) wraps each `<table>` in a `div` with `overflow-auto`. For sticky `<thead>` to work inside a scrolling container, the `<th>` cells need `sticky top-0` plus a solid background and a higher `z-index` than table body content.

**Two coordinated edits:**

**a) Update the base `TableHead` component** (`src/components/ui/table.tsx`)

Add `sticky top-0 z-20 bg-background` to the default `<th>` className so any table that uses `<TableHead>` gets a frozen header automatically. Also add a thin bottom border so it reads as a header divider while floating over scrolled rows.

This single change activates sticky headers everywhere `TableHead` is used (DailySummaryReport, BankStatementTab, BankRulesTab, all recon tabs that use `TableHead`).

Some tables override the `<tr>` background (e.g. `bg-muted/50` in DailySummaryReport). To prevent the row background from "showing through" the sticky cells, the sticky background is set on the `<th>` itself, so it always wins.

**b) Update tables that use raw `<thead>`/`<th>` instead of the shadcn wrappers**

Files that build their own table markup (the recons mostly hand-roll `<table>`):
- `src/components/recons/AirtimeRecon.tsx`
- `src/components/recons/CashRecon.tsx`
- `src/components/recons/CreditorsRecon.tsx`
- `src/components/recons/CreditorsTable.tsx`
- `src/components/recons/DebtorsRecon.tsx`
- `src/components/recons/OtherAdjustmentsRecon.tsx`
- `src/components/fuel/FuelSalesControl.tsx`
- `src/components/fuel/MeterSalesControl.tsx`
- `src/components/fuel/PosSalesPerTank.tsx`
- `src/components/fuel/FuelDashboard.tsx`

For each:
- Add `sticky top-0 z-20` and a solid background (`bg-background` or the existing header background such as `bg-muted` / `bg-primary/80`) to every `<th>` in the header row.
- Ensure the parent scroll container has a fixed `max-h-…` or relies on the page scroll. If the table currently scrolls inside a `div` with `overflow-auto`/`overflow-x-auto` only, sticky vertical works against the **page** scroll automatically — no container change needed.

### Edge cases handled

- Tables with multi-row headers (e.g. grouped column headers) — each header row gets `top-0` and `top-[Npx]` respectively so both rows stick stacked.
- Tables inside dialogs/popovers — already scroll-bounded, sticky still works.
- Color contrast on dark/light themes — using `bg-background` (semantic token) preserves theming.

---

## Files to edit

- `src/components/cashier/CashierDailyForm.tsx` — sticky top bar + Save button.
- `src/components/ui/table.tsx` — add sticky classes to base `TableHead`.
- 10 recon/fuel files listed above — add sticky classes to hand-rolled `<th>` cells.

No new dependencies, no schema changes, no behavior changes beyond visual stickiness.
