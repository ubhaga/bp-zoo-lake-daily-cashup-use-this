
CREATE TABLE public.day_end_uploads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date text NOT NULL UNIQUE,
  month text NOT NULL,
  filename text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.day_end_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to day_end_uploads"
  ON public.day_end_uploads
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);
