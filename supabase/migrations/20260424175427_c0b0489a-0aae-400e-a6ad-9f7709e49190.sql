-- Delete the catch-all ABI rules (empty reference)
DELETE FROM bank_rules
WHERE recon_type = 'creditor'
  AND target_name = 'ABI'
  AND TRIM(COALESCE(reference, '')) = '';

-- Delete the too-broad Bakgat rule (single character "B")
DELETE FROM bank_rules
WHERE recon_type = 'creditor'
  AND target_name = 'Bakgat'
  AND TRIM(COALESCE(reference, '')) = 'B';

-- Remove bogus ABI allocations: bank line description must actually contain 'ABI'
DELETE FROM bank_line_allocations a
USING bank_statement_lines l
WHERE a.bank_line_id = l.id
  AND a.recon_type = 'creditor'
  AND a.target_name = 'ABI'
  AND POSITION('abi' IN LOWER(l.description)) = 0;

-- Remove bogus Bakgat allocations: bank line description must actually contain 'bakgat'
DELETE FROM bank_line_allocations a
USING bank_statement_lines l
WHERE a.bank_line_id = l.id
  AND a.recon_type = 'creditor'
  AND a.target_name = 'Bakgat'
  AND POSITION('bakgat' IN LOWER(l.description)) = 0;