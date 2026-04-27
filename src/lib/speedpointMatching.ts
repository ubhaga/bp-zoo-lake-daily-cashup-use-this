const GENERIC_TERMINAL_WORDS = new Set(['EFT', 'CREDIT', 'CARD', 'TERM', 'TERMINAL']);

function normalizeLabel(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function getWordTokens(value: string): string[] {
  return normalizeLabel(value)
    .split(' ')
    .filter(token => token && !/^\d+$/.test(token) && !GENERIC_TERMINAL_WORDS.has(token));
}

export function extractTerminalNumber(value: string): string {
  return value.match(/(\d{6})/)?.[1] ?? '';
}

export function getCanonicalSpeedpointTerminal(terminal: string, knownTerminals: string[]): string {
  if (!terminal) return '';
  if (knownTerminals.includes(terminal)) return terminal;

  const normalizedTerminal = normalizeLabel(terminal);
  const normalizedExactMatch = knownTerminals.find(candidate => normalizeLabel(candidate) === normalizedTerminal);
  if (normalizedExactMatch) return normalizedExactMatch;

  const terminalNumber = extractTerminalNumber(terminal);
  const numberedCandidates = terminalNumber
    ? knownTerminals.filter(candidate => extractTerminalNumber(candidate) === terminalNumber)
    : [];
  const candidates = numberedCandidates.length > 0 ? numberedCandidates : knownTerminals;

  if (candidates.length === 1) return candidates[0];

  const inputTokens = getWordTokens(terminal);
  const scored = candidates
    .map(candidate => {
      const candidateTokens = getWordTokens(candidate);
      const overlap = inputTokens.filter(token => candidateTokens.includes(token)).length;
      const containsBoost = normalizeLabel(candidate).includes(normalizedTerminal) ? 1 : 0;
      return { candidate, score: overlap * 10 + containsBoost };
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return terminal;
  if (scored[0].score === 0) return terminal;
  if (scored.length > 1 && scored[0].score === scored[1].score) return terminal;
  return scored[0].candidate;
}