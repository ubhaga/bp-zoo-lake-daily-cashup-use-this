
CREATE TABLE public.bank_line_allocations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_line_id UUID REFERENCES public.bank_statement_lines(id) ON DELETE CASCADE NOT NULL,
  recon_type TEXT NOT NULL DEFAULT '',
  target_name TEXT NOT NULL DEFAULT '',
  month TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (bank_line_id)
);

ALTER TABLE public.bank_line_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to bank_line_allocations"
  ON public.bank_line_allocations
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);
