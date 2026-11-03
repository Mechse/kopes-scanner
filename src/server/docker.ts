import type { Container } from '../lib/model';

type DockerContainer = { Id: string; Names: string[]; Image: string; ImageID: string; Labels: Record<string, string> };
export function containerInfo(c: DockerContainer): Container {
  if (!/^[a-f0-9]{64}$/.test(c.Id) || !/^sha256:[a-f0-9]{64}$/.test(c.ImageID) || !Array.isArray(c.Names) || typeof c.Image !== 'string') throw new Error('Invalid Docker container inventory.');
  const labels = c.Labels ?? {};
  const coolify = labels['coolify.applicationId'] || labels['coolify.serviceId'];
  const dokploy = labels['dokploy.applicationId'] || labels['dokploy.composeId'];
  const compose = labels['com.docker.compose.project'];
  return { id: c.Id, name: (c.Names[0] ?? c.Id.slice(0, 12)).replace(/^\//, ''), image: c.Image, target_id: `image:${c.ImageID}`,
    project: coolify ? `Coolify · ${labels['coolify.name'] || coolify}` : dokploy ? `Dokploy · ${dokploy}` : compose || 'Standalone',
    manager: coolify ? 'Coolify' : dokploy ? 'Dokploy' : compose ? 'Compose' : 'Docker',
    service: labels['com.docker.compose.service'] || labels['coolify.name'] || '' };
}
export async function dockerJson(base: string, path: string): Promise<unknown> {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Docker proxy returned HTTP ${response.status}. Check socket access and proxy permissions.`);
  return response.json();
}
export async function inventory(base: string) {
  const data = await dockerJson(base, '/containers/json');
  if (!Array.isArray(data)) throw new Error('Docker inventory is not a list.');
  return data.map(containerInfo);
}
export async function imagePlatform(base: string, image: string) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Invalid immutable image ID.');
  const data = await dockerJson(base, `/images/${image}/json`) as { Os?: string; Architecture?: string; Variant?: string };
  if (data.Os !== 'linux' || !data.Architecture || !/^[a-z0-9]+$/.test(data.Architecture) || (data.Variant && !/^[a-z0-9]+$/.test(data.Variant))) throw new Error('Only Linux images are supported.');
  return [data.Os, data.Architecture, data.Variant].filter(Boolean).join('/');
}
export async function watchEvents(base: string, onChange: (startedId?: string) => void, signal: AbortSignal) {
  const filters = encodeURIComponent(JSON.stringify({ type: ['container'], event: ['start', 'die', 'destroy', 'rename'] }));
  const response = await fetch(`${base}/events?filters=${filters}`, { signal, redirect: 'error' });
  if (!response.ok || !response.body) throw new Error(`Docker events unavailable (${response.status}).`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += value;
      if (pending.length > 1_000_000) throw new Error('Docker event exceeded size limit.');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines.filter(line => line.trim())) {
        const event = JSON.parse(line) as { Action?: string; Actor?: { ID?: string } };
        onChange(event.Action === 'start' ? event.Actor?.ID : undefined);
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
}
