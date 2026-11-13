import { comparisonLimitation } from '../lib/image-improvement';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Suggestion, Target } from '../lib/model';
import type { Config } from './config';
import type { Store } from './store';
import { snapshotHost } from './host';
import { garageSourceInventory } from './garage-release';
import { attributeReport, imageEvidence } from './image-evidence';
import { publicImage } from './registry';
import { parseReport } from './trivy';
import { imagePlatform } from './docker';
import { discoverCandidates } from './registry';
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
        const raw = await readOutput(imageJson), evidence = imageEvidence(raw);
        baselineDigests = (JSON.parse(raw).Metadata?.RepoDigests ?? []).map((ref: string) => ref.split('@')[1]).filter(Boolean);
        const direct = parseReport(raw);
        // The direct image scan retains occurrence paths and layers that SBOM matching loses.
        Object.assign(report, direct);
        attributeReport(report, raw);
        let baseRaw: string | undefined;
        const base = evidence.baseName && publicImage(evidence.baseName);
        if (base && evidence.baseDigest) {
          const basePath = join(work, 'base.json');
          await runTrivy(config, ['image', '--image-src', 'remote', '--platform', platform!, '--list-all-pkgs', '--format', 'json', '--output', basePath, `${base.name}@${evidence.baseDigest}`], signal);
          baseRaw = await readOutput(basePath);
          const layers = imageEvidence(baseRaw).layers;
          if (layers.length && layers.every((layer, i) => evidence.layers[i] === layer)) {
            baselineDigests = [evidence.baseDigest];
            baselineImageId = JSON.parse(baseRaw).Metadata?.ImageID ?? null;
            baseline = parseReport(baseRaw); recommendationReference = evidence.baseName!; baseComparison = true;
          }
        }
        attributeReport(report, raw, baseRaw);
      } catch {
        if (signal.aborted) throw new Error('Scan interrupted.');
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
    suggestions.sort((a, b) => (b.removed - b.introduced) - (a.removed - a.introduced));
    store.complete(target.id, report, sbom, platform, baseComparison ? suggestions.slice(0, 1) : suggestions, note + provenanceNote);
  } finally { await rm(work, { recursive: true, force: true }); }
}
