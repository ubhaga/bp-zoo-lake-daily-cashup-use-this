export function parseBankStatementDate(dateStr: string): string | null {
  const normalized = dateStr.trim();

  if (!normalized) return null;

  const isoLikeMatch = normalized.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
  if (isoLikeMatch) {
    const [, year, month, day] = isoLikeMatch;
    return `${year}-${month}-${day}`;
  }

  const dayFirstMatch = normalized.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (dayFirstMatch) {
    const [, day, month, year] = dayFirstMatch;
    return `${year}-${month}-${day}`;
  }

  return null;
}

export function parseBankStatementDateToDate(dateStr: string): Date | null {
  const isoDate = parseBankStatementDate(dateStr);
  if (!isoDate) return null;

  const parsed = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}