function pad2(s: string): string {
  return s.length === 1 ? `0${s}` : s;
}

export function parseBankStatementDate(dateStr: string): string | null {
  const normalized = dateStr.trim();

  if (!normalized) return null;

  // ISO: YYYY-MM-DD or YYYY/MM/DD
  const isoLikeMatch = normalized.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (isoLikeMatch) {
    const [, year, month, day] = isoLikeMatch;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  // D/M/YYYY or M/D/YYYY (ambiguous). Disambiguate by checking which is > 12.
  const slashMatch = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    const [, a, b, year] = slashMatch;
    const aNum = parseInt(a, 10);
    const bNum = parseInt(b, 10);

    let day: string;
    let month: string;

    if (aNum > 12 && bNum <= 12) {
      // Clearly DD/MM/YYYY
      day = a;
      month = b;
    } else if (bNum > 12 && aNum <= 12) {
      // Clearly MM/DD/YYYY (US)
      month = a;
      day = b;
    } else {
      // Ambiguous (both <= 12). Default to MM/DD/YYYY (US format, matches FNB CSV exports).
      month = a;
      day = b;
    }

    if (parseInt(month, 10) < 1 || parseInt(month, 10) > 12) return null;
    if (parseInt(day, 10) < 1 || parseInt(day, 10) > 31) return null;

    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  return null;
}

export function parseBankStatementDateToDate(dateStr: string): Date | null {
  const isoDate = parseBankStatementDate(dateStr);
  if (!isoDate) return null;

  const parsed = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
