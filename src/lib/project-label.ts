import type { Container } from './model';

// Generated deployment IDs are useful references, but poor display names.
function isDeploymentId(value: string): boolean {
  return /^(?=[a-z0-9]*\d)[a-z0-9]{20,64}$/i.test(value);
}

export function projectLabel(project: string, containers: Container[], names?: Record<string, string>) {
  const identifier = project.replace(/^(?:Coolify|Dokploy|Standalone) · /, '');
  const services = [...new Set(containers.map(container => {
    const service = container.service.trim();
    if (service && !isDeploymentId(service)) return service;
    const image = container.image.split('@')[0].split('/').pop()?.split(':')[0] ?? '';
    if (image && !isDeploymentId(image) && image !== 'sha256') return image;
    return 'Container';
  }))].sort((a, b) => a.localeCompare(b));
  const summary = services.slice(0, 3).join(' + ') + (services.length > 3 ? ` + ${services.length - 3} more` : '');
  if (names && Object.hasOwn(names, project)) return { title: names[project], detail: summary };
  return isDeploymentId(identifier)
    ? { title: summary || 'Unnamed deployment', detail: project }
    : { title: project || 'Ungrouped', detail: summary };
}
