import { createFileRoute } from '@tanstack/react-router';
import { runtime } from '../server/runtime';
import { requireSameOrigin, requireSession } from '../server/auth';
import { isGithubUsername } from '../server/config';

async function handle({ request }: { request: Request }) {
  const { auth, store, config } = await runtime();
  const session = await requireSession(request, auth, config, store);
  const isAdmin = session.user.githubLogin?.toLowerCase() === config.admin;
  const url = new URL(request.url);
  const action = url.pathname.replace('/api/data/', '');
  const id = url.searchParams.get('id') ?? '';
  if (action === 'users') {
    if (!isAdmin) return new Response('Administrator access required.', { status: 403 });
    if (request.method === 'POST') {
      requireSameOrigin(request, config.origin);
      const body = await request.json().catch(() => null);
      const login = typeof body?.login === 'string' ? body.login.trim().toLowerCase() : '';
      if (!isGithubUsername(login) || !['add', 'remove'].includes(body?.action)) return new Response('Supply a GitHub username and add/remove action.', { status: 400 });
      if (login === config.admin) return new Response('The administrator is managed through GITHUB_ADMIN_USER.', { status: 400 });
      if (body.action === 'add') store.addUser(login);
      else store.removeUser(login);
    }
    return Response.json({ admin: config.admin, users: store.allowedUsers() });
  }
  if (request.method === 'GET' && action === 'inventory') return Response.json({ ...store.dashboard(config.intervalHours), isAdmin });
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
