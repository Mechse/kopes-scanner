import { scanSettingsSchema } from '../lib/settings';
import { z } from 'zod';
import type { Store } from './store';
import { ProjectStore, type ProjectPrincipal } from './project-store';

const id = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(120);
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('defaults'), id, settings: scanSettingsSchema }).strict(),
  z.object({ action: z.literal('inherit'), id, resourceId: id }).strict(),
  z.object({ action: z.literal('resource'), id, resourceId: id, name, environment: z.string().trim().max(120) }).strict(),
  z.object({ action: z.literal('rescan'), id, resourceId: id }).strict(),
  z.object({ action: z.literal('create'), name }).strict(),
  z.object({ action: z.literal('adopt'), group: z.string().min(1).max(1000) }).strict(),
  z.object({ action: z.literal('update'), id, name, archived: z.boolean() }).strict(),
  z.object({ action: z.literal('membership'), id, userId: id, enabled: z.boolean() }).strict(),
  z.object({ action: z.literal('move'), resourceId: id, projectId: id, reset: z.boolean().default(false), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);

/** Principal is derived by the authenticated route, never read from a request body. */
export async function handleProjects(request: Request, store: Store, principal: ProjectPrincipal, origin: string) {
  const projects = new ProjectStore(store.db, principal);
  const url = new URL(request.url);
  const json = (value: unknown) => Response.json(value, { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'POST') {
    if (request.headers.get('origin') !== origin) return new Response('Origin not allowed.', { status: 403 });
    const parsed = command.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return new Response('Invalid container action.', { status: 400 });
    const body = parsed.data;
    if (!principal.administrator && body.action !== 'rescan') return new Response('Administrator access required.', { status: 403 });
    if (body.action === 'rescan' && !projects.canRead(body.id)) return new Response('Container not found.', { status: 404 });
    try {
      switch (body.action) {
        case 'defaults': projects.setProjectSettings(body.id, body.settings); break;
        case 'inherit': projects.resetResourceSettings(body.id, body.resourceId); break;
        case 'resource': projects.editResource(body.id, body.resourceId, body.name, body.environment); break;
        case 'rescan': return json({ queued: projects.requestScan(body.id, body.resourceId) });
        case 'adopt': return json({ id: projects.adopt(body.group) });
        case 'create': return json({ id: projects.create(body.name) });
        case 'update': projects.update(body.id, body.name, body.archived); break;
        case 'membership': projects.grant(body.id, body.userId, body.enabled); break;
        case 'move': projects.move(body.resourceId, body.projectId, body.reset, body.revision); break;
      }
      return json({ ok: true });
    } catch { return new Response('Container action could not be applied.', { status: 400 }); }
  }
  if (request.method !== 'GET') return new Response('Method not allowed.', { status: 405 });
  const projectId = url.searchParams.get('id');
  if (projectId && !projects.canRead(projectId)) return new Response('Container not found.', { status: 404 });
  const view = url.searchParams.get('view');
  if (view === 'overview') return json({ projects: projects.list().map(p => ({ ...p, discoveredGroups: projects.discoveredGroups(String(p.id)) })), administrator: principal.administrator });
  if (view === 'members') {
    if (!principal.administrator) return new Response('Administrator access required.', { status: 403 });
    return json(projects.members(projectId ?? ''));
  }
  if (['observations', 'observation', 'export'].includes(view ?? '')) {
    try {
      const resource = url.searchParams.get('resourceId') ?? '';
      if (view === 'observations') return json(projects.observations(projectId ?? '', resource));
      const observation = projects.observation(projectId ?? '', resource, url.searchParams.get('observationId') ?? '');
      if (!observation) return new Response('Observation not found.', { status: 404 });
      if (view === 'export') return new Response(String(observation.sbom ?? ''), { headers: { 'Content-Type': 'application/vnd.cyclonedx+json', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'attachment; filename="kopes-sbom.json"' } });
      return json({ ...observation, report: JSON.parse(String(observation.report_json)), report_json: undefined, sbom: undefined });
    } catch { return new Response('Resource not found.', { status: 404 }); }
  }
  if (url.searchParams.get('view') === 'unassigned') {
    if (!principal.administrator) return new Response('Administrator access required.', { status: 403 });
    return json(projects.unassigned());
  }
  if (url.searchParams.get('view') === 'move-preview') {
    if (!principal.administrator) return new Response('Administrator access required.', { status: 403 });
    try { return json(projects.previewMove(url.searchParams.get('resourceId') ?? '', projectId ?? '')); }
    catch { return new Response('Assignment unavailable.', { status: 404 }); }
  }
  return json(projectId ? projects.detail(projectId) : projects.list());
}
