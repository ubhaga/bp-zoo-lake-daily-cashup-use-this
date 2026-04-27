CREATE TABLE public.speedpoint_diff_clearances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  month TEXT NOT NULL,
  terminal TEXT NOT NULL,
  date_1 TEXT NOT NULL,
  date_2 TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.speedpoint_diff_clearances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to speedpoint_diff_clearances"
ON public.speedpoint_diff_clearances
FOR ALL
TO public
USING (true)
WITH CHECK (true);