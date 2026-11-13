import { severities, type Finding } from './model';
export const origins = ['Base image', 'Added tooling', 'Added OS dependencies', 'Application dependencies', 'Unknown'] as const;
export type Origin = typeof origins[number];
export type OriginEvidence = { category: Origin; explanation: string; layer?: string; command?: string; baseName?: string; baseDigest?: string };
export const unknownOrigin: OriginEvidence = { category: 'Unknown', explanation: 'This scan has no sufficient image-layer or build evidence to identify where this package was introduced. Package ecosystem alone does not establish origin.' };
export const originOf = (finding: Finding) => finding.origin ?? unknownOrigin;
export function originSummary(findings: Finding[]) {
  const unique = [...new Map(findings.map(f => [JSON.stringify([f.id, f.package, f.installed, f.type, f.path]), f])).values()];
  return origins.map(category => {
    const rows = unique.filter(f => originOf(f).category === category);
    return { category, count: rows.length, fixable: rows.filter(f => !!f.fixed).length, counts: Object.fromEntries(severities.map(s => [s, rows.filter(f => f.severity === s).length])) };
  });
}
export function attributeOrigin(finding: Finding, evidence: { layers: string[]; baseLayers?: string[]; baseName?: string; baseDigest?: string; commands: Record<string, string>; applicationRoots?: Record<string, string> }): OriginEvidence {
  const layer = finding.layer;
  if (!layer || !evidence.layers.includes(layer)) return unknownOrigin;
  const base = evidence.baseLayers;
  const verifiedBase = !!base?.length && base.every((l, i) => evidence.layers[i] === l);
  if (verifiedBase && base!.includes(layer)) return { category: 'Base image', layer, baseName: evidence.baseName, baseDigest: evidence.baseDigest, explanation: 'The package layer belongs to the verified layer prefix of the declared base image.' };
  const command = evidence.commands[layer];
  const commands = literalBuildCommands(command);
  if (verifiedBase && !base!.includes(layer) && finding.type === 'debian' && commands.some(isAptInstall)) {
    return { category: 'Added OS dependencies', layer, command, baseDigest: evidence.baseDigest,
      explanation: 'This OS package was introduced above the verified base-image layers in a build step that explicitly installs Debian packages. It may be a requested package or an automatically installed dependency; the exact dependency chain is not established.' };
  }
  // Only parse simple literal commands; quoted text and shell substitutions are not evidence.
  const installs = commands.filter(tokens => tokens[0] === 'npm' && ['install', 'i'].includes(tokens[1]) && tokens.some(t => t === '-g' || t === '--global') && !tokens.slice(2).some(t => t.startsWith('-') && !['-g', '--global'].includes(t)));
  const packagePath = finding.path.replace(/^\//, '');
  for (const tokens of installs) {
    const tools = tokens.slice(2).filter(t => /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+(?:@[^@\s]+)?$/i.test(t) && !t.startsWith('-')).map(t => t.replace(/@[^@/]+$/, ''));
    if (tools.some(tool => finding.package === tool || ['npm', 'node-pkg'].includes(finding.type) && packagePath.startsWith(`usr/local/lib/node_modules/${tool}/`))) {
      return { category: 'Added tooling', layer, command, explanation: 'The introducing layer explicitly installs this global tool; the package is the tool itself or is bundled beneath its installation directory.' };
    }
  }
  if (command && finding.type === 'gobinary') {
    const copy = /^COPY (\/usr\/local\/bin\/[^\s]+) (\/usr\/local\/bin\/[^\s]+)(?: # buildkit)?$/.exec(command);
    if (copy && packagePath === copy[2].slice(1)) return { category: 'Added tooling', layer, command, explanation: 'Build history copies this executable into /usr/local/bin in the package’s introducing layer.' };
  }
  const root = evidence.applicationRoots?.[layer]?.replace(/^\//, '');
  if (root && ['npm', 'node-pkg'].includes(finding.type) && finding.path.replace(/^\//, '').startsWith(`${root}/node_modules/`)) return {
    category: 'Application dependencies', layer, command, explanation: 'Build history installs dependencies in an explicit application working directory; the package path and introducing layer match that installation.'
  };
  return { ...unknownOrigin, layer, ...(command && { command }) };
}

/** Conservative subset of Docker RUN history, never an evaluator of shell code. */
export function literalBuildCommands(command: string | undefined): string[][] {
  if (!command) return [];
  const body = command.replace(/^RUN /, '').replace(/^\/bin\/sh -c /, '').replace(/ # buildkit$/, '');
  if (/[#"'`$\\|();<>\n\r]/.test(body) || /&/.test(body.replaceAll('&&', ''))) return [];
  return body.split('&&').map(part => part.trim().split(/\s+/));
}

/** Only real installs with literal package names and known non-simulating flags qualify. */
function isAptInstall(tokens: string[]): boolean {
  if (!['apt', 'apt-get'].includes(tokens[0])) return false;
  const flags = new Set(['-y', '--yes', '--assume-yes', '-q', '-qq', '--quiet', '--no-install-recommends', '--no-install-suggests']);
  const args = tokens.slice(1).filter(token => !flags.has(token));
  return args[0] === 'install' && args.length > 1 && args.slice(1).every(token =>
    /^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9-]+)?(?:=[a-z0-9.+:~_-]+)?$/.test(token) && !token.endsWith('-'));
}
