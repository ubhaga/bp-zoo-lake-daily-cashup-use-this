ALTER TABLE public.manager_daily_entries
  ADD COLUMN blue_label_comm numeric NOT NULL DEFAULT 0,
  ADD COLUMN easypay_comm numeric NOT NULL DEFAULT 0,
  ADD COLUMN lotto_comm numeric NOT NULL DEFAULT 0;