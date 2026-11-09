import type { Container } from '../lib/model';
import type { CoolifyLookup } from './coolify';

type DockerContainer = { Id: string; Names: string[]; Image: string; ImageID: string; Labels: Record<string, string> };

function coolifyInfrastructure(c: DockerContainer, labels: Record<string, string>): string | undefined {
  const compose = labels['com.docker.compose.project'];
  const directory = labels['com.docker.compose.project.working_dir']?.replace(/\/+$/, '');
  const names = c.Names.map(name => name.replace(/^\//, ''));
  // "source" alone is a common Compose project name, not evidence of Coolify.
  if (compose === 'source' && (directory === '/data/coolify/source'
    || names.some(name => ['coolify', 'coolify-db', 'coolify-redis', 'coolify-realtime'].includes(name)))) {
    return 'Coolify · Platform';
  }
  if (compose === 'coolify-proxy' && (directory === '/data/coolify/proxy'
    || names.some(name => ['coolify-proxy', 'coolify-proxy-logrotate'].includes(name)))) {
    return 'Coolify · Reverse proxy';
  }
  if (!compose) {
    // Match full known image repositories, never a generic name like "sentinel".
    const repository = c.Image.split('@')[0].replace(/:[^/:]+$/, '');
    const officialImage = repository.replace(/^(?:docker\.io|ghcr\.io)\//, '');
    if (officialImage === 'coollabsio/sentinel'
      || (names.includes('coolify-sentinel') && labels['coolify.managed'] === 'true')) {
      return 'Coolify · Monitoring';
    }
    if (officialImage === 'coollabsio/coolify-helper') return 'Coolify · Deployment helpers';
  }
}

export function containerInfo(c: DockerContainer): Container {
  if (!/^[a-f0-9]{64}$/.test(c.Id) || !/^sha256:[a-f0-9]{64}$/.test(c.ImageID) || !Array.isArray(c.Names) || typeof c.Image !== 'string') throw new Error('Invalid Docker container inventory.');
  const labels = c.Labels ?? {};
  const name = (c.Names[0] ?? c.Id.slice(0, 12)).replace(/^\//, '') || c.Id.slice(0, 12);
  const coolifyId = labels['coolify.applicationUuid'] || labels['coolify.serviceUuid'] || labels['coolify.databaseUuid']
    || labels['coolify.applicationId'] || labels['coolify.serviceId'] || labels['coolify.databaseId'];
  const coolifyProject = labels['coolify.projectName']?.trim();
  const coolifyResource = labels['coolify.resourceName']?.trim();
  const coolifyName = labels['coolify.name']?.trim();
  const coolify = labels['coolify.managed'] === 'true' || !!(coolifyId || coolifyProject || coolifyResource || coolifyName);
  const dokploy = labels['dokploy.applicationId'] || labels['dokploy.composeId'];
  const compose = labels['com.docker.compose.project'];
  const infrastructure = !coolifyProject && !coolifyResource && !coolifyId && !dokploy
    ? coolifyInfrastructure(c, labels) : undefined;
  const project = coolifyProject
    ? [coolifyProject, labels['coolify.environmentName']?.trim()].filter(Boolean).join(' · ')
    : coolifyResource || coolifyName || coolifyId || compose || name;
  return { id: c.Id, name, image: c.Image, target_id: `image:${c.ImageID}`,
    project: labels['kopes.project']?.trim() || infrastructure || (coolify ? `Coolify · ${project}` : dokploy ? `Dokploy · ${dokploy}` : compose || `Standalone · ${name}`),
    manager: coolify || infrastructure ? 'Coolify' : dokploy ? 'Dokploy' : compose ? 'Compose' : 'Docker',
    service: labels['coolify.serviceName']?.trim() || labels['com.docker.compose.service'] || coolifyResource || coolifyName || '' };
}
export async function dockerJson(base: string, path: string): Promise<unknown> {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Docker proxy returned HTTP ${response.status}. Check socket access and proxy permissions.`);
  return response.json();
}
export async function inventory(base: string, lookup?: () => Promise<CoolifyLookup>) {
  const data = await dockerJson(base, '/containers/json');
  if (!Array.isArray(data)) throw new Error('Docker inventory is not a list.');
  const containers = data.map(containerInfo);
  const resolve = await lookup?.();
  return containers.map((container, index) => {
    const labels = data[index].Labels ?? {};
    const project = !labels['kopes.project']?.trim() && resolve?.(labels);
    return project ? { ...container, project, manager: 'Coolify' } : container;
  });
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
