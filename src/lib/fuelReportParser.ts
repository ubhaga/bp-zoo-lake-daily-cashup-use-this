/**
 * Parses day-end RPT files for fuel-related sections:
 * - Fuel Sales Control - EOD Short (POS sales per tank)
 * - Fuel Sales Control - MTD Summary (tank sales control)
 * - EOD Pump Variance (meter sales control)
 */

export interface EodShortRow {
  gradeId: string;
  gradeDescription: string;
  amtSales: number;
  pumpVolSales: number;
  tankVolSales: number;
  pumpVolVariance: number;
  openingVol: number;
  volPurchase: number;
  closingDip: number;
}

export interface MtdSummaryRow {
  date: string; // yyyy-MM-dd
  batchNo: string;
  daysPumpVolSales: number;
  mtdPumpVolSales: number;
  openingVol: number;
  daysVolPurchase: number;
  closingDip: number;
  daysTankVolSales: number;
  mtdTankVolSales: number;
  daysPumpVolVariance: number;
  mtdPumpVolVariance: number;
}

export interface MtdSummaryGrade {
  gradeId: string;
  description: string;
  rows: MtdSummaryRow[];
  monthlyTankSales: number;
  monthlyVariance: number;
  variancePercentage: number;
}

export interface PumpVarianceRow {
  pumpNo: string;
  gradeId: string;
  gradeDescription: string;
  startReading: number;
  endReading: number;
  calculatedVolume: number;
  actualVolume: number;
  volumeVariance: number;
  unsettledVolume: number;
  incUnsettledVariance: number;
}

/** Strip POS system page break markers from report content */
export function stripPageBreaks(content: string): string {
  return content
    .replace(/<---\s*Ver:.*?Rpt Type:\s*\w+\s*--->/g, '')
    .replace(/<<\s*Page Break\s*>>/g, '')
    .replace(/\s+Page\s*:\s*\d+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, '')) || 0;
}

function convertDate(dateStr: string): string {
  // dd/MM/yyyy -> yyyy-MM-dd
  const parts = dateStr.split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return dateStr;
}
export function parseEodShort(rawContent: string): EodShortRow[] {
  const content = stripPageBreaks(rawContent);
  const rows: EodShortRow[] = [];
  const lines = content.split('\n');
  let inSection = false;
  let pastHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('Fuel Sales Control - EOD Short')) {
      inSection = true;
      pastHeader = false;
      continue;
    }
    if (inSection && !pastHeader && /^----/.test(line.trim()) && i > 0 && lines[i - 1].includes('Grade Description')) {
      pastHeader = true;
      continue;
    }
    if (inSection && pastHeader) {
      if (line.includes('------') || line.includes('======')) {
        // total/end line
        if (line.includes('------')) continue;
        break;
      }
      if (line.trim() === '') {
        inSection = false;
        break;
      }
      // Parse: GradeID GradeDescription AmtSales PumpVolSales TankVolSales PumpVolVariance OpeningVol VolPurchase ClosingDip
      const m = line.match(
        /^\s*(\d+)\s+(\S+(?:\s+\S+)*?)\s{2,}([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)/
      );
      if (m) {
        rows.push({
          gradeId: m[1],
          gradeDescription: m[2].trim(),
          amtSales: parseNum(m[3]),
          pumpVolSales: parseNum(m[4]),
          tankVolSales: parseNum(m[5]),
          pumpVolVariance: parseNum(m[6]),
          openingVol: parseNum(m[7]),
          volPurchase: parseNum(m[8]),
          closingDip: parseNum(m[9]),
        });
      }
    }
  }
  return rows;
}

export function parseMtdSummary(rawContent: string): MtdSummaryGrade[] {
  const content = stripPageBreaks(rawContent);
  const grades: MtdSummaryGrade[] = [];
  const lines = content.split('\n');
  let inSection = false;
  let currentGrade: MtdSummaryGrade | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('Fuel Sales Control - MTD Summary')) {
      inSection = true;
      continue;
    }

    if (!inSection) continue;

    // Check for grade header
    const gradeMatch = line.match(/Grade ID\s*:\s*(\d+)/);
    if (gradeMatch) {
      if (currentGrade) grades.push(currentGrade);
      const descLine = lines[i + 1] || '';
      const descMatch = descLine.match(/Description\s*:\s*(.+)/);
      currentGrade = {
        gradeId: gradeMatch[1],
        description: descMatch ? descMatch[1].trim() : '',
        rows: [],
        monthlyTankSales: 0,
        monthlyVariance: 0,
        variancePercentage: 0,
      };
      continue;
    }

    if (currentGrade) {
      // Monthly totals
      if (line.includes('MONTHLY TOTALS')) {
        const tankMatch = line.match(/TANK SALES\s+([\d.,\-]+)/);
        if (tankMatch) currentGrade.monthlyTankSales = parseNum(tankMatch[1]);
        // Read next lines for variance
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const vl = lines[j];
          const vm = vl.match(/VARIANCE\s+([\d.,\-]+)\s+Litres/);
          if (vm) { currentGrade.monthlyVariance = parseNum(vm[1]); }
          const vp = vl.match(/VARIANCE PERCENTAGE\s+([\d.,\-]+)/);
          if (vp) { currentGrade.variancePercentage = parseNum(vp[1]); }
        }
        grades.push(currentGrade);
        currentGrade = null;
        continue;
      }

      // Data row: dd/MM/yyyy batch# ... numbers
      const dataMatch = line.match(
        /^\s*(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)/
      );
      if (dataMatch) {
        currentGrade.rows.push({
          date: convertDate(dataMatch[1]),
          batchNo: dataMatch[2],
          daysPumpVolSales: parseNum(dataMatch[3]),
          mtdPumpVolSales: parseNum(dataMatch[4]),
          openingVol: parseNum(dataMatch[5]),
          daysVolPurchase: parseNum(dataMatch[6]),
          closingDip: parseNum(dataMatch[7]),
          daysTankVolSales: parseNum(dataMatch[8]),
          mtdTankVolSales: parseNum(dataMatch[9]),
          daysPumpVolVariance: parseNum(dataMatch[10]),
          mtdPumpVolVariance: parseNum(dataMatch[11]),
        });
      }
    }

    // End of section
    if (line.includes('EOD Pump Variance') || line.includes('Gross Profit')) {
      if (currentGrade) grades.push(currentGrade);
      break;
    }
  }

  return grades;
}

export function parsePumpVariance(rawContent: string): PumpVarianceRow[] {
  const content = stripPageBreaks(rawContent);
  const sectionStart = content.indexOf('EOD Pump Variance');

  if (sectionStart === -1) return [];

  const section = content.slice(sectionStart);
  const rows: PumpVarianceRow[] = [];
  // Lines may have a pump number, OR start blank (continuation of previous pump's other nozzles).
  // Format: [PumpNo?] GradeId Description  Start  End  Calc  Actual  Variance  Unsettled  IncUnsettled
  const rowPattern = /^(\s{0,7}\d+|\s{2,})\s+(\d{1,3})\s+(\S+(?:\s+\S+)*?)\s{2,}([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s+([\d.,\-]+)\s*$/gm;

  let currentPump = '';
  for (const match of section.matchAll(rowPattern)) {
    const pumpRaw = match[1].trim();
    if (pumpRaw) currentPump = pumpRaw;
    if (!currentPump) continue;
    rows.push({
      pumpNo: currentPump,
      gradeId: match[2],
      gradeDescription: match[3].trim(),
      startReading: parseNum(match[4]),
      endReading: parseNum(match[5]),
      calculatedVolume: parseNum(match[6]),
      actualVolume: parseNum(match[7]),
      volumeVariance: parseNum(match[8]),
      unsettledVolume: parseNum(match[9]),
      incUnsettledVariance: parseNum(match[10]),
    });
  }

  return rows;
}

/** Get the batch date from a day-end report */
export function parseBatchDate(content: string): string | null {
  const m = content.match(/Batch Date\s*:\s*(\d{2}\/\d{2}\/\d{4})/);
  if (m) return convertDate(m[1]);
  return null;
}
