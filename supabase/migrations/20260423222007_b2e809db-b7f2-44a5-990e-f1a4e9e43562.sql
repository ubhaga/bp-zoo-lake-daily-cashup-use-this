CREATE TABLE public.bank_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recon_type text NOT NULL,
  target_name text NOT NULL,
  reference text NOT NULL DEFAULT '',
  min_amount numeric,
  max_amount numeric,
  priority integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to bank_rules"
ON public.bank_rules
FOR ALL
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_bank_rules_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bank_rules_updated_at
BEFORE UPDATE ON public.bank_rules
FOR EACH ROW
EXECUTE FUNCTION public.set_bank_rules_updated_at();

CREATE INDEX idx_bank_rules_recon_type ON public.bank_rules(recon_type);
CREATE INDEX idx_bank_rules_enabled ON public.bank_rules(enabled);