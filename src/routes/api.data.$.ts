import { scanSettingsSchema, overridesSchema } from '../lib/settings';
import { createFileRoute } from '@tanstack/react-router';
import { lookupAdvisory } from '../server/advisory';
import { isCve } from '../lib/advisory';
import { runtime } from '../server/runtime';
import { requireSameOrigin, requireSession } from '../server/auth';
import { accessIdentifier } from '../lib/user-access';

async function handle({ request }: { request: Request }) {
  const { auth, store, config } = await runtime();
  const session = await requireSession(request, auth, config, store);
  const isAdmin = session.user.githubLogin?.toLowerCase() === config.admin;
  const url = new URL(request.url);
  const action = url.pathname.replace('/api/data/', '');
  const id = url.searchParams.get('id') ?? '';
  if (request.method === 'GET' && action === 'advisory') {
    if (!isCve(id)) return new Response('Invalid CVE identifier.', { status: 400 });
    return Response.json(await lookupAdvisory(id), { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (action === 'users') {
    if (!isAdmin) return new Response('Administrator access required.', { status: 403 });
    if (request.method === 'POST') {
      requireSameOrigin(request, config.origin);
      const body = await request.json().catch(() => null);
      const login = accessIdentifier(body?.login);
      if (!login || !['add', 'remove'].includes(body?.action)) return new Response('Supply a GitHub handle or valid email address and add/remove action.', { status: 400 });
      if (login === config.admin || body.action === 'add' && store.userAccess(config.admin).people.some(person => person.login === config.admin && (person.identifier === login || person.email?.toLowerCase() === login))) return new Response('The administrator is managed through GITHUB_ADMIN_USER.', { status: 400 });
      if (body.action === 'add') {
        if (!store.addUser(login, config.admin)) return new Response('This person already has an access entry.', { status: 409 });
      } else store.removeUser(login, config.admin);
    }
    return Response.json(store.userAccess(config.admin), { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (action === 'pulse-feed') {
    if (request.method === 'POST') {
      requireSameOrigin(request, config.origin);
      const body = await request.json().catch(() => null);
      if (typeof body?.issue !== 'string' || !Number.isSafeInteger(body?.seq) || !['dismiss', 'restore', 'bookmark', 'unbookmark'].includes(body?.action)) return new Response('Invalid Pulse action.', { status: 400 });
      if (!store.setPulseState(session.user.id, body.issue, body.seq, body.action)) return new Response('Update no longer available.', { status: 404 });
    }
    return Response.json(store.pulseFeed(session.user.id), { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (action === 'settings') {
    const scope = url.searchParams.get('scope');
    const key = url.searchParams.get('key');
    if ((scope !== 'project' && scope !== 'resource') || key === null) return new Response('Invalid settings scope.', { status: 400 });
    if (!store.settings(scope, key)) return new Response('Resource or project no longer exists.', { status: 404 });
    if (request.method === 'POST') {
      requireSameOrigin(request, config.origin);
      const parsed = (scope === 'project' ? scanSettingsSchema : overridesSchema).safeParse(await request.json().catch(() => null));
      if (!parsed.success) return new Response('Invalid scan or notification settings.', { status: 400 });
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
    return report ? Response.json(report) : new Response('No completed scan yet.', { status: 404 });
  }
  if (request.method === 'GET' && action === 'sbom') {
    const sbom = store.sbom(id);
    return sbom ? new Response(sbom, { headers: { 'Content-Type': 'application/vnd.cyclonedx+json', 'Content-Disposition': 'attachment; filename="kopes-sbom.cdx.json"' } }) : new Response('No SBOM yet.', { status: 404 });
  }
  if (request.method === 'POST' && action === 'rescan') {
    requireSameOrigin(request, config.origin);
    const target = store.db.prepare('SELECT attempted_at, status FROM targets WHERE id=?').get(id) as { attempted_at: number | null; status: string } | undefined;
    if (!target) return new Response('Unknown target.', { status: 404 });
    if (target.status === 'scanning' || (target.attempted_at && Date.now() - target.attempted_at < 60_000)) return new Response('A scan is running or was just attempted. Wait one minute before retrying.', { status: 429 });
    store.request(id);
    return Response.json({ queued: true }, { status: 202 });
  }
  return new Response('Not found.', { status: 404 });
}
export const Route = createFileRoute('/api/data/$')({ server: { handlers: { GET: handle, POST: handle } } });
