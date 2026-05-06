CREATE TABLE IF NOT EXISTS public.other_adj_bank_clearances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month text NOT NULL,
  cashup_date text NOT NULL,
  adjustment_id text NOT NULL,
  bank_line_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS other_adj_bank_clearances_uniq
  ON public.other_adj_bank_clearances (month, cashup_date, adjustment_id);
ALTER TABLE public.other_adj_bank_clearances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to other_adj_bank_clearances"
  ON public.other_adj_bank_clearances FOR ALL USING (true) WITH CHECK (true);