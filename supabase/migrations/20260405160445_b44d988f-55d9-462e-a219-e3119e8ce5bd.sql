
CREATE TABLE public.other_adjustment_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  month text NOT NULL,
  cashup_date text NOT NULL,
  adjustment_id text NOT NULL,
  category text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(month, cashup_date, adjustment_id)
);

ALTER TABLE public.other_adjustment_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to other_adjustment_categories"
ON public.other_adjustment_categories
FOR ALL
USING (true)
WITH CHECK (true);
