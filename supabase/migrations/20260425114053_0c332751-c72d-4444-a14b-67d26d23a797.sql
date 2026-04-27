
-- Recon manual adjustments (creditors per-week deltas, debtors monthly adjustments)
CREATE TABLE public.recon_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recon_type text NOT NULL,            -- 'creditor' | 'debtor'
  month text NOT NULL,                  -- YYYY-MM
  target_name text NOT NULL,            -- supplier or debtor account name
  field text NOT NULL,                  -- 'invoices' | 'payments' (creditor) | 'adjustment' (debtor)
  week_index integer,                   -- nullable; for creditor weekly deltas
  amount numeric NOT NULL DEFAULT 0,    -- delta for creditor, override value for debtor adjustment
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recon_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to recon_adjustments" ON public.recon_adjustments FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_recon_adj_lookup ON public.recon_adjustments(recon_type, month, target_name);

CREATE TRIGGER set_recon_adjustments_updated_at
BEFORE UPDATE ON public.recon_adjustments
FOR EACH ROW EXECUTE FUNCTION public.set_bank_rules_updated_at();

-- Audit log of every change to recon adjustments
CREATE TABLE public.recon_adjustment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recon_type text NOT NULL,
  month text NOT NULL,
  target_name text NOT NULL,
  field text NOT NULL,
  week_index integer,
  old_amount numeric,
  new_amount numeric NOT NULL,
  changed_by text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recon_adjustment_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to recon_adjustment_audit" ON public.recon_adjustment_audit FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_recon_audit_lookup ON public.recon_adjustment_audit(recon_type, month, target_name, created_at DESC);
