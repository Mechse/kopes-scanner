import type { Store } from './store';
import { type ProjectPrincipal } from './project-store';

export function rescan(store: Store, targetId: string, principal: ProjectPrincipal, containerId?: string) {
  const target = store.db.prepare('SELECT attempted_at, status FROM targets WHERE id=?').get(targetId);
  if (!target) return new Response('Unknown target.', { status: 404 });
  if (containerId && !store.db.prepare('SELECT 1 FROM runtime_instances WHERE container_id=? AND target_id=? AND active=1').get(containerId, targetId)) {
    return new Response('Resource is no longer available for this target.', { status: 404 });
  }
  if (target.status === 'scanning' || (target.attempted_at && Date.now() - Number(target.attempted_at) < 60_000)) {
    return new Response('A scan is running or was just attempted. Wait one minute before retrying.', { status: 429 });
  }
  store.request(targetId);
  return Response.json({ queued: true, sourceScans: 0 }, { status: 202 });
}
