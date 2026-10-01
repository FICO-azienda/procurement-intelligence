/** String similarity helpers used by supplier and product matching. */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 1 = identical, 0 = nothing in common. */
export function ratio(a: string, b: string): number {
  if (!a && !b) return 1;
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

/** Two words are "the same" if equal, one extends the other (paraffin/paraffina), or ≥ 0.8 similar. */
function wordScore(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.9;
  const r = ratio(a, b);
  return r >= 0.8 ? r : 0;
}

const isNumber = (t: string) => /^\d+$/.test(t);

/**
 * Token similarity for product names. Numbers carry the specification
 * (58/60, 300 ml, 120 mm): if both texts have numbers and they differ, the
 * products are different, however similar the words.
 */
export function tokenSimilarity(docTokens: string[], refTokens: string[]): number {
  if (!docTokens.length || !refTokens.length) return 0;
  const docNums = docTokens.filter(isNumber);
  const refNums = refTokens.filter(isNumber);
  if (docNums.length && refNums.length) {
    const same = refNums.every((n) => docNums.includes(n)) || docNums.every((n) => refNums.includes(n));
    if (!same) return 0;
  }

  // Greedy best-pair matching of reference tokens against document tokens.
  const used = new Set<number>();
  let matched = 0;
  for (const r of refTokens) {
    let best = 0;
    let bestIdx = -1;
    docTokens.forEach((d, i) => {
      if (used.has(i)) return;
      const s = isNumber(r) || isNumber(d) ? (r === d ? 1 : 0) : wordScore(d, r);
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0) {
      used.add(bestIdx);
      matched += best;
    }
  }
  const containment = matched / refTokens.length; // how much of our product name is in the document
  const dice = (2 * matched) / (refTokens.length + docTokens.length);
  const words = refTokens.filter((t) => !isNumber(t)).length;
  // A match made only of numbers is not a match.
  if (words > 0 && matched - refNums.length <= 0) return 0;
  return 0.6 * containment + 0.4 * dice;
}
