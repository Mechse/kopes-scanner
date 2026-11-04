import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Suggestion, Target } from '../lib/model';
import type { Config } from './config';
import type { Store } from './store';
import { snapshotHost } from './host';
import { garageSourceInventory } from './garage-release';
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
    let note = target.kind === 'host' ? 'Apply host package updates using your distribution package manager.' : 'No current findings to reduce.';
    if (target.kind === 'image' && report.findings.length) {
      try {
        const discovered = await discoverCandidates(target.name);
        note = discovered.note;
        for (const candidate of discovered.candidates) {
          try {
            const candidateSbom = join(work, 'candidate.json');
            await runTrivy(config, ['image', '--image-src', 'remote', '--platform', platform!, '--format', 'cyclonedx', '--output', candidateSbom, candidate.reference], signal);
            const candidateReport = await matchSbom(config, candidateSbom, join(work, 'candidate-report.json'), signal);
            if (candidateReport.eol || !candidateReport.packages.length || (report.os && !candidateReport.os)) {
              note += ` ${candidate.tag}: insufficient or end-of-life package coverage; no recommendation.`;
              continue;
            }
            const comparison = compareReports(report, candidateReport);
            if (comparison.removed) suggestions.push({ ...candidate, platform: platform!, ...comparison, checkedAt: Date.now() });
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
    store.complete(target.id, report, sbom, platform, suggestions, note);
  } finally { await rm(work, { recursive: true, force: true }); }
}
