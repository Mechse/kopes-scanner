import { createFileRoute } from '@tanstack/react-router';
import { runtime } from '../server/runtime';
import { requireSameOrigin, requireSession } from '../server/auth';

async function handle({ request }: { request: Request }) {
  const { auth, store, config } = await runtime();
  await requireSession(request, auth, config);
  const url = new URL(request.url);
  const action = url.pathname.replace('/api/data/', '');
  const id = url.searchParams.get('id') ?? '';
  if (request.method === 'GET' && action === 'inventory') return Response.json(store.dashboard(config.intervalHours));
  if (id !== 'host' && !/^image:sha256:[a-f0-9]{64}$/.test(id)) return new Response('Invalid target.', { status: 400 });
  if (request.method === 'GET' && action === 'report') {
    const report = store.report(id);
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
