CREATE TABLE public.bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month text NOT NULL,
  upload_date timestamp with time zone NOT NULL DEFAULT now(),
  transaction_date text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  matched_terminal text NOT NULL DEFAULT '',
  raw_line text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to bank_statement_lines"
ON public.bank_statement_lines
FOR ALL
TO public
USING (true)
WITH CHECK (true);