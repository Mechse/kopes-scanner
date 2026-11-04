import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { severities, type Finding, type Package, type Report } from '../lib/model';
import type { Config } from './config';

const exec = promisify(execFile);
export async function runTrivy(config: Config, args: string[], signal?: AbortSignal) {
  await exec(config.trivy, [...args, '--cache-dir', join(config.dataDir, 'trivy'), '--timeout', '10m', '--quiet', '--no-progress'], {
    timeout: 11 * 60_000, maxBuffer: 2 * 1024 * 1024, signal,
    env: { PATH: process.env.PATH, HOME: config.dataDir, TMPDIR: process.env.TMPDIR ?? '/tmp', DOCKER_CONFIG: join(config.dataDir, 'docker-anonymous') },
  });
}
export async function readOutput(path: string) {
  if ((await stat(path)).size > 64 * 1024 * 1024) throw new Error('Scanner output exceeded 64 MiB.');
  return readFile(path, 'utf8');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid scan report.');
  return value as Record<string, unknown>;
}
function text(value: unknown) { return typeof value === 'string' ? value : ''; }
export function parseReport(raw: string): Report {
  const input = record(JSON.parse(raw));
  if (input.SchemaVersion !== 2 || !Array.isArray(input.Results)) throw new Error('Unsupported or empty scan report; refusing to mark this target clean.');
  const findings: Finding[] = [];
  const packages: Package[] = [];
  const seen = new Set<string>();
  for (const item of input.Results) {
    const result = record(item);
    const type = text(result.Type), path = text(result.Target);
    if (result.Packages !== undefined && !Array.isArray(result.Packages)) throw new Error('Invalid package inventory.');
    if (result.Vulnerabilities !== undefined && !Array.isArray(result.Vulnerabilities)) throw new Error('Invalid vulnerability list.');
    for (const value of (result.Packages ?? []) as unknown[]) {
      const pkg = record(value);
      if (!text(pkg.Name) || !text(pkg.Version)) throw new Error('Invalid package entry.');
      packages.push({ name: text(pkg.Name), version: text(pkg.Version), type, path });
    }
    for (const value of (result.Vulnerabilities ?? []) as unknown[]) {
      const v = record(value);
      if (!text(v.VulnerabilityID) || !text(v.PkgName)) throw new Error('Invalid vulnerability entry.');
      const finding: Finding = { id: text(v.VulnerabilityID), package: text(v.PkgName), installed: text(v.InstalledVersion), fixed: text(v.FixedVersion),
        severity: severities.find(s => s === v.Severity) ?? 'UNKNOWN', title: text(v.Title), type, path };
      const key = JSON.stringify([finding.id, finding.package, finding.installed, type, path]);
      if (!seen.has(key)) { findings.push(finding); seen.add(key); }
    }
  }
  const meta = input.Metadata ? record(input.Metadata) : {};
  const os = meta.OS ? record(meta.OS) : {};
  findings.sort((a, b) => severities.indexOf(a.severity) - severities.indexOf(b.severity) || a.package.localeCompare(b.package));
  return { findings, packages, os: [text(os.Family), text(os.Name)].filter(Boolean).join(' '), eol: os.EOSL === true };
}
export class NoPackageCoverage extends Error {
  constructor() {
    super('The image inventory contains no identifiable packages. Vulnerability coverage is unknown. An image with dependency metadata or a build-generated package inventory is needed to assess its dependencies.');
  }
}

export function hasEmptyImageInventory(raw: string) {
  const bom = JSON.parse(raw);
  return bom?.bomFormat === 'CycloneDX' && bom.metadata?.component?.type === 'container' &&
    Array.isArray(bom.components) && bom.components.length === 0;
}
export async function matchSbom(config: Config, sbomPath: string, output: string, signal?: AbortSignal) {
  await runTrivy(config, ['sbom', '--scanners', 'vuln', '--list-all-pkgs', '--format', 'json', '--output', output, sbomPath], signal);
  return parseReport(await readOutput(output));
}
// Compare advisory/package pairs, not versions or layer paths, which naturally change during an upgrade.
export function compareReports(current: Report, candidate: Report) {
  const key = (v: Finding) => JSON.stringify([v.id, v.package, v.type]);
  const before = new Set(current.findings.map(key)), after = new Set(candidate.findings.map(key));
  return { removed: [...before].filter(k => !after.has(k)).length, introduced: [...after].filter(k => !before.has(k)).length, remaining: after.size };
}
