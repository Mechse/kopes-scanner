import { handleGithub } from '../server/source/github-connections';
import { githubContext } from '../server/source/github-auth';
import { findingEvidence, annotateReport, syncSourcePulse } from '../server/source/finding-evidence';
import { rescan } from '../server/rescan';
import { handleRepositories } from '../server/source/repositories';
import { handleFavourites } from '../server/favourites';
import { handleProvenance } from '../server/source/provenance-api';
import { handleSource } from '../server/source/service';
import { handleProjects } from '../server/project-api';
import { projectSettingsSchema, resourceSettingsSchema } from '../lib/settings';
import { createFileRoute } from '@tanstack/react-router';
import { lookupAdvisory } from '../server/advisory';
import { isCve } from '../lib/advisory';
import { inventory } from '../server/docker';
import { runtime } from '../server/runtime';
import { isAdministrator, requireSameOrigin, requireSession } from '../server/auth';
import { accessIdentifier } from '../lib/user-access';
import { handleAuthSettings } from '../server/auth-settings';
import { handleCoolifySettings } from '../server/coolify-settings';

async function handle({ request }: { request: Request }) {
  const { auth, store, config, baseConfig, syncSelected } = await runtime();
  const session = await requireSession(request, auth, config, store);
  const isAdmin = isAdministrator(session.user, config);
  const url = new URL(request.url);
  const action = url.pathname.replace('/api/data/', '');
  const id = url.searchParams.get('id') ?? '';
  if (action === 'github' || action === 'github-repositories') return handleGithub(request,store,await githubContext(request),config);
  if (action === 'favourites') return handleFavourites(request, store, session.user.id, config.origin, isAdmin);
  if (action === 'provenance') return handleProvenance(request, store, { userId: session.user.id, administrator: isAdmin }, config);
  if (action === 'repositories') return handleRepositories(request, store, { userId: session.user.id, administrator: isAdmin }, config.origin, undefined, config.secret, isAdmin ? (await githubContext(request)).recheck : undefined);
  if (action === 'source') return handleSource(request, store, { userId: session.user.id, administrator: isAdmin }, { ...config, recheck: isAdmin ? (await githubContext(request)).recheck : undefined });
  if (action === 'projects') return handleProjects(request, store, { userId: session.user.id, administrator: isAdmin }, config.origin);
  if (action === 'auth-settings') return handleAuthSettings(request, isAdmin, session.user.accessId?.startsWith('microsoft:') ? 'microsoft' : session.user.accessId ? 'google' : 'github', store, baseConfig);
  if (action === 'coolify') return handleCoolifySettings(request, isAdmin, store, config);
  if (request.method === 'GET' && action === 'advisory') {
    if (!isCve(id)) return new Response('Invalid CVE identifier.', { status: 400 });
    return Response.json(await lookupAdvisory(id), { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (action === 'machine-containers') {
    if (!isAdmin) return new Response('Administrator access required.', { status: 403 });
    if (request.method === 'POST') {
      requireSameOrigin(request, config.origin);
      const body = await request.json().catch(() => null);
      if (typeof body?.id !== 'string' || !/^[a-f0-9]{64}$/.test(body.id)) return new Response('Invalid container ID.', { status: 400 });
      if (body.action === 'remove') return await syncSelected(body.id, 'remove') ? new Response(null, { status: 204 }) : new Response('Container is not tracked.', { status: 404 });
      if (body.action !== undefined && body.action !== 'add') return new Response('Invalid action.', { status: 400 });
      try {
        return await syncSelected(body.id) ? new Response(null, { status: 204 }) : new Response('Container is no longer running.', { status: 409 });
      } catch { return new Response('Could not add the container. Check Docker connectivity and retry.', { status: 503 }); }
    }
    if (url.searchParams.get('view') === 'tracked') return Response.json(store.trackedContainers(url.searchParams.get('projectId')),  { headers: { 'Cache-Control': 'private, no-store' } });
    try {
      const tracked = new Set(store.selectedContainers());
      const rows = (await inventory(config.docker)).filter(c => !tracked.has(c.id)).map(({ id, name, image }) => ({ id, name, image }));
      return Response.json(rows, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch { return new Response('Could not list running containers. Check Docker connectivity and retry.', { status: 503 }); }
  }
  if (action === 'users') {
    if (!isAdmin) return new Response('Administrator access required.', { status: 403 });
    if (request.method === 'POST') {
      requireSameOrigin(request, config.origin);
      const body = await request.json().catch(() => null);
      const login = accessIdentifier(body?.login);
      if (!login || !['add', 'remove'].includes(body?.action)) return new Response('Supply a GitHub handle or valid email address and add/remove action.', { status: 400 });
      if (login === config.adminEmail || login === config.admin || body.action === 'add' && store.userAccess(config.admin, config.adminEmail).people.some(person => person.login === config.admin && (person.identifier === login || person.email?.toLowerCase() === login))) return new Response('The administrator is managed in sign-in settings or the deployment environment.', { status: 400 });
      if (body.action === 'add') {
        if (!store.addUser(login, session.user.githubLogin || session.user.accessLogin || 'Administrator')) return new Response('This person already has an access entry.', { status: 409 });
      } else store.removeUser(login, session.user.githubLogin || session.user.accessLogin || 'Administrator');
    }
    return Response.json(store.userAccess(config.admin, config.adminEmail), { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (request.method === 'GET' && action === 'finding-evidence') return Response.json(findingEvidence(store, { userId: session.user.id, administrator: isAdmin }, url.searchParams.get('issue') || undefined), { headers: { 'Cache-Control': 'private, no-store' } });
  if (action === 'pulse-feed') {
    const sourceBindings = syncSourcePulse(store, { userId: session.user.id, administrator: isAdmin });
    if (request.method === 'POST') {
      requireSameOrigin(request, config.origin);
      const body = await request.json().catch(() => null);
      if (typeof body?.issue !== 'string' || !Number.isSafeInteger(body?.seq) || !['dismiss', 'restore', 'bookmark', 'unbookmark'].includes(body?.action)) return new Response('Invalid Pulse action.', { status: 400 });
      if (!store.setPulseState(session.user.id, body.issue, body.seq, body.action, sourceBindings)) return new Response('Update no longer available.', { status: 404 });
    }
    return Response.json(store.pulseFeed(session.user.id, sourceBindings), { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (action === 'settings') {
    const scope = url.searchParams.get('scope');
    const key = url.searchParams.get('key');
    if ((scope !== 'project' && scope !== 'resource') || key === null) return new Response('Invalid settings scope.', { status: 400 });
    if (!store.settings(scope, key)) return new Response('Resource or container no longer exists.', { status: 404 });
    if (request.method === 'POST') {
      requireSameOrigin(request, config.origin);
      const parsed = (scope === 'project' ? projectSettingsSchema : resourceSettingsSchema).safeParse(await request.json().catch(() => null));
      if (!parsed.success) return new Response('Invalid settings. Display names must be at most 120 characters.', { status: 400 });
      store.saveSettings(scope, key, parsed.data);
    }
    return Response.json(store.settings(scope, key), { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (request.method === 'GET' && action === 'inventory') return Response.json({ ...store.dashboard(), isAdmin });
  if (request.method === 'GET' && action === 'timeline') return Response.json(store.timeline());
  if (request.method === 'GET' && action === 'activity') return Response.json(store.activity());
  if (request.method === 'GET' && action === 'search') {
    const query = url.searchParams.get('q')?.trim();
    return Response.json(query ? store.searchFindings(query) : []);
  }
  if (id !== 'host' && !/^image:sha256:[a-f0-9]{64}$/.test(id)) return new Response('Invalid target.', { status: 400 });
  if (request.method === 'GET' && action === 'report') {
    const report = store.report(id, url.searchParams.has('scan') ? Number(url.searchParams.get('scan')) : null);
    return report ? Response.json(annotateReport(report, id, url.searchParams.has('scan') && Number(url.searchParams.get('scan')) !== store.dashboard().targets.find(t => t.id === id)?.scanned_at ? [] : findingEvidence(store, { userId: session.user.id, administrator: isAdmin }))) : new Response('No completed scan yet.', { status: 404 });
  }
  if (request.method === 'GET' && action === 'sbom') {
    const sbom = store.sbom(id);
    return sbom ? new Response(sbom, { headers: { 'Content-Type': 'application/vnd.cyclonedx+json', 'Content-Disposition': 'attachment; filename="kopes-sbom.cdx.json"' } }) : new Response('No SBOM yet.', { status: 404 });
  }
  if (request.method === 'POST' && action === 'rescan') {
    requireSameOrigin(request, config.origin);
    return rescan(store, id, { userId: session.user.id, administrator: isAdmin }, url.searchParams.get('app') || undefined);
  }
  return new Response('Not found.', { status: 404 });
}
export const Route = createFileRoute('/api/data/$')({ server: { handlers: { GET: handle, POST: handle } } });
