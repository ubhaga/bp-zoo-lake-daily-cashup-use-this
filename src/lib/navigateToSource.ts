/**
 * Cross-tab navigation helper. Components anywhere in the app can call this
 * to jump to the source form (Cashier Daily or Manager Daily) for a given
 * date. Index.tsx listens to the `lovable:nav` event and switches tabs +
 * sets the active date.
 */
export type SourceTab = 'cashier' | 'manager-daily' | 'manager-monthly';

export function navigateToSource(date: string, source: SourceTab) {
  window.dispatchEvent(
    new CustomEvent('lovable:nav', { detail: { tab: source, date } }),
  );
}