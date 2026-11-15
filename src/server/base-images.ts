import type { AncestryReason, BaseImage } from '../lib/model';
import { imageEvidence } from './image-evidence';
import { publicImage } from './registry';
import { parseReport } from './trivy';

export type LocalImage = { id: string; name?: string; layers: string[] };
const digestPattern = /^sha256:[a-f0-9]{64}$/;
export const layerPrefix = (base: string[], child: string[]) => base.length > 0 && base.every((layer, i) => child[i] === layer);

/** Shared layers establish filesystem inheritance, not the original FROM name. */
export async function discoverBaseImages(raw: string, local: LocalImage[], scan: (reference: string, source: 'docker' | 'remote') => Promise<string>, signal: AbortSignal, provenance?: (raw: string) => Promise<{ name: string; digest: string; source?: 'dockerfile' }[]>) {
  signal.throwIfAborted();
  const reasons = new Set<AncestryReason>(['missing-metadata']);
  const root = imageEvidence(raw);
  const bases: BaseImage[] = [];
  const visited = new Set<string>();
  const notes: string[] = [];
  const rootId = JSON.parse(raw).Metadata?.ImageID;
  if (rootId) visited.add(rootId);
  let attempts = 0;
  let direct: { raw: string; name: string; digest: string } | undefined;
  async function visit(parentRaw: string, depth: number) {
    const parent = imageEvidence(parentRaw);
    const declared = parent.baseDigest;
    const candidates: { name?: string; digest: string; source: 'declared' | 'local' | 'provenance' | 'dockerfile'; reference?: string; transport: 'docker' | 'remote' }[] = [];
    if (declared) {
      const name = parent.baseName?.split('@')[0];
      const publicBase = name && publicImage(name);
      candidates.push({ name, digest: declared, source: 'declared', reference: publicBase ? `${publicBase.name}@${declared}` : undefined, transport: 'remote' });
    }
    if (provenance && depth < 8 && bases.length < 12) {
      try {
        for (const base of await provenance(parentRaw)) {
          const image = publicImage(base.name);
          if (image && digestPattern.test(base.digest)) candidates.push({ ...base, source: base.source ?? 'provenance', reference: `${image.name}@${base.digest}`, transport: 'remote' });
        }
      } catch (error) {
        reasons.add(discoveryFailure(error));
        signal.throwIfAborted();
        notes.push('Build provenance could not be read for some images; ancestry may be incomplete.');
      }
    }
    // Strict prefixes exclude aliases and unrelated images with identical filesystems.
    for (const image of local.filter(image => image.layers.length < parent.layers.length && layerPrefix(image.layers, parent.layers)).sort((a, b) => b.layers.length - a.layers.length)) {
      candidates.push({ name: image.name, digest: image.id, source: 'local', reference: image.id, transport: 'docker' });
    }
    for (const candidate of candidates) {
      signal.throwIfAborted();
      if (visited.has(candidate.digest)) continue;
      if (attempts >= 12 || depth >= 8) { reasons.add('discovery-limit'); notes.push('Base-image discovery reached its scan limit; ancestry may be incomplete.'); return; }
      visited.add(candidate.digest);
      attempts++;
      const entry: BaseImage = { name: candidate.name, digest: candidate.digest, verified: false, source: candidate.source, parentDigest: JSON.parse(parentRaw).Metadata?.ImageID, depth };
      entry.discoveredAt = Date.now();
      entry.scanStatus = 'pending';
      entry.identity = candidate.source === 'local' ? { configId: candidate.digest } : {};
      entry.evidence = [{ kind: candidate.source === 'local' ? 'layer-match' : candidate.source === 'declared' ? 'declared-reference' : candidate.source === 'dockerfile' ? 'dockerfile-reference' : 'provenance-reference', authenticity: 'unverified', observedAt: entry.discoveredAt }];
      bases.push(entry);
      if (!candidate.reference) { reasons.add('authentication-required'); entry.scanStatus = 'unavailable'; entry.error = 'This declared base requires an accessible public Docker Hub or GHCR reference.'; continue; }
      try {
        const baseRaw = await scan(candidate.reference, candidate.transport);
        const metadata = JSON.parse(baseRaw).Metadata ?? {};
        entry.identity = { ...entry.identity, ...JSON.parse(baseRaw).KopesIdentity, configId: metadata.ImageID,
          platform: [metadata.ImageConfig?.os, metadata.ImageConfig?.architecture, metadata.ImageConfig?.variant].filter(Boolean).join('/') || undefined };
        entry.assessedAt = JSON.parse(baseRaw).KopesAssessedAt ?? Date.now();
        entry.scanStatus = 'scanned';
        const layers = imageEvidence(baseRaw).layers;
        entry.verified = layerPrefix(layers, parent.layers) && layerPrefix(layers, root.layers);
        if (!entry.verified && (candidate.source === 'provenance' || candidate.source === 'dockerfile')) { bases.splice(bases.indexOf(entry), 1); continue; }
        if (!entry.verified) { entry.scanStatus = 'unknown'; entry.error = 'The scanned image layers do not match the container ancestry.'; continue; }
        const imageId = JSON.parse(baseRaw).Metadata?.ImageID;
        if (typeof imageId === 'string') {
          const existing = bases.find(base => base !== entry && base.verified && base.identity?.configId === imageId);
          if (existing) { existing.evidence = [...(existing.evidence ?? []), ...(entry.evidence ?? [])]; bases.splice(bases.indexOf(entry), 1); continue; }
          visited.add(imageId);
        }
        entry.layers = layers;
        entry.report = JSON.parse(baseRaw).KopesReport ?? parseReport(baseRaw);
        if (!entry.report!.packages.length) { entry.report = undefined; entry.scanStatus = 'unknown'; entry.error = 'No identifiable packages; vulnerability coverage is unknown.'; }
        if (depth === 0 && candidate.source === 'declared' && entry.report && candidate.name) direct = { raw: baseRaw, name: candidate.name, digest: candidate.digest };
        await visit(baseRaw, depth + 1);
      } catch (error) {
        reasons.add(discoveryFailure(error));
        signal.throwIfAborted();
        entry.scanStatus = 'failed';
        entry.error = 'Base-image scan failed. The image may be unavailable or inaccessible.';
      }
    }
  }
  await visit(raw, 0);
  return { bases, direct, coverage: { state: 'incomplete' as const, reasons: [...reasons], checkedAt: Date.now() }, note: [...new Set(notes)].join(' ') };
}

export function localImage(value: unknown): LocalImage | undefined {
  const data = value as { Id?: string; RepoTags?: string[]; RootFS?: { Layers?: string[] } } | null;
  if (!data || !digestPattern.test(data.Id ?? '') || !Array.isArray(data.RootFS?.Layers) || !data.RootFS.Layers.every(layer => typeof layer === 'string' && digestPattern.test(layer))) return;
  return { id: data.Id!, name: data.RepoTags?.find(tag => tag !== '<none>:<none>'), layers: data.RootFS.Layers };
}

/** Only emit controlled reason codes; raw registry/scanner errors can contain secrets. */
export function discoveryFailure(error: unknown): AncestryReason {
  const message = error instanceof Error ? error.message : '';
  if (/\b(401|403)\b|unauthorized|authentication required/i.test(message)) return 'authentication-required';
  if (/\b404\b|manifest unknown|manifest_unknown/i.test(message)) return 'deleted-manifest';
  return 'registry-failure';
}
