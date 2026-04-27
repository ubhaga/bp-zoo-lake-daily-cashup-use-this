CREATE TABLE public.commission_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  commission_key TEXT NOT NULL,
  schedule_type TEXT NOT NULL,
  weekday SMALLINT,
  day_of_month SMALLINT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT commission_key_valid CHECK (commission_key IN ('blue_label','easypay','lotto')),
  CONSTRAINT schedule_type_valid CHECK (schedule_type IN ('last_day_of_month','first_day_of_month','weekday','day_of_month')),
  CONSTRAINT weekday_range CHECK (weekday IS NULL OR (weekday BETWEEN 0 AND 6)),
  CONSTRAINT day_of_month_range CHECK (day_of_month IS NULL OR (day_of_month BETWEEN 1 AND 31))
);

ALTER TABLE public.commission_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to commission_schedules"
ON public.commission_schedules
FOR ALL
USING (true)
WITH CHECK (true);

CREATE TRIGGER commission_schedules_updated_at
BEFORE UPDATE ON public.commission_schedules
FOR EACH ROW
EXECUTE FUNCTION public.set_bank_rules_updated_at();

INSERT INTO public.commission_schedules (commission_key, schedule_type) VALUES
  ('blue_label', 'last_day_of_month'),
  ('easypay', 'last_day_of_month');

INSERT INTO public.commission_schedules (commission_key, schedule_type, weekday) VALUES
  ('lotto', 'weekday', 6);
