ALTER TABLE public.monthly_branch_figures
  ADD COLUMN sales_c_store numeric NOT NULL DEFAULT 0,
  ADD COLUMN sales_wsl_dsl numeric NOT NULL DEFAULT 0,
  ADD COLUMN sales_fuel numeric NOT NULL DEFAULT 0,
  ADD COLUMN sales_gas numeric NOT NULL DEFAULT 0,
  ADD COLUMN sales_oil numeric NOT NULL DEFAULT 0,
  ADD COLUMN vat_tax_amount numeric NOT NULL DEFAULT 0;