import type { Report } from '../lib/model';
import { attributeOrigin, literalBuildCommands } from '../lib/finding-origin';
export function imageEvidence(raw: string) {
  const metadata = JSON.parse(raw).Metadata ?? {};
  const config = metadata.ImageConfig ?? {};
  const layers: string[] = Array.isArray(config.rootfs?.diff_ids) ? config.rootfs.diff_ids.filter((s: unknown) => typeof s === 'string') : [];
  const commands: Record<string, string> = {};
  let index = 0;
  let workingDir = '';
  const applicationRoots: Record<string, string> = {};
  for (const item of config.history ?? []) {
    const workdir = /(?:^|#\(nop\)\s+)WORKDIR (\/[^\s]+)/.exec(item.created_by ?? '');
    if (workdir) workingDir = workdir[1].replace(/\/$/, '');
    if (item.empty_layer) continue;
    const layer = layers[index++];
    if (layer && typeof item.created_by === 'string') {
      commands[layer] = item.created_by;
      const commandsInLayer = literalBuildCommands(item.created_by);
      if (workingDir && commandsInLayer.some(tokens => tokens[0] === 'npm' && tokens[1] === 'ci' || tokens[0] === 'pnpm' && ['install', 'i'].includes(tokens[1])) &&
          !commandsInLayer.some(tokens => tokens[0] === 'cd' || tokens.some(t => /^(?:--prefix|--dir|--global|--lockfile-only|--ignore-scripts)(?:=|$)|^-(?:C|g)$/.test(t)))) applicationRoots[layer] = workingDir;
    }
  }
  const labels = config.config?.Labels ?? {};
  const cmd = config.config?.Cmd;
  const developmentCommand = Array.isArray(cmd) && /^(?:npm run|pnpm(?: run)?|yarn(?: run)?) (?:dev|develop|development)(?: |$)/.test(cmd.join(' ')) ? cmd.join(' ') : undefined;
  const baseName = labels['org.opencontainers.image.base.name'];
  const baseDigest = labels['org.opencontainers.image.base.digest'];
  return { layers, commands, applicationRoots, developmentCommand, baseName: typeof baseName === 'string' ? baseName : undefined, baseDigest: typeof baseDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(baseDigest) ? baseDigest : undefined };
}
export function attributeReport(report: Report, raw: string, baseRaw?: string) {
  const evidence = imageEvidence(raw);
  if (evidence.developmentCommand) report.imageContext = `Image metadata starts a development command (${evidence.developmentCommand}). Development tooling may account for additional findings; this does not establish the origin of individual packages.`;
  const baseLayers = baseRaw ? imageEvidence(baseRaw).layers : undefined;
  report.baseImages = evidence.baseDigest ? [{ name: evidence.baseName, digest: evidence.baseDigest, verified: !!baseLayers?.length && baseLayers.every((layer, i) => evidence.layers[i] === layer) }] : [];
  for (const finding of report.findings) finding.origin = attributeOrigin(finding, { ...evidence, baseLayers });
}
