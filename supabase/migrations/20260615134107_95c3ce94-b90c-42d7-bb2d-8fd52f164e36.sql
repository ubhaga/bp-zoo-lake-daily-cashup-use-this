
-- Temporarily drop the unique index so normalization can proceed.
DROP INDEX IF EXISTS public.bank_statement_lines_dedup_idx;

-- 1. Normalize transaction_date to ISO (YYYY-MM-DD).
UPDATE public.bank_statement_lines
SET transaction_date = CASE
  WHEN transaction_date ~ '^\d{4}-\d{2}-\d{2}$' THEN transaction_date
  WHEN transaction_date ~ '^\d{4}/\d{2}/\d{2}$' THEN replace(transaction_date, '/', '-')
  WHEN transaction_date ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN (
    CASE
      WHEN lpad(split_part(transaction_date, '/', 3), 4, '0') || '-' ||
           lpad(split_part(transaction_date, '/', 2), 2, '0') = month
        THEN split_part(transaction_date, '/', 3) || '-' ||
             lpad(split_part(transaction_date, '/', 2), 2, '0') || '-' ||
             lpad(split_part(transaction_date, '/', 1), 2, '0')
      ELSE split_part(transaction_date, '/', 3) || '-' ||
           lpad(split_part(transaction_date, '/', 1), 2, '0') || '-' ||
           lpad(split_part(transaction_date, '/', 2), 2, '0')
    END
  )
  ELSE transaction_date
END
WHERE transaction_date !~ '^\d{4}-\d{2}-\d{2}$';

-- 2. Build dup map. Prefer to keep the row that already has an allocation
--    or any reference attached — otherwise the earliest by created_at.
CREATE TEMP TABLE _bsl_dupes ON COMMIT DROP AS
WITH refcounts AS (
  SELECT b.id,
         b.month, b.transaction_date, b.description, b.amount, b.created_at,
         (CASE WHEN EXISTS (SELECT 1 FROM public.bank_line_allocations a WHERE a.bank_line_id = b.id) THEN 1 ELSE 0 END)
       + (CASE WHEN EXISTS (SELECT 1 FROM public.speedpoint_manual_matches m WHERE m.bank_line_id = b.id) THEN 1 ELSE 0 END)
       + (CASE WHEN EXISTS (SELECT 1 FROM public.cash_recon_manual_matches m WHERE m.bank_line_id = b.id) THEN 1 ELSE 0 END)
       + (CASE WHEN EXISTS (SELECT 1 FROM public.other_adj_bank_clearances c WHERE c.bank_line_id = b.id) THEN 1 ELSE 0 END) AS refs
  FROM public.bank_statement_lines b
),
ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY month, transaction_date, description, amount
           ORDER BY refs DESC, created_at ASC, id ASC
         ) AS rn,
         first_value(id) OVER (
           PARTITION BY month, transaction_date, description, amount
           ORDER BY refs DESC, created_at ASC, id ASC
         ) AS keep_id
  FROM refcounts
)
SELECT id AS dup_id, keep_id FROM ranked WHERE rn > 1;

-- 3. Repoint references to the keep row, dropping conflicts where needed.
DELETE FROM public.bank_line_allocations a
USING _bsl_dupes d
WHERE a.bank_line_id = d.dup_id
  AND EXISTS (SELECT 1 FROM public.bank_line_allocations a2 WHERE a2.bank_line_id = d.keep_id);

UPDATE public.bank_line_allocations a
SET bank_line_id = d.keep_id
FROM _bsl_dupes d
WHERE a.bank_line_id = d.dup_id;

UPDATE public.speedpoint_manual_matches m
SET bank_line_id = d.keep_id
FROM _bsl_dupes d
WHERE m.bank_line_id = d.dup_id;

UPDATE public.cash_recon_manual_matches m
SET bank_line_id = d.keep_id
FROM _bsl_dupes d
WHERE m.bank_line_id = d.dup_id;

UPDATE public.other_adj_bank_clearances c
SET bank_line_id = d.keep_id
FROM _bsl_dupes d
WHERE c.bank_line_id = d.dup_id;

-- 4. Delete the duplicate bank lines.
DELETE FROM public.bank_statement_lines b
USING _bsl_dupes d
WHERE b.id = d.dup_id;

-- 5. Recreate the unique dedup index.
CREATE UNIQUE INDEX bank_statement_lines_dedup_idx
  ON public.bank_statement_lines (month, transaction_date, description, amount);
