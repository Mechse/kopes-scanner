import type { Dashboard } from './model';
import { resourceKey } from './settings';
import { resourceName } from './display-name';

export type FindingEvent = { seq: number; app: string; name: string; issue: string; package: string; ecosystem: string; kind: 'discovered'; time: number };
export type ScanEvent = { seq: number; target: string; name: string; message: string; time: number };
export type ActivityScope = { containerIds?: string[]; project?: string; target?: string; app?: string };
export type ActivityResource = { key: string; name: string; target: string; app?: string; project?: string };
export type ActivityEvent = { id: string; kind: 'findings' | 'scans'; time: number; title: string; detail?: string; resources: ActivityResource[] };

export function activityResources(data: Dashboard, scope: ActivityScope): ActivityResource[] {
  // An invalid app must never fall back to all resources sharing its image.
  if (scope.target) {
    if (scope.app) return data.containers.filter(c => c.id === scope.app && c.target_id === scope.target).map(c => ({ key: resourceKey(c), name: resourceName(c), target: c.target_id, app: c.id, project: c.project }));
    if (scope.target === 'host') return data.targets.filter(t => t.id === 'host').map(t => ({ key: 'host', name: resourceName(t), target: t.id }));
    return data.containers.filter(c => c.target_id === scope.target && (scope.project === undefined || c.project === scope.project)).map(c => ({ key: resourceKey(c), name: resourceName(c), target: c.target_id, app: c.id, project: c.project }));
  }
  if (scope.containerIds) return data.containers.filter(c => scope.containerIds!.includes(c.id)).map(c => ({ key: resourceKey(c), name: resourceName(c), target: c.target_id, app: c.id, project: c.project }));
  if (scope.project === undefined) return [];
  return data.containers.filter(c => c.project === scope.project).map(c => ({ key: resourceKey(c), name: resourceName(c), target: c.target_id, app: c.id, project: c.project }));
}

export function activityEvents(resources: ActivityResource[], findings: FindingEvent[], scans: ScanEvent[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const event of findings) {
    const matches = resources.filter(r => r.key === event.app);
    if (matches.length) events.push({ id: `finding-${event.seq}`, kind: 'findings', time: event.time, title: `${event.issue} discovered`, detail: `${event.package} · ${event.ecosystem}`, resources: matches });
  }
  for (const event of scans) {
    const matches = resources.filter(r => r.target === event.target);
    if (matches.length) events.push({ id: `scan-${event.seq}`, kind: 'scans', time: event.time, title: event.message, resources: matches });
  }
  return events.sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
}
