DELETE FROM public.bank_statement_lines a
USING public.bank_statement_lines b
WHERE a.ctid > b.ctid
  AND a.month = b.month
  AND a.transaction_date = b.transaction_date
  AND a.description = b.description
  AND a.amount = b.amount;

CREATE UNIQUE INDEX IF NOT EXISTS bank_statement_lines_dedup_idx
  ON public.bank_statement_lines (month, transaction_date, description, amount);
