function words(value: string): string[] {
  return value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu) ?? [];
}

// Allow one insertion, deletion, replacement, or adjacent transposition.
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length < b.length) return a.slice(i) === b.slice(i + 1);
  if (a.length > b.length) return a.slice(i + 1) === b.slice(i);
  return a.slice(i + 1) === b.slice(i + 1) ||
    (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
}

export function timelineMatcher(query: string) {
  const terms = words(query);
  return (fields: string[]) => {
    if (!terms.length) return true;
    const candidates = fields.flatMap(field => {
      const parts = words(field);
      return parts.length > 1 ? [...parts, parts.join('')] : parts;
    });
    return terms.every(term => candidates.some(candidate =>
      candidate.includes(term) ||
      (term.length >= 4 && !/\d/.test(term) && oneEditApart(term, candidate))
    ));
  };
}
