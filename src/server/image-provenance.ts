import { createHash } from 'node:crypto';
import { boundedFetch, publicImage, registryAuthorization } from './registry';

export type ProvenanceBase = { name: string; digest: string };
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const slsa = (value: unknown) => typeof value === 'string' && /^https:\/\/slsa.dev\/provenance\/v(?:0\.2|1)$/.test(value);

type Statement = { predicateType?: string; subject?: { digest?: { sha256?: string } }[]; predicate?: { materials?: Material[]; buildDefinition?: { resolvedDependencies?: Material[] } } };
type Material = { uri?: string; digest?: { sha256?: string } };
export function provenanceBases(statement: Statement, subject: string): ProvenanceBase[] {
  if (!slsa(statement.predicateType) || !Array.isArray(statement.subject) || !statement.subject.some(item => `sha256:${item.digest?.sha256}` === subject)) return [];
  const materials = statement.predicate?.buildDefinition?.resolvedDependencies ?? statement.predicate?.materials ?? [];
  if (!Array.isArray(materials)) return [];
  const bases = new Map<string, ProvenanceBase>();
  for (const material of materials) {
    const digest = `sha256:${material.digest?.sha256}`;
    if (!digestPattern.test(digest) || typeof material.uri !== 'string' || !material.uri.startsWith('pkg:docker/')) continue;
    try {
      const value = decodeURIComponent(material.uri.slice('pkg:docker/'.length).split('?')[0]);
      const at = value.lastIndexOf('@');
      const name = at < 0 ? value : `${value.slice(0, at)}:${value.slice(at + 1)}`;
      if (publicImage(name)) bases.set(digest, { name, digest });
    } catch { /* Ignore unsupported package URLs. */ }
  }
  return [...bases.values()].slice(0, 12);
}

type Descriptor = { digest: string; mediaType?: string; annotations?: Record<string, string>; platform?: { os?: string; architecture?: string; variant?: string } };
type Manifest = { manifests?: Descriptor[]; layers?: Descriptor[]; subject?: { digest?: string } };

/** Read only attestations attached to the installed immutable image and platform.
 * Provenance supplies candidates; matching filesystem layers remain mandatory.
 */
export async function imageProvenance(reference: string, platform: string, signal: AbortSignal, currentTag?: string): Promise<ProvenanceBase[]> {
  const [name, digest] = reference.split('@');
  const image = publicImage(name);
  if (!image || !digestPattern.test(digest ?? '')) return [];
  signal.throwIfAborted();
  const scope = encodeURIComponent(`repository:${image.repository}:pull`);
  const tokenUrl = image.registry === 'ghcr.io' ? `https://ghcr.io/token?service=ghcr.io&scope=${scope}` : `https://auth.docker.io/token?service=registry.docker.io&scope=${scope}`;
  let authorization = registryAuthorization(image.registry);
  if (['ghcr.io', 'registry-1.docker.io'].includes(image.registry)) {
    const token = JSON.parse((await boundedFetch(tokenUrl, authorization ? { Authorization: authorization } : {}, signal)).body);
    const bearer = token.token ?? token.access_token;
    if (typeof bearer !== 'string') throw new Error('Authentication required.');
    authorization = `Bearer ${bearer}`;
  }
  const headers = { ...(authorization ? { Authorization: authorization } : {}), Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' };
  async function get<T>(kind: 'manifests' | 'blobs', id: string): Promise<T> {
    if (!digestPattern.test(id)) throw new Error('Invalid attestation digest.');
    const { body } = await boundedFetch(`https://${image!.registry}/v2/${image!.repository}/${kind}/${id}`, headers, signal, kind === 'blobs');
    if (`sha256:${createHash('sha256').update(body).digest('hex')}` !== id) throw new Error('Attestation digest mismatch.');
    return JSON.parse(body);
  }
  const index = await get<Manifest>('manifests', digest);
  const [os, architecture, variant] = platform.split('/');
  const target = index.manifests?.find(item => item.platform?.os === os && item.platform.architecture === architecture && (!variant || item.platform.variant === variant));
  if (index.manifests && !target) return [];
  const subject = target?.digest ?? digest;
  let attached: Descriptor[] = [];
  try {
    attached = JSON.parse((await boundedFetch(`https://${image.registry}/v2/${image.repository}/referrers/${subject}`, headers, signal)).body).manifests ?? [];
  } catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof Error) || !/HTTP 404/.test(error.message)) throw error;
    try {
      attached = JSON.parse((await boundedFetch(`https://${image.registry}/v2/${image.repository}/manifests/${subject.replace(':', '-')}`, headers, signal)).body).manifests ?? [];
    } catch (fallback) {
      signal.throwIfAborted();
      if (!(fallback instanceof Error) || !/HTTP 404/.test(fallback.message)) throw fallback;
    }
  }
  if (!Array.isArray(attached)) throw new Error('Invalid referrers response.');

  const bases = new Map<string, ProvenanceBase>();
  for (const descriptor of [...(index.manifests ?? []).filter(item => item.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest' && item.annotations['vnd.docker.reference.digest'] === subject), ...attached].slice(0, 4)) {
    const manifest = await get<Manifest>('manifests', descriptor.digest);
    if (manifest.subject && manifest.subject.digest !== subject) continue;
    for (const layer of (manifest.layers ?? []).filter(layer => layer.mediaType === 'application/vnd.in-toto+json' && (!layer.annotations?.['in-toto.io/predicate-type'] || slsa(layer.annotations['in-toto.io/predicate-type']))).slice(0, 2)) {
      for (const base of provenanceBases(await get<Statement>('blobs', layer.digest), subject)) bases.set(base.digest, base);
    }
  }
  return [...bases.values()].slice(0, 12);
}
