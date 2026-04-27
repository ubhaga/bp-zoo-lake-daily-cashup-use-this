
UPDATE speedpoint_manual_matches smm
SET bank_line_id = bsl.id
FROM bank_statement_lines bsl
WHERE smm.month = bsl.month
  AND smm.bank_description = bsl.description
  AND smm.bank_amount = bsl.amount
  AND smm.bank_line_id NOT IN (SELECT id FROM bank_statement_lines)
  AND smm.month = '2026-03';
