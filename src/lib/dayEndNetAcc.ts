/**
 * NetAcc / NetPOS Shift File parser.
 *
 * NetAcc PDFs are converted to plain text on upload (pdfjs-dist) and the
 * extracted text is stored in `day_end_uploads.content` with a leading marker
 * line `<<NETACC SHIFT FILE>>` so consumers can tell the two formats apart.
 *
 * IMPORTANT: pdfjs-dist outputs multiple spaces between glyphs (positional
 * spacing). All section headers and data lines must be matched with flexible
 * whitespace. We normalise content with `normalize()` before searching.
 */

export const NETACC_MARKER = '<<NETACC SHIFT FILE>>';

export function isNetAccContent(content: string | null | undefined): boolean {
  if (!content) return false;
  return content.startsWith(NETACC_MARKER) || /NetPOS Shift File/i.test(content.slice(0, 2000));
}

/** Collapse runs of whitespace (but keep newlines) so headers like
 *  "Account   Transactions" become "Account Transactions". */
function normalize(content: string): string {
  return content
    .split('\n')
    .map((line) => line.replace(/[ \t\u00A0]+/g, ' ').trim())
    .join('\n');
}

export function extractNetAccBatchDate(content: string): string | null {
  if (!content) return null;
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
  pumpNo: string;
  gradeId: string;
  gradeDescription: string;
  volumeSold: number;
  moneySold: number;
}

export function extractNetAccPumpSales(content: string): NetAccPumpRow[] {
  if (!content) return [];
  const text = normalize(content);
  const idx = text.search(/Totalisors\s*\(Closing\s*minus\s*Open\)/i);
  if (idx < 0) return [];
  const endIdx = text.indexOf('Recorded Pump Sales', idx);
  const scope = text.slice(idx, endIdx > 0 ? endIdx : idx + 5000);
  const rows: NetAccPumpRow[] = [];
  // "01 1 1ULT ULP95 188.16 3782.12"
  const re = /^(\d{1,2})\s+(\d{1,2})\s+([A-Z0-9][A-Z0-9 ]*?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope)) !== null) {
    rows.push({
      pumpNo: String(parseInt(m[1], 10)),
      gradeId: String(parseInt(m[2], 10)),
      gradeDescription: m[3].trim(),
      volumeSold: num(m[4]),
      moneySold: num(m[5]),
    });
  }
  return rows;
}

/* ---------- 2. Account Transactions → MOP Account (Debtors) ---------- */
export interface NetAccDebtorRow {
  accountName: string;
  invoice: string;
  amount: number;
}

function toTitleCase(raw: string): string {
  return raw.toLowerCase().split(/\s+/).map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ').trim();
}

export function extractNetAccDebtors(content: string): NetAccDebtorRow[] {
  if (!content) return [];
  const text = normalize(content);
  const idx = text.search(/Account Transactions/i);
  if (idx < 0) return [];
  // Section ends at ACCOUNT GRAND TOTAL or Bank Settlements
  const endRe = /ACCOUNT GRAND TOTAL|Bank Settlements/i;
  const tail = text.slice(idx);
  const endMatch = tail.search(endRe);
  const scope = endMatch > 0 ? tail.slice(0, endMatch) : tail.slice(0, 20000);

  const rows: NetAccDebtorRow[] = [];
  const holderRe = /Account Holder:\s*([^\n]+)/g;
  const holders: { name: string; start: number }[] = [];
  let hMatch: RegExpExecArray | null;
  while ((hMatch = holderRe.exec(scope)) !== null) {
    holders.push({ name: hMatch[1].trim(), start: hMatch.index });
  }
  holders.forEach((h, i) => {
    const blockEnd = i + 1 < holders.length ? holders[i + 1].start : scope.length;
    const block = scope.slice(h.start, blockEnd);
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
  const text = normalize(content);
  const idx = text.search(/bpRewards Settlements/i);
  if (idx < 0) return null;
  // Stop at next major section
  const tail = text.slice(idx);
  const endIdx = tail.search(/EFT Summary|Switch Analysis/i);
  const scope = endIdx > 0 ? tail.slice(0, endIdx) : tail.slice(0, 3000);
  const batchMatch = scope.match(/Batch\s*#\s*(\d+)/);
  // Final TOTAL line (not BATCH SUB TOTAL — the last TOTAL)
  const totalMatches = [...scope.matchAll(/^TOTAL\s+([\d,]+\.\d{2})$/gm)];
  if (totalMatches.length === 0) return null;
  const last = totalMatches[totalMatches.length - 1];
  const amount = num(last[1]);
  if (amount === 0) return null;
  return {
    batch: batchMatch ? batchMatch[1] : '',
    amount,
  };
}

/* ---------- 4. Sales Summary TOTAL → Income (Shop Till) ----------
 * The PDF contains TWO "Sales Summary" headers:
 *  - "Fuel MOP Sales Summary"  (skip)
 *  - "Sales Summary" (followed by Wet Stock / Dry Stock / Other / TOTAL) ← what we want
 */
export function extractNetAccSalesTotal(content: string): number | null {
  if (!content) return null;
  const text = normalize(content);
  // Match a Sales Summary that is NOT preceded by "Fuel MOP " on the same line
  const re = /(^|\n)(?!Fuel MOP )(?:[A-Za-z]+ )?Sales Summary\s*\n=+/g;
  // Simpler: find a "Sales Summary" header followed by a line starting with "Wet Stock"
  let idx = -1;
  const allMatches = [...text.matchAll(/Sales Summary/g)];
  for (const m of allMatches) {
    const after = text.slice(m.index!, m.index! + 600);
    if (/Wet Stock/i.test(after)) {
      idx = m.index!;
      break;
    }
  }
  if (idx < 0) return null;
  const scope = text.slice(idx, idx + 600);
  const m = scope.match(/^TOTAL\s+([\d,]+\.\d{2})$/m);
  if (!m) return null;
  return num(m[1]);
}

/* ---------- 5. Manual Safe Deposits TOTAL → Cash Connect badge ---------- */
export function extractNetAccSafeDepositsTotal(content: string): number | null {
  if (!content) return null;
  const text = normalize(content);
  const idx = text.search(/Manual Safe [Dd]eposits/);
  if (idx < 0) return null;
  const tail = text.slice(idx);
  const endIdx = tail.search(/Attendant Analysis|Account Transactions/i);
  const block = endIdx > 0 ? tail.slice(0, endIdx) : tail.slice(0, 3000);
  const m = block.match(/^TOTAL\s+([\d,]+\.\d{2})$/m);
  if (!m) return null;
  return num(m[1]);
}
