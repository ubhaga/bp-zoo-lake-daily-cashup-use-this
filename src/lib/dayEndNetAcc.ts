/**
 * NetAcc / NetPOS Shift File parser.
 *
 * NetAcc PDFs are converted to plain text on upload (pdfjs-dist) and the
 * extracted text is stored in `day_end_uploads.content` with a leading marker
 * line `<<NETACC SHIFT FILE>>` so consumers can tell the two formats apart.
 *
 * Sections we care about:
 *   1. Totalisors (Closing minus Open)         → Electric Meter Sales (per pump/nozzle)
 *   2. Account Transactions                    → Section 7 MOP Account (one row per invoice)
 *   3. bpRewards Settlements (Batch # + total) → Section 6 Speedpoints (Redeem terminal)
 *   4. Sales Summary  TOTAL                    → Section 1 Income (Shop Till)
 *   5. Manual Safe deposits TOTAL              → Cash Connect Total validation badge
 */

export const NETACC_MARKER = '<<NETACC SHIFT FILE>>';

export function isNetAccContent(content: string | null | undefined): boolean {
  if (!content) return false;
  return content.startsWith(NETACC_MARKER) || /NetPOS Shift File/i.test(content.slice(0, 2000));
}

/** Extract the shift batch date from "Start : Sat-28-Feb-2026 22:00:10" or "End : Sun-01-Mar-2026 ...".
 * Returns yyyy-MM-dd of the End date (i.e. the trading day the shift closes on). */
export function extractNetAccBatchDate(content: string): string | null {
  if (!content) return null;
  // Prefer End: line — that's the day the shift was closed.
  const m = content.match(/End\s*:\s*[A-Za-z]{3}-(\d{2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const [, dd, monStr, yyyy] = m;
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };
  const mm = months[monStr];
  if (!mm) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function num(s: string): number {
  return parseFloat(s.replace(/[, ]/g, '')) || 0;
}

/* ---------- 1. Pump sales (Totalisors Closing minus Open) ---------- */
export interface NetAccPumpRow {
  pumpNo: string;        // "01" → "1"
  gradeId: string;       // "1" or "2" (nozzle index in PDF)
  gradeDescription: string;
  volumeSold: number;
  moneySold: number;
}

export function extractNetAccPumpSales(content: string): NetAccPumpRow[] {
  if (!content) return [];
  const idx = content.indexOf('Totalisors (Closing minus Open)');
  if (idx < 0) return [];
  // Stop before the next section
  const endIdx = content.indexOf('Recorded Pump Sales', idx);
  const scope = content.slice(idx, endIdx > 0 ? endIdx : idx + 5000);
  const rows: NetAccPumpRow[] = [];
  // Match lines like:  01 1 1ULT ULP95 188.16 3782.12
  const re = /^\s*(\d{1,2})\s+(\d{1,2})\s+([A-Z0-9][A-Z0-9 ]*?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope)) !== null) {
    const pumpNo = String(parseInt(m[1], 10));
    const gradeId = String(parseInt(m[2], 10));
    rows.push({
      pumpNo,
      gradeId,
      gradeDescription: m[3].trim(),
      volumeSold: num(m[4]),
      moneySold: num(m[5]),
    });
  }
  return rows;
}

/* ---------- 2. Account Transactions → MOP Account (Debtors) ---------- */
export interface NetAccDebtorRow {
  accountName: string;   // Title-cased Account Holder
  invoice: string;       // Invoice number (acts as identifier)
  amount: number;
}

function toTitleCase(raw: string): string {
  return raw.toLowerCase().split(/\s+/).map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ').trim();
}

export function extractNetAccDebtors(content: string): NetAccDebtorRow[] {
  if (!content) return [];
  const idx = content.indexOf('Account Transactions');
  if (idx < 0) return [];
  const endIdx = content.indexOf('Bank Settlements', idx);
  const scope = content.slice(idx, endIdx > 0 ? endIdx : idx + 20000);

  const rows: NetAccDebtorRow[] = [];
  // Account Holder block pattern. Multiple invoices may follow per holder.
  const holderRe = /Account Holder:\s*([^\n]+)/g;
  let hMatch: RegExpExecArray | null;
  const holders: { name: string; start: number }[] = [];
  while ((hMatch = holderRe.exec(scope)) !== null) {
    holders.push({ name: hMatch[1].trim(), start: hMatch.index });
  }
  holders.forEach((h, i) => {
    const blockEnd = i + 1 < holders.length ? holders[i + 1].start : scope.length;
    const block = scope.slice(h.start, blockEnd);
    // Each invoice line: "Invoice: 389720    Amount: 523.44"
    const invRe = /Invoice:\s*(\d+)\s+Amount:\s*([-\d,]+\.\d{2})/g;
    let im: RegExpExecArray | null;
    while ((im = invRe.exec(block)) !== null) {
      const amount = num(im[2]);
      if (amount === 0) continue;
      rows.push({
        accountName: toTitleCase(h.name),
        invoice: im[1],
        amount,
      });
    }
  });
  return rows;
}

/* ---------- 3. bpRewards Settlements → Redeem speedpoint ---------- */
export interface NetAccBpRewards {
  batch: string;
  amount: number;
}

export function extractNetAccBpRewards(content: string): NetAccBpRewards | null {
  if (!content) return null;
  const idx = content.indexOf('bpRewards Settlements');
  if (idx < 0) return null;
  const scope = content.slice(idx, idx + 2500);
  // First Batch # in the section
  const batchMatch = scope.match(/Batch\s*#\s*(\d+)/);
  // Final TOTAL line of section
  const totalMatch = scope.match(/^\s*TOTAL\s+([\d,]+\.\d{2})/m);
  if (!totalMatch) return null;
  const amount = num(totalMatch[1]);
  if (amount === 0) return null;
  return {
    batch: batchMatch ? batchMatch[1] : '',
    amount,
  };
}

/* ---------- 4. Sales Summary TOTAL → Income (Shop Till) ---------- */
export function extractNetAccSalesTotal(content: string): number | null {
  if (!content) return null;
  const idx = content.indexOf('Sales Summary');
  if (idx < 0) return null;
  const scope = content.slice(idx, idx + 1000);
  // "TOTAL    76881.74"
  const m = scope.match(/^\s*TOTAL\s+([\d,]+\.\d{2})/m);
  if (!m) return null;
  return num(m[1]);
}

/* ---------- 5. Manual Safe Deposits TOTAL → Cash Connect badge ---------- */
export function extractNetAccSafeDepositsTotal(content: string): number | null {
  if (!content) return null;
  // The header text appears as "Manual Safe deposits" or "Manual Safe Deposits"
  const idx = content.search(/Manual Safe [Dd]eposits/);
  if (idx < 0) return null;
  const scope = content.slice(idx, idx + 3000);
  // Stop at Attendant Analysis (next section)
  const endIdx = scope.indexOf('Attendant Analysis');
  const block = endIdx > 0 ? scope.slice(0, endIdx) : scope;
  const m = block.match(/^\s*(?:\*\*)?TOTAL(?:\*\*)?\s+(?:\*\*)?([\d,]+\.\d{2})/m);
  if (!m) return null;
  return num(m[1]);
}
