/**
 * Extract MOP Account (Debtors) entries from the "EOD Debtors Transactions"
 * section of an uploaded day-end (.rpt) report.
 *
 * Each transaction line format:
 *   Trx Desc           A/C No  A/C Name                     Doc No   Description        Date       Excl Amount  Vat Amount  Incl Amount
 *   TAX INVOICE        3333    SHOP EXPENSE                 66776    TL# 1 #1078        31/03/2026       29.13        4.37        33.50
 *
 * Rules:
 *   - Only rows that have a numeric/text A/C No are real debtor accounts.
 *     Rows where A/C No is "CASH" (no real account) are excluded — they belong
 *     to cash sales, not the MOP Account section.
 *   - Return one entry per transaction row (do NOT aggregate by account).
 *     Multiple rows for the same account each appear separately.
 *   - Skip the "Total for :" footer line.
 *   - Names are returned in Title Case (e.g. "Shop Expense") to match
 *     the conventions used in Master Data.
 *
 * Returns entries in the order they appear in the report.
 */
export interface DayEndDebtorEntry {
  accountName: string;   // Title-cased account name (e.g. "Shop Expense")
  amount: number;        // Sum of Incl Amount column
}

/** Convert "SHOP EXPENSE" → "Shop Expense", preserving short tokens like "BP". */
function toTitleCase(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map(w => {
      if (!w) return w;
      // Keep all-letter 2-char tokens (BP, CJ, etc.) uppercase if they were
      // uppercase originally — easier: just title-case everything.
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ')
    .trim();
}

export function extractDayEndDebtors(content: string): DayEndDebtorEntry[] {
  if (!content) return [];
  const idx = content.indexOf('EOD Debtors Transactions');
  if (idx < 0) return [];
  // Limit scope so we don't accidentally read past into other sections
  const endIdx = content.indexOf('Total for : TAX INVOICE', idx);
  const scope = content.slice(idx, endIdx > 0 ? endIdx : idx + 20000);

  const lines = scope.split('\n');
  const entries: DayEndDebtorEntry[] = [];

  for (const line of lines) {
    // Skip headers, dividers, batch info
    if (!line.trim()) continue;
    if (line.startsWith('-')) continue;
    if (/^(Trx Desc|Batch|EOD Debtors|Total for)/i.test(line.trim())) continue;

    // Match: <Trx Desc> <A/C No> <A/C Name> <Doc No> <Desc...> <Date> <Excl> <Vat> <Incl>
    // We only need A/C Name + Incl. Strategy: split on whitespace runs of 2+
    // because the report uses column padding with multiple spaces between fields.
    const cols = line.split(/\s{2,}/).map(c => c.trim()).filter(Boolean);
    if (cols.length < 6) continue;

    // Last numeric column = Incl Amount; we also need A/C Name (col 2) and A/C No (col 1)
    // cols[0] = Trx Desc (e.g. "TAX INVOICE")
    // cols[1] = A/C No   (e.g. "3333" or "CASH")
    // cols[2] = A/C Name (e.g. "SHOP EXPENSE") — empty/missing if A/C No is CASH
    const trxDesc = cols[0];
    const acNo = cols[1];
    if (!/^TAX INVOICE|CREDIT|GOODS/i.test(trxDesc)) continue;
    // Exclude CASH rows (no real debtor account)
    if (/^CASH$/i.test(acNo)) continue;
    // A/C No should look like an account code (digits or short alnum)
    if (!/^[A-Z0-9]{1,8}$/i.test(acNo)) continue;

    const acName = cols[2];
    if (!acName) continue;

    // Last column = Incl Amount
    const lastCol = cols[cols.length - 1];
    const inclMatch = lastCol.match(/^(-?[\d,]+\.\d{2})$/);
    if (!inclMatch) continue;
    const incl = parseFloat(inclMatch[1].replace(/,/g, ''));
    if (isNaN(incl)) continue;

    const titled = toTitleCase(acName);
    entries.push({ accountName: titled, amount: incl });
  }

  return entries;
}
