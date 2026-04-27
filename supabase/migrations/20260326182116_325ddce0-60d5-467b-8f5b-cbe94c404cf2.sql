
-- Daily cashups table
CREATE TABLE public.daily_cashups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date TEXT NOT NULL,
  month TEXT NOT NULL,
  entered_by TEXT NOT NULL DEFAULT '',
  shop_shift_number INTEGER NOT NULL DEFAULT 0,
  opt_shift_number INTEGER NOT NULL DEFAULT 0,
  cashier_name TEXT NOT NULL DEFAULT '',
  shop JSONB NOT NULL DEFAULT '{}'::jsonb,
  opt JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(date)
);

-- Manager daily entries table
CREATE TABLE public.manager_daily_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date TEXT NOT NULL,
  cashup_id TEXT NOT NULL DEFAULT '',
  entered_by TEXT NOT NULL DEFAULT '',
  explanations TEXT NOT NULL DEFAULT '',
  payout_invoices JSONB NOT NULL DEFAULT '[]'::jsonb,
  eft_invoices JSONB NOT NULL DEFAULT '[]'::jsonb,
  coins_opening_balance NUMERIC NOT NULL DEFAULT 0,
  easypay_opening_balance NUMERIC NOT NULL DEFAULT 0,
  cash_connect_opening_balance NUMERIC NOT NULL DEFAULT 0,
  daily_coins NUMERIC NOT NULL DEFAULT 0,
  cash_deposited_easypay NUMERIC NOT NULL DEFAULT 0,
  cash_deposited_cash_connect NUMERIC NOT NULL DEFAULT 0,
  cc_bag_closure_coins NUMERIC NOT NULL DEFAULT 0,
  cc_bag_closure_easypay NUMERIC NOT NULL DEFAULT 0,
  cc_bag_closure_cash_connect NUMERIC NOT NULL DEFAULT 0,
  transfer_from_coins NUMERIC NOT NULL DEFAULT 0,
  branch_day_end_total NUMERIC NOT NULL DEFAULT 0,
  branch_day_end_vat NUMERIC NOT NULL DEFAULT 0,
  invoice_notes TEXT NOT NULL DEFAULT '',
  cash_reconc_notes TEXT NOT NULL DEFAULT '',
  bank_charges NUMERIC NOT NULL DEFAULT 0,
  banking NUMERIC NOT NULL DEFAULT 0,
  locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(date)
);

-- Monthly branch figures table
CREATE TABLE public.monthly_branch_figures (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  month TEXT NOT NULL,
  entered_by TEXT NOT NULL DEFAULT '',
  branch_net_sales NUMERIC NOT NULL DEFAULT 0,
  branch_total_payouts NUMERIC NOT NULL DEFAULT 0,
  branch_total_receipts NUMERIC NOT NULL DEFAULT 0,
  branch_total_invoices_capital NUMERIC NOT NULL DEFAULT 0,
  branch_total_invoices_vat NUMERIC NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(month)
);

-- Master data table (key-value for lists)
CREATE TABLE public.master_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  data JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Allow public access (no auth required for this internal tool)
ALTER TABLE public.daily_cashups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_daily_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_branch_figures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to daily_cashups" ON public.daily_cashups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to manager_daily_entries" ON public.manager_daily_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to monthly_branch_figures" ON public.monthly_branch_figures FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to master_data" ON public.master_data FOR ALL USING (true) WITH CHECK (true);
