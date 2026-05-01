CREATE TABLE public.cash_recon_manual_matches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  month TEXT NOT NULL,
  cashup_date TEXT NOT NULL,
  bank_line_id UUID NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  recon_kind TEXT NOT NULL DEFAULT 'deposita',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.cash_recon_manual_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to cash_recon_manual_matches"
ON public.cash_recon_manual_matches
FOR ALL
USING (true)
WITH CHECK (true);

CREATE INDEX idx_cash_recon_manual_matches_month ON public.cash_recon_manual_matches(month);
CREATE INDEX idx_cash_recon_manual_matches_bank_line ON public.cash_recon_manual_matches(bank_line_id);