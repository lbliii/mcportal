/** Literal identifier boundaries shared by Recall's metadata and clip indexes. */
export function isExactTerm(term: string): boolean {
  return /[\d_./+%=-]/u.test(term);
}

export function exactTermPattern(term: string, postgres = false): string {
  const letters = postgres ? '[:alnum:]' : '\\p{L}\\p{N}';
  const literal = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A terminal sentence period/hyphen is punctuation; .1 or -beta continues a
  // version/identifier. Slashes separate path components, so basenames can match.
  return `(^|[^${letters}_.-])${literal}($|[^${letters}_.-]|[.-]($|[^${letters}_]))`;
}

export function matchesTerm(text: string, term: string): boolean {
  return isExactTerm(term) ? new RegExp(exactTermPattern(term), 'u').test(text.toLowerCase()) : text.toLowerCase().includes(term);
}

/** Remove only an explicit search-request prefix; quoted/literal wording stays meaningful. */
export function recallWords(query: string): string {
  const literal = query.trim().replace(/^["“”]+|["“”]+$/g, '').replace(/[?!,;:]+$/g, '').trim();
  if (/^["“”]/.test(query.trim())) return literal || query;
  const request = /^(?:please\s+)?(?:where\s+(?:did|have)\s+i\s+(?:read|save|keep|see)|(?:(?:can|could|would)\s+you\s+)?(?:find|show|retrieve)(?:\s+me)?)(?:\s+(?:my|the|a|an|saved|kept|article|page|note|quote|passage|about|on|for|with))*\s+/i;
  return literal.replace(request, '').trim() || literal || query;
}
