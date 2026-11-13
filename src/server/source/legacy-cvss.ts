import type { SourceFinding } from './analysis';

/** Public archival scores only: no repository contents or credentials leave the server. */
export async function enrichLegacyCvss(findings: SourceFinding[], fetcher: typeof fetch = fetch) {
  const groups = new Map<string, SourceFinding[]>();
  for (const finding of findings) {
    if (finding.cvss || !/^NSWG-ECO-[1-9]\d{0,6}$/.test(finding.advisory)) continue;
    const group = groups.get(finding.advisory);
    if (group) group.push(finding);
    else if (groups.size < 40) groups.set(finding.advisory, [finding]);
  }
  const pending = [...groups.entries()];
  const deadline = AbortSignal.timeout(20_000);
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (pending.length && !deadline.aborted) {
      const [advisory, occurrences] = pending.shift()!;
      const id = Number(advisory.slice('NSWG-ECO-'.length));
      const path = `nodejs/security-wg/main/vuln/npm/${id}.json`;
      try {
        const response = await fetcher(`https://raw.githubusercontent.com/${path}`, {
          redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(5000)]),
        });
        if (!response.ok || !response.body) continue;
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            size += chunk.value.length;
            if (size > 128 * 1024) throw new Error('Oversized advisory.');
            chunks.push(chunk.value);
          }
        } finally { await reader.cancel().catch(() => {}); }
        const record = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (record?.id !== id || typeof record.cvss_score !== 'number' || !Number.isFinite(record.cvss_score) || record.cvss_score < 0 || record.cvss_score > 10 ||
          typeof record.cvss_vector !== 'string' || record.cvss_vector.length > 4096 || !/^CVSS:3\.[01]\//.test(record.cvss_vector)) continue;
        for (const finding of occurrences) if (record.module_name === finding.package) {
          finding.cvss = { score: record.cvss_score, version: 3, vector: record.cvss_vector,
            source: `https://github.com/nodejs/security-wg/blob/main/vuln/npm/${id}.json` };
        }
      } catch { /* Optional enrichment must never prevent a scan from completing. */ }
    }
  }));
}
