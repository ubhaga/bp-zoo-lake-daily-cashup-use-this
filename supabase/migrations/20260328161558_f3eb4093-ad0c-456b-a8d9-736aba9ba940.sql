CREATE TABLE public.speedpoint_manual_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month text NOT NULL,
  cashup_date text NOT NULL,
  terminal text NOT NULL,
  bank_line_idx integer NOT NULL,
  bank_amount numeric NOT NULL DEFAULT 0,
  bank_description text NOT NULL DEFAULT '',
  bank_date text NOT NULL DEFAULT '',
  bank_terminal text NOT NULL DEFAULT '',
  bank_batch text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.speedpoint_manual_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to speedpoint_manual_matches"
ON public.speedpoint_manual_matches
FOR ALL
TO public
USING (true)
WITH CHECK (true);