import React from 'react';
import { navigateToSource, type SourceTab } from '@/lib/navigateToSource';

interface SourceLinkProps {
  date: string;
  source: SourceTab;
  children: React.ReactNode;
  className?: string;
  title?: string;
}

/**
 * Wraps an amount or label so clicking it jumps to the source form
 * (Cashier Daily or Manager Daily) for that date. Used across all recons
 * so users can drill back into the entry that produced any number.
 */
export function SourceLink({ date, source, children, className = '', title }: SourceLinkProps) {
  if (!date) return <>{children}</>;
  const labelMap: Record<SourceTab, string> = {
    cashier: 'Cashier Daily',
    'manager-daily': 'Manager Daily',
    'manager-monthly': 'Manager Monthly',
  };
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); navigateToSource(date, source); }}
      title={title ?? `Open ${labelMap[source]} for ${date}`}
      className={`underline decoration-dotted decoration-primary/40 underline-offset-2 hover:decoration-primary hover:text-primary cursor-pointer ${className}`}
    >
      {children}
    </button>
  );
}