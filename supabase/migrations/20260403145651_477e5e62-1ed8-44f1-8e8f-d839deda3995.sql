ALTER TABLE public.monthly_branch_figures
  ADD COLUMN explanation_net_sales text NOT NULL DEFAULT '',
  ADD COLUMN explanation_payouts text NOT NULL DEFAULT '',
  ADD COLUMN explanation_receipts text NOT NULL DEFAULT '',
  ADD COLUMN explanation_invoices text NOT NULL DEFAULT '',
  ADD COLUMN explanation_vat text NOT NULL DEFAULT '';