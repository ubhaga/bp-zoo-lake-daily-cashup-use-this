import { isNetAccContent, extractNetAccPayouts } from './dayEndNetAcc';
 * Extract the "Payouts" amount from the Daily Takings Summary section
 * of an uploaded day-end (.rpt) report.
 *
 * Example line:
 *   Payouts                -3162.01
 *
 * The amount in the report is negative — we return the absolute value
 * (i.e. amount * -1) which represents the cash payouts total to be used
 * in the cashier sheet.
 *
 * Returns null if no Payouts line is found.
 */
export function extractDayEndPayouts(content: string): number | null {
  if (!content) return null;
  // NetAcc PDFs (NetPOS Shift File) — delegate to NetAcc parser.
  if (isNetAccContent(content)) {
    return extractNetAccPayouts(content);
  }
  // Restrict search to the "Daily Takings Summary" block to avoid false matches
  const idx = content.indexOf('Daily Takings Summary');
  const scope = idx >= 0 ? content.slice(idx, idx + 2000) : content;
  // Match lines like:  Payouts            -3162.01
  const m = scope.match(/^\s*Payouts\s+(-?[\d,]+\.\d{2})/m);
  if (!m) return null;
  const raw = parseFloat(m[1].replace(/,/g, ''));
  if (isNaN(raw)) return null;
  return Math.abs(raw); // payouts * -1
}

export interface EosExceptionRow {
  cashierName: string;
  netTakings: number;
}

export interface DayEndCashierAutofill {
  cashierName: string | null;
  shopIncome: number | null;
  shopReturnsToday: number | null;
  optIncome: number | null;
}

function parseAmount(value: string): number {
  return parseFloat(value.replace(/,/g, '')) || 0;
}

export function extractEosExceptions(content: string): EosExceptionRow[] {
  if (!content) return [];
  const idx = content.indexOf('EOS Exceptions - By End of Day  Batch');
  if (idx < 0) return [];

  const scope = content.slice(idx, idx + 3000);
  const lines = scope.split('\n');
  const rows: EosExceptionRow[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('EOS Exceptions') || trimmed.startsWith('Batch ')) continue;
    if (trimmed.startsWith('Cashier') || trimmed.startsWith('-------') || trimmed.startsWith('------------')) continue;
    if (/^[-=~.]+$/.test(trimmed.replace(/\s+/g, ''))) continue;

    const match = line.match(/^\s*([A-Z][A-Z\s]{1,15}?)\s+(-?[\d,]+\.\d{2})\s+/);
    if (!match) continue;

    const cashierName = match[1].trim();
    const netTakings = parseAmount(match[2]);
    if (!cashierName) continue;
    rows.push({ cashierName, netTakings });
  }

  return rows;
}

export function extractCashierDailyAutofill(content: string): DayEndCashierAutofill | null {
  if (!content) return null;

  const eosRows = extractEosExceptions(content);
  const firstCashierRow = eosRows.find((row) => row.cashierName.toUpperCase() !== 'OPT') ?? null;
  const optRow = eosRows.find((row) => row.cashierName.toUpperCase() === 'OPT') ?? null;

  const summaryIdx = content.indexOf('Daily Takings Summary');
  const summaryScope = summaryIdx >= 0 ? content.slice(summaryIdx, summaryIdx + 1200) : content;
  
  // Extract Sales from Daily Takings Summary
  const salesMatch = summaryScope.match(/^\s*Sales\s+(-?[\d,]+\.\d{2})/m);
  const salesAmount = salesMatch ? parseAmount(salesMatch[1]) : null;

  return {
    cashierName: firstCashierRow?.cashierName ?? null,
    // Shop Income = Sales - OPT Nett Takings
    shopIncome: salesAmount != null && optRow ? salesAmount - optRow.netTakings : null,
    shopReturnsToday: null,
    optIncome: optRow?.netTakings ?? null,
  };
}
