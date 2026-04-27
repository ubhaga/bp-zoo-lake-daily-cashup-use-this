/**
 * Extract invoice totals from the EOD Creditors Transactions section of an
 * uploaded day-end (.rpt) report.
 *
 * Sums:
 *   - "Total for : G.R.N. / TAX INVOICE"
 *   - "Total for : Goods Ret. / Credit"   (typically negative)
 *
 * Each line format:
 *   Total for : <label>           <excl>      <vat>      <incl>
 *
 * Returns { incl, vat } (sum of both lines) or null if neither found.
 */
export interface DayEndInvoiceTotals {
  incl: number;
  vat: number;
}

function matchTotalLine(scope: string, labelPattern: string): { incl: number; vat: number } | null {
  const re = new RegExp(
    `Total for\\s*:\\s*${labelPattern}[^\\d-]*(-?[\\d,]+\\.\\d{2})\\s+(-?[\\d,]+\\.\\d{2})\\s+(-?[\\d,]+\\.\\d{2})`,
    'i'
  );
  const m = scope.match(re);
  if (!m) return null;
  const vat = parseFloat(m[2].replace(/,/g, ''));
  const incl = parseFloat(m[3].replace(/,/g, ''));
  if (isNaN(vat) || isNaN(incl)) return null;
  return { incl, vat };
}

export function extractDayEndInvoiceTotals(content: string): DayEndInvoiceTotals | null {
  if (!content) return null;
  const idx = content.indexOf('EOD Creditors Transactions');
  const scope = idx >= 0 ? content.slice(idx, idx + 8000) : content;

  const grn = matchTotalLine(scope, 'G\\.R\\.N\\.\\s*\\/\\s*TAX INVOICE');
  const credit = matchTotalLine(scope, 'Goods\\s*Ret\\.?\\s*\\/\\s*Credit');

  if (!grn && !credit) return null;
  return {
    incl: (grn?.incl ?? 0) + (credit?.incl ?? 0),
    vat: (grn?.vat ?? 0) + (credit?.vat ?? 0),
  };
}
