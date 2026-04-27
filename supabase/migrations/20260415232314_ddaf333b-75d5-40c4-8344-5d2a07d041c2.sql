
CREATE TABLE public.manual_pump_readings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date TEXT NOT NULL,
  month TEXT NOT NULL,
  readings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(date)
);

ALTER TABLE public.manual_pump_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to manual_pump_readings"
  ON public.manual_pump_readings
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);
