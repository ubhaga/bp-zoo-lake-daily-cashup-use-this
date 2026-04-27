ALTER TABLE public.monthly_branch_figures
  ADD COLUMN airtime_bld_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN airtime_easypay_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN airtime_lotto_balance numeric NOT NULL DEFAULT 0;