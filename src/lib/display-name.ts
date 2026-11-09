import type { Dashboard } from './model';

export function resourceName(resource?: { name: string; displayName?: string }): string {
  return resource?.displayName || resource?.name || 'Resource';
}
export function projectName(project: string, data?: Pick<Dashboard, 'projectNames'>): string {
  return data?.projectNames && Object.hasOwn(data.projectNames, project) ? data.projectNames[project] : project || 'Ungrouped';
}
