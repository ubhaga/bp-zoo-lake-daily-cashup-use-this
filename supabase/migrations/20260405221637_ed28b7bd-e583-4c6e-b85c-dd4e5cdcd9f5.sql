ALTER TABLE public.monthly_branch_figures
  ADD COLUMN adj_c_store numeric NOT NULL DEFAULT 0,
  ADD COLUMN adj_wsl_dsl numeric NOT NULL DEFAULT 0,
  ADD COLUMN adj_fuel numeric NOT NULL DEFAULT 0,
  ADD COLUMN adj_gas numeric NOT NULL DEFAULT 0,
  ADD COLUMN adj_oil numeric NOT NULL DEFAULT 0,
  ADD COLUMN adj_vat numeric NOT NULL DEFAULT 0;