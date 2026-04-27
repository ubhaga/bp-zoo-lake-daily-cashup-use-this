CREATE TABLE public.speedpoint_unmatched_auto (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  month text NOT NULL,
  bank_line_id uuid NOT NULL,
  terminal text NOT NULL,
  batch text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_line_id)
);
ALTER TABLE public.speedpoint_unmatched_auto ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to speedpoint_unmatched_auto"
  ON public.speedpoint_unmatched_auto FOR ALL
  USING (true) WITH CHECK (true);