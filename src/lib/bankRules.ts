import { supabase } from '@/integrations/supabase/client';

export type ReconType =
  | 'creditor'
  | 'debtor'
  | 'bld'
  | 'easypay'
  | 'lotto'
  | 'cash_cc';

export const RECON_TYPE_LABELS: Record<ReconType, string> = {
  creditor: 'Creditor',
  debtor: 'Debtor',
  bld: 'BLD Creditor',
  easypay: 'Easypay',
  lotto: 'Lotto',
  cash_cc: 'Cash CC',
};

export interface BankRule {
  id: string;
  recon_type: ReconType;
  target_name: string;
  reference: string;
  min_amount: number | null;
  max_amount: number | null;
  priority: number;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface BankLineLite {
  id: string;
  description: string;
  amount: number;
}

/**
 * Match a bank line against a single rule.
 * Reference is split on whitespace; ALL tokens must appear (case-insensitive)
 * as substrings of the description.
 *
 * Safety guard: a rule with NO meaningful reference tokens never matches
 * automatically — otherwise it would catch every bank line. To match without
 * a reference, set an explicit min_amount or max_amount range.
 * Tokens shorter than 3 characters are ignored (too generic, e.g. "B" matched
 * almost every description before this guard).
 * Amount range (min/max) is inclusive when set.
 */
export function ruleMatches(rule: BankRule, line: BankLineLite): boolean {
  if (!rule.enabled) return false;

  const desc = (line.description || '').toLowerCase();
  const tokens = (rule.reference || '')
    .split(/\s+/)
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length >= 3);

  const hasAmountRange = rule.min_amount != null || rule.max_amount != null;
  // No usable reference tokens AND no amount range → refuse to match.
  if (tokens.length === 0 && !hasAmountRange) return false;

  for (const tok of tokens) {
    if (!desc.includes(tok)) return false;
  }

  const amt = Number(line.amount);
  if (rule.min_amount != null && amt < Number(rule.min_amount)) return false;
  if (rule.max_amount != null && amt > Number(rule.max_amount)) return false;

  return true;
}

/**
 * Find the highest-priority matching rule for a bank line.
 * Higher `priority` wins; ties broken by more reference tokens (more specific),
 * then by tighter amount range.
 */
export function findBestRule(rules: BankRule[], line: BankLineLite): BankRule | null {
  let best: BankRule | null = null;
  let bestScore = -Infinity;
  for (const r of rules) {
    if (!ruleMatches(r, line)) continue;
    const tokenCount = (r.reference || '').split(/\s+/).filter(Boolean).length;
    const rangeBonus = (r.min_amount != null ? 1 : 0) + (r.max_amount != null ? 1 : 0);
    const score = r.priority * 1000 + tokenCount * 10 + rangeBonus;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

export async function loadBankRules(): Promise<BankRule[]> {
  const { data } = await supabase
    .from('bank_rules')
    .select('*')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true });
  return ((data ?? []) as unknown) as BankRule[];
}

/**
 * Apply rules to a set of bank lines.
 * - Only fills lines without an existing allocation (manual ones are preserved).
 * - Returns a list of allocations to upsert: { bank_line_id, recon_type, target_name }.
 */
export interface PendingAllocation {
  bank_line_id: string;
  recon_type: string;
  target_name: string;
}

export function computeAllocationsFromRules(
  lines: BankLineLite[],
  rules: BankRule[],
  alreadyAllocatedLineIds: Set<string>,
): PendingAllocation[] {
  const out: PendingAllocation[] = [];
  for (const line of lines) {
    if (alreadyAllocatedLineIds.has(line.id)) continue;
    const rule = findBestRule(rules, line);
    if (!rule) continue;
    out.push({
      bank_line_id: line.id,
      recon_type: rule.recon_type,
      target_name: rule.target_name,
    });
  }
  return out;
}