ALTER TABLE public.manager_daily_entries
  ADD COLUMN lotto_net_sales_comm numeric NOT NULL DEFAULT 0,
  ADD COLUMN lotto_payout_comm numeric NOT NULL DEFAULT 0;