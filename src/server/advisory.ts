import { isCve, safeUrl, type Advisory } from '../lib/advisory';

const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 30000) : '';
const english = (value: unknown) => list(value).map(obj).filter(v => /^en(?:-|$)/i.test(text(v.lang))).map(v => text(v.value)).filter(Boolean);
export function parseAdvisory(raw: unknown, id: string, now = Date.now()): Advisory {
  const data = obj(raw), meta = obj(data.cveMetadata), cna = obj(obj(data.containers).cna);
  if (meta.cveId !== id || !['PUBLISHED', 'REJECTED'].includes(text(meta.state))) throw new Error('Invalid CVE record.');
  const base: Advisory = { status: meta.state === 'REJECTED' ? 'rejected' : 'available', source: `https://www.cve.org/CVERecord?id=${id}`, fetchedAt: now, weaknesses: [], solutions: [], workarounds: [], references: [] };
  if (base.status === 'rejected') return { ...base, description: english(cna.rejectedReasons).join('\n\n') };
  const metric = list(cna.metrics).map(obj).flatMap(m => [m.cvssV4_0, m.cvssV3_1, m.cvssV3_0]).map(obj).find(m => text(m.vectorString));
  return { ...base, publisher: text(obj(cna.providerMetadata).shortName), description: english(cna.descriptions).join('\n\n'),
    published: text(meta.datePublished), modified: text(meta.dateUpdated), vector: text(metric?.vectorString),
    weaknesses: list(cna.problemTypes).flatMap(p => list(obj(p).descriptions)).map(obj).filter(p => /^en(?:-|$)/i.test(text(p.lang))).map(p => [text(p.cweId), text(p.description)].filter(Boolean).join(' · ')),
    solutions: english(cna.solutions), workarounds: english(cna.workarounds),
    references: [...new Set(list(cna.references).map(r => obj(r).url).filter(safeUrl))].slice(0, 60),
  };
}

// Only the public CVE identifier leaves the server. Never follow URLs in a report.
export function createAdvisoryLookup(fetcher: typeof fetch = fetch, now = Date.now) {
  const cache = new Map<string, { expires: number; value: Advisory }>();
  const pending = new Map<string, Promise<Advisory>>();
  return async (id: string): Promise<Advisory> => {
    if (!isCve(id)) throw new Error('Invalid CVE identifier.');
    const cached = cache.get(id);
    if (cached && cached.expires > now()) return cached.value;
    const existing = pending.get(id);
    if (existing) return existing;
    const empty = (status: Advisory['status']): Advisory => ({ status, source: `https://www.cve.org/CVERecord?id=${id}`, fetchedAt: now(), weaknesses: [], solutions: [], workarounds: [], references: [] });
    if (pending.size >= 12) return empty('unavailable');
    const request = (async () => {
      let value: Advisory;
      try {
        const response = await fetcher(`https://cveawg.mitre.org/api/cve/${id}`, { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { Accept: 'application/json' } });
        if (response.status === 404) value = empty('not-found');
        else {
          if (!response.ok || !response.body) throw new Error('CVE source unavailable.');
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = []; let size = 0;
          try {
            while (true) {
              const chunk = await reader.read(); if (chunk.done) break;
              size += chunk.value.length;
              if (size > 2 * 1024 * 1024) throw new Error('CVE record too large.');
              chunks.push(chunk.value);
            }
          } finally { await reader.cancel().catch(() => {}); }
          value = parseAdvisory(JSON.parse(Buffer.concat(chunks).toString('utf8')), id, now());
        }
      } catch { value = empty('unavailable'); }
      if (cache.size >= 300) cache.delete(cache.keys().next().value!);
      cache.set(id, { value, expires: now() + (value.status === 'unavailable' ? 60_000 : 3_600_000) });
      return value;
    })();
    pending.set(id, request);
    try { return await request; } finally { pending.delete(id); }
  };
}
export const lookupAdvisory = createAdvisoryLookup();
