import React from 'react';
import { navigateToSource, type SourceTab } from '@/lib/navigateToSource';

export interface BreakdownEntry {
  date: string;
  amount: number;
  label?: string;
}

interface SourceBreakdownProps {
  entries: BreakdownEntry[];
  source: SourceTab;
  children: React.ReactNode;
  className?: string;
  emptyText?: string;
}

/**
 * Click an aggregated amount to jump directly to the source form.
 * For multi-date aggregates, opens the earliest contributing date — the user
 * can then navigate dates inside the source form. No popover/preview is shown.
 */
export function SourceBreakdown({
  entries,
  source,
  children,
  className = '',
}: SourceBreakdownProps) {
  if (entries.length === 0) return <>{children}</>;
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const targetDate = sorted[0].date;
  const labelMap: Record<SourceTab, string> = {
    cashier: 'Cashier Daily',
    'manager-daily': 'Manager Daily',
    'manager-monthly': 'Manager Monthly',
  };
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); navigateToSource(targetDate, source); }}
      title={`Open ${labelMap[source]} (${sorted.length} entr${sorted.length === 1 ? 'y' : 'ies'})`}
      className={`underline decoration-dotted decoration-primary/40 underline-offset-2 hover:decoration-primary hover:text-primary cursor-pointer ${className}`}
    >
      {children}
    </button>
  );
}