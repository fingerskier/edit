// Subsequence fuzzy matching (spec §6.4): a query matches a target when its
// characters appear in order. Matches score higher when they land on word
// boundaries (start of string, after a separator, or a camelCase hump) and when
// they run consecutively — the usual "smart" quick-open ranking. Pure + tiny.

export interface FuzzyMatch {
  /** Higher is a better match. */
  score: number;
  /** Indices in `target` (original casing) that the query matched, in order. */
  positions: number[];
}

const SEPARATORS = new Set(['/', '\\', '.', '_', '-', ' ', ':']);

function isUpper(ch: string): boolean { return ch >= 'A' && ch <= 'Z'; }
function isLower(ch: string): boolean { return ch >= 'a' && ch <= 'z'; }

/**
 * Score `target` against `query` (case-insensitive). Returns null when `query`
 * is not a subsequence of `target`. An empty query matches everything (score 0).
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  if (query.length === 0) return { score: 0, positions: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let qi = 0;
  let score = 0;
  let prev = -2;
  const positions: number[] = [];

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;

    let bonus = 1;
    if (ti === 0) {
      bonus += 8; // start of string
    } else {
      const before = target[ti - 1];
      if (SEPARATORS.has(before)) bonus += 6;                       // boundary after separator
      else if (isLower(before) && isUpper(target[ti])) bonus += 6;  // camelCase hump
    }
    if (ti === prev + 1) bonus += 4; // consecutive with the previous match

    score += bonus;
    positions.push(ti);
    prev = ti;
    qi++;
  }

  if (qi < q.length) return null; // ran out of target before matching all of query
  return { score, positions };
}

/**
 * Rank `items` by fuzzy score against `query`, dropping non-matches. Ties break
 * toward shorter labels (more relevant), then original order (stable). An empty
 * query returns every item in its original order.
 */
export function fuzzyRank<T>(query: string, items: T[], label: (item: T) => string): T[] {
  if (query.length === 0) return items.slice();
  return items
    .map((item, index) => {
      const text = label(item);
      return { item, index, len: text.length, match: fuzzyMatch(query, text) };
    })
    .filter((s): s is { item: T; index: number; len: number; match: FuzzyMatch } => s.match !== null)
    .sort((a, b) => b.match.score - a.match.score || a.len - b.len || a.index - b.index)
    .map((s) => s.item);
}
