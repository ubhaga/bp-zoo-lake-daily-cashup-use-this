/**
 * Browser-side PDF text extraction using pdfjs-dist.
 *
 * Used by the NetAcc day-end upload flow: a PDF is dropped, we pull the
 * raw text out, and store it in `day_end_uploads.content` alongside a
 * `<<NETACC SHIFT FILE>>` marker so downstream parsers know the format.
 */

import * as pdfjsLib from 'pdfjs-dist';
// Use the bundled worker so we don't need a CDN at runtime.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

(pdfjsLib.GlobalWorkerOptions as { workerSrc: string }).workerSrc = workerSrc;

/**
 * Extract text from a PDF File. Lines are reconstructed by sorting items
 * top-to-bottom then left-to-right per page, with simple Y-grouping so a
 * row of the table reads as a single line.
 */
export async function extractPdfText(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    type Item = { str: string; transform: number[] };
    const items = content.items as Item[];

    // Group items by Y row (rounded) — PDF Y axis is bottom-up.
    const rows = new Map<number, { x: number; str: string }[]>();
    for (const it of items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]); // already in PDF user units
      const x = it.transform[4];
      const arr = rows.get(y) ?? [];
      arr.push({ x, str: it.str });
      rows.set(y, arr);
    }
    // Highest Y first (top of page)
    const sortedYs = [...rows.keys()].sort((a, b) => b - a);
    for (const y of sortedYs) {
      const cells = rows.get(y)!.sort((a, b) => a.x - b.x);
      let line = '';
      let prevEndX = -Infinity;
      for (const c of cells) {
        // Insert spaces proportional to gap
        if (line && c.x - prevEndX > 4) line += '  ';
        line += c.str;
        prevEndX = c.x + c.str.length * 4; // rough estimate — sufficient for grouping
      }
      out.push(line.trimEnd());
    }
    out.push(''); // page break separator
  }
  await pdf.cleanup();
  return out.join('\n');
}
