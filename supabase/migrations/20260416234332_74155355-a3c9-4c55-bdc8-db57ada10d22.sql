CREATE TABLE public.pump_variance_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date text NOT NULL,
  month text NOT NULL,
  pump_no text NOT NULL,
  revised_calc_volume numeric NOT NULL DEFAULT 0,
  explanation text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, pump_no)
);

ALTER TABLE public.pump_variance_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to pump_variance_revisions"
ON public.pump_variance_revisions
FOR ALL
USING (true)
WITH CHECK (true);

CREATE INDEX idx_pump_variance_revisions_month ON public.pump_variance_revisions(month);
CREATE INDEX idx_pump_variance_revisions_date ON public.pump_variance_revisions(date);