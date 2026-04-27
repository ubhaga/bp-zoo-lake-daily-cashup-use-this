
CREATE TABLE public.creditor_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month text NOT NULL,
  supplier text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(month, supplier)
);

ALTER TABLE public.creditor_opening_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to creditor_opening_balances"
  ON public.creditor_opening_balances
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);
