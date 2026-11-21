import { sourceDockerfileCandidates } from './dockerfile-evidence';
import { imageProvenance } from './image-provenance';
import { comparisonLimitation } from '../lib/image-improvement';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Suggestion, Target } from '../lib/model';
import type { Config } from './config';
import type { Store } from './store';
import { snapshotHost } from './host';
import { garageSourceInventory } from './garage-release';
import { attributeReport } from './image-evidence';
import { discoverBaseImages, discoveryFailure } from './base-images';
import { parseReport } from './trivy';
import { imagePlatform, localImages } from './docker';
import { discoverCandidates, registryIdentity } from './registry';
import { compareReports, hasEmptyImageInventory, NoPackageCoverage, matchSbom, readOutput, runTrivy } from './trivy';

export async function scanTarget(config: Config, store: Store, target: Target, signal: AbortSignal) {
  const work = await mkdtemp(join(config.dataDir, 'scan-'));
  try {
    const sbomPath = join(work, 'sbom.json');
    let platform: string | null = null;
    let sourceInventory: string | null = null;
    if (target.kind === 'image') {
      platform = await imagePlatform(config.docker, target.image_id!);
      sourceInventory = garageSourceInventory(target.image_id!, platform);
      const previous = sourceInventory ?? store.sbom(target.id);
      if (previous) await writeFile(sbomPath, previous, { mode: 0o600 });
      else await runTrivy(config, ['image', '--image-src', 'docker', '--docker-host', config.docker.replace('http:', 'tcp:'), '--format', 'cyclonedx', '--output', sbomPath, target.image_id!], signal);
    } else {
      const root = join(work, 'host');
      await mkdir(root);
      await snapshotHost(config.hostRoot, root);
      await runTrivy(config, ['rootfs', '--pkg-types', 'os', '--format', 'cyclonedx', '--output', sbomPath, root], signal);
    }
    const sbom = await readOutput(sbomPath);
    if (target.kind === 'image' && hasEmptyImageInventory(sbom)) throw new NoPackageCoverage();
    const report = await matchSbom(config, sbomPath, join(work, 'report.json'), signal);
    if (sourceInventory) {
      const expected = JSON.parse(sourceInventory).components.length;
      if (report.packages.length !== expected) throw new Error('The matcher did not recognize the full release-source inventory.');
      report.coverage = 'release-source';
      report.ancestry = { state: 'incomplete', reasons: ['source-only'], checkedAt: Date.now() };
      signal.throwIfAborted();
      store.complete(target.id, report, sbom, platform, [], '');
      return;
    }
    if (target.kind === 'host' && (!report.os || !report.packages.length)) throw new Error('Host OS packages were not recognized; this is not a clean scan.');
    const suggestions: Suggestion[] = [];
    let baseline = report, recommendationReference = target.name, baseComparison = false;
    let provenanceNote = '';
    let baselineDigests: string[] = [];
    let baselineImageId = target.image_id;
    if (target.kind === 'image') {
      try {
        const imageJson = join(work, 'image-evidence.json');
        await runTrivy(config, ['image', '--image-src', 'docker', '--docker-host', config.docker.replace('http:', 'tcp:'), '--list-all-pkgs', '--format', 'json', '--output', imageJson, target.image_id!], signal);
        const raw = await readOutput(imageJson);
        baselineDigests = (JSON.parse(raw).Metadata?.RepoDigests ?? []).map((ref: string) => ref.split('@')[1]).filter(Boolean);
        const direct = parseReport(raw);
        // The direct image scan retains occurrence paths and layers that SBOM matching loses.
        Object.assign(report, direct);
        attributeReport(report, raw);
        const local = await localImages(config.docker, signal).catch(() => {
          signal.throwIfAborted();
          return { images: [], note: 'Local image discovery unavailable. Base images without labels may be missing.' };
        });
        let sequence = 0;
        const discoveryReasons: import('../lib/model').AncestryReason[] = [];
        const ancestry = await discoverBaseImages(raw, local.images, async (reference, source) => {
          const cached = store.cachedImage(reference, platform!);
          if (cached) return cached;
          const path = join(work, `base-${sequence++}.json`);
          const inventory = store.cachedImage(reference, platform!, true);
          if (inventory) {
            // Immutable inventory survives registry deletion; update advisories independently.
            await writeFile(path, inventory, { mode: 0o600 });
            const baseSbom = path + '.cdx';
            await runTrivy(config, ['convert', '--format', 'cyclonedx', '--output', baseSbom, path], signal);
            const refreshed = await matchSbom(config, baseSbom, path + '.assessment', signal);
            const cachedRaw = JSON.parse(inventory);
            cachedRaw.KopesReport = refreshed;
            cachedRaw.KopesAssessedAt = Date.now();
            const output = JSON.stringify(cachedRaw);
            store.cacheImage(reference, platform!, output);
            return output;
          }
          await runTrivy(config, ['image', '--image-src', source, ...(source === 'docker' ? ['--docker-host', config.docker.replace('http:', 'tcp:')] : ['--platform', platform!]), '--list-all-pkgs', '--format', 'json', '--output', path, reference], signal);
          const scanned = JSON.parse(await readOutput(path));
          if (source === 'remote') {
            try { scanned.KopesIdentity = await registryIdentity(reference, platform!, signal); }
            catch { signal.throwIfAborted(); /* Unknown digest kind stays unknown. */ }
          }
          scanned.KopesAssessedAt = Date.now();
          const output = JSON.stringify(scanned);
          store.cacheImage(reference, platform!, output);
          return output;
        }, signal, async imageRaw => {
          const refs: string[] = JSON.parse(imageRaw).Metadata?.RepoDigests ?? [];
          const reference = refs[0];
          const source = await sourceDockerfileCandidates(imageRaw, signal);
          report.buildOnlyImages = [...(report.buildOnlyImages ?? []), ...source.filter(base => base.role === 'build-only')];
          const dockerfile = source.filter(base => base.role === 'runtime').map(base => ({ ...base, source: 'dockerfile' as const }));
          // Source candidates remain available even when the registry has no provenance.
          try { return [...dockerfile, ...(reference ? await imageProvenance(reference, platform!, signal) : [])]; }
          catch (error) { if (!dockerfile.length) throw error; signal.throwIfAborted(); discoveryReasons.push(discoveryFailure(error)); return dockerfile; }
        });
        attributeReport(report, raw, ancestry.direct?.raw);
        report.baseImages = ancestry.bases;
        report.ancestry = { ...ancestry.coverage, reasons: [...new Set([...ancestry.coverage.reasons, ...discoveryReasons])] };
        report.baseDiscoveryNote = [local.note, ancestry.note, 'Discovery uses declared bases, published build provenance, and locally available images with matching layers. Missing metadata or images can leave gaps; discarded build stages are not included.'].filter(Boolean).join(' ');
        if (ancestry.direct) {
          baselineDigests = [ancestry.direct.digest];
          baselineImageId = JSON.parse(ancestry.direct.raw).Metadata?.ImageID ?? null;
          baseline = parseReport(ancestry.direct.raw);
          recommendationReference = ancestry.direct.name;
          baseComparison = true;
        }
      } catch {
        if (signal.aborted) throw new Error('Scan interrupted.');
        report.ancestry = { state: 'incomplete', reasons: ['missing-metadata'], checkedAt: Date.now() };
        provenanceNote = ' Image build evidence unavailable; unproven origins remain Unknown.';
      }
      if (!baseComparison) provenanceNote += ' Base-image comparison unavailable: supply OCI base name/digest labels and preserved image layers, then rescan. No base-image savings are claimed.';
    }
    let note = target.kind === 'host' ? 'Apply host package updates using your distribution package manager.' : 'No current findings to reduce.';
    if (target.kind === 'image' && report.findings.length) {
      try {
        const discovered = await discoverCandidates(recommendationReference);
        note = discovered.note;
        for (const candidate of discovered.candidates) {
          if (candidate.action === 'Rebuild' && (!baselineDigests.length || baselineDigests.includes(candidate.digest))) continue;
          try {
            const candidateSbom = join(work, 'candidate.json');
            await runTrivy(config, ['image', '--image-src', 'remote', '--platform', platform!, '--list-all-pkgs', '--format', 'json', '--output', candidateSbom, candidate.reference], signal);
            const candidateRaw = await readOutput(candidateSbom);
            const candidateReport = parseReport(candidateRaw);
            const limitation = comparisonLimitation(baseline, candidateReport, candidate.action, baselineImageId, JSON.parse(candidateRaw).Metadata?.ImageID);
            if (limitation) {
              note += ` ${candidate.tag}: ${limitation}`;
              continue;
            }
            const comparison = compareReports(baseline, candidateReport);
            if (comparison.removed) suggestions.push({ ...candidate, action: candidate.action, scope: baseComparison ? 'base-image' : 'image', baseline: recommendationReference, currentPackages: baseline.packages.length, candidatePackages: candidateReport.packages.length, currentOs: baseline.os, candidateOs: candidateReport.os, platform: platform!, ...comparison, checkedAt: Date.now() });
          } catch {
            if (signal.aborted) throw new Error('Scan interrupted.');
            note += ` ${candidate.tag}: scan failed; no verified recommendation.`;
          }
        }
        if (discovered.candidates.length && !suggestions.length) note += ' No verified reduction found.';
      } catch {
        if (signal.aborted) throw new Error('Scan interrupted.');
        note = 'Image recommendations unavailable: registry may be private, unreachable, or rate-limited. The installed-image scan succeeded.';
      }
    }
    signal.throwIfAborted();
    suggestions.sort((a, b) => (b.removed - b.introduced) - (a.removed - a.introduced));
    store.complete(target.id, report, sbom, platform, baseComparison ? suggestions.slice(0, 1) : suggestions, note + provenanceNote);
  } finally { await rm(work, { recursive: true, force: true }); }
}
