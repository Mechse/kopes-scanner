import { createHash } from 'node:crypto';

export function publicImage(reference: string) {
  if (reference.includes('@') || reference.startsWith('sha256:')) return null;
  let name = reference;
  let registry = 'registry-1.docker.io';
  if (name.startsWith('ghcr.io/')) { registry = 'ghcr.io'; name = name.slice(8); }
  else {
    name = name.replace(/^(docker\.io|index\.docker\.io|registry-1\.docker\.io)\//, '');
    if (name.includes('/') && /[.:]|^localhost$/.test(name.split('/')[0])) return null;
  }
  const match = /^([a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*)(?::([\w][\w.-]{0,127}))?$/.exec(name);
  if (!match) return null;
  let repository = match[1];
  if (registry === 'registry-1.docker.io' && !repository.includes('/')) repository = `library/${repository}`;
  return { registry, repository, tag: match[2] ?? 'latest', name: `${registry === 'registry-1.docker.io' ? 'docker.io' : registry}/${repository}` };
}
function version(tag: string) {
  const m = /^(v?)(\d+)\.(\d+)(?:\.(\d+))?(-[a-z][a-z0-9.-]*)?$/.exec(tag);
  if (!m || /(?:^|-)(?:rc|alpha|beta|dev|preview)\d*/.test(m[5] ?? '')) return null;
  return { prefix: m[1], numbers: [Number(m[2]), Number(m[3]), Number(m[4] ?? 0)], precision: m[4] ? 3 : 2, suffix: m[5] ?? '' };
}
export function candidateTags(current: string, tags: string[]) {
  const base = version(current);
  if (!base) return [];
  const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return [...new Set(tags)].map(tag => ({ tag, v: version(tag) })).filter(({ v }) => v && v.prefix === base.prefix && v.precision === base.precision && v.suffix === base.suffix && v.numbers[0] === base.numbers[0] && compare(v.numbers, base.numbers) > 0)
    .sort((a, b) => compare(b.v!.numbers, a.v!.numbers)).slice(0, 2).map(x => x.tag);
}
async function boundedFetch(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Public registry returned HTTP ${response.status}; it may be private or rate-limited.`);
  if (!response.body) throw new Error('Empty registry response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4 * 1024 * 1024) throw new Error('Registry response exceeded 4 MiB.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return { response, body: Buffer.concat(chunks).toString('utf8') };
}
export async function discoverCandidates(reference: string) {
  const image = publicImage(reference);
  if (!image || !version(image.tag)) return { candidates: [], note: 'Not checked: requires a numeric stable tag on public Docker Hub or GHCR. Digest pins and moving tags are not guessed.' };
  const scope = encodeURIComponent(`repository:${image.repository}:pull`);
  const tokenUrl = image.registry === 'ghcr.io' ? `https://ghcr.io/token?service=ghcr.io&scope=${scope}` : `https://auth.docker.io/token?service=registry.docker.io&scope=${scope}`;
  const tokenData = JSON.parse((await boundedFetch(tokenUrl)).body) as { token?: string; access_token?: string };
  const token = tokenData.token ?? tokenData.access_token;
  if (typeof token !== 'string' || !token) throw new Error('Registry did not provide an anonymous pull token.');
  const headers = { Authorization: `Bearer ${token}` };
  // shortcut: bound registry listing work; add pagination when larger repositories need it.
  let tags: string[];
  if (image.registry === 'registry-1.docker.io') {
    const data = JSON.parse((await boundedFetch(`https://hub.docker.com/v2/repositories/${image.repository}/tags?page_size=100&ordering=last_updated`)).body) as { results?: { name: string }[] };
    if (!Array.isArray(data.results)) throw new Error('Invalid Docker Hub tag response.');
    tags = data.results.map(t => t.name).filter(t => typeof t === 'string');
  } else {
    const data = JSON.parse((await boundedFetch(`https://ghcr.io/v2/${image.repository}/tags/list?n=1000`, headers)).body) as { tags?: string[] };
    if (!Array.isArray(data.tags)) throw new Error('Invalid GHCR tag response.');
    tags = data.tags.filter(t => typeof t === 'string');
  }
  const candidates = [];
  for (const tag of candidateTags(image.tag, tags)) {
    const { body } = await boundedFetch(`https://${image.registry}/v2/${image.repository}/manifests/${encodeURIComponent(tag)}`, {
      ...headers, Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
    });
    const digest = `sha256:${createHash('sha256').update(body).digest('hex')}`;
    candidates.push({ tag, digest, reference: `${image.name}@${digest}` });
  }
  return { candidates, note: candidates.length ? 'Checked up to two newer tags in the same major version and tag variant. Compatibility is not verified.' : 'No comparable newer tags in the bounded registry listing (Docker Hub: latest 100 updated tags; GHCR: first 1,000).' };
}
