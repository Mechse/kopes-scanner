import { boundedFetch, publicImage } from './registry';

/** Only immutable FROM references are candidates. ARG values may have been overridden. */
export function dockerfileCandidates(source: string) {
  const stages: { name: string; from: string; parent?: number }[] = [];
  for (const line of source.replace(/\\\r?\n/g, ' ').split(/\r?\n/)) {
    const match = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?\s*(?:#.*)?$/i.exec(line);
    if (!match) continue;
    stages.push({ name: match[2]?.toLowerCase() ?? String(stages.length), from: match[1],
      parent: stages.findIndex(stage => stage.name === match[1].toLowerCase()) });
  }
  const runtime = new Set<number>();
  let index = stages.length - 1;
  while (index >= 0 && !runtime.has(index)) { runtime.add(index); index = stages[index].parent ?? -1; }
  return stages.flatMap((stage, i) => {
    const match = /^(.+)@(sha256:[a-f0-9]{64})$/.exec(stage.from);
    return match && !stage.from.includes('$') && publicImage(match[1]) ? [{ name: match[1], digest: match[2], role: runtime.has(i) ? 'runtime' as const : 'build-only' as const }] : [];
  });
}

/** Producer source labels supply candidates, not authenticated build identity. Never read a moving branch. */
export async function sourceDockerfileCandidates(raw: string, signal: AbortSignal) {
  const labels = JSON.parse(raw).Metadata?.ImageConfig?.config?.Labels ?? {};
  const source = labels['org.opencontainers.image.source'];
  const revision = labels['org.opencontainers.image.revision'];
  if (typeof source !== 'string' || typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) return [];
  const match = /^https:\/\/github.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(source);
  if (!match) return [];
  try {
    const { body } = await boundedFetch(`https://raw.githubusercontent.com/${match[1]}/${match[2]}/${revision}/Dockerfile`, {}, signal);
    return dockerfileCandidates(body);
  } catch { signal.throwIfAborted(); return []; }
}
