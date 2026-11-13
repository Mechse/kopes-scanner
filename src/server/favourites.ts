import type { Favourite } from '../lib/favourites';
import type { Store } from './store';
import { requireSameOrigin } from './auth';

export function listFavourites(store: Store, userId: string): Favourite[] {
  return (store.db.prepare('SELECT scope, key FROM favourites WHERE user_id=? ORDER BY scope,key').all(userId) as Favourite[]).map(row => ({ ...row }));
}

export async function handleFavourites(request: Request, store: Store, userId: string, origin: string, administrator = false) {
  if (request.method === 'POST') {
    requireSameOrigin(request, origin);
    const body = await request.json().catch(() => null);
    if (!body || !['project', 'resource'].includes(body.scope) || typeof body.key !== 'string' || body.key.length > 4096 || typeof body.favourite !== 'boolean') {
      return new Response('Invalid favourite.', { status: 400 });
    }
    if (body.favourite) {
      const special = body.scope === 'resource' && body.key.startsWith('repo:') ? store.db.prepare('SELECT project_id FROM source_bindings WHERE id=?').get(body.key.slice(5)) : body.scope === 'project' && body.key.startsWith('managed:') ? store.db.prepare('SELECT id AS project_id FROM projects WHERE id=?').get(body.key.slice(8)) : undefined;
      const allowed = special && (administrator || special.project_id && store.db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(special.project_id, userId));
      if (!(special ? allowed : store.settings(body.scope, body.key))) return new Response('Container or resource no longer exists.', { status: 404 });
      store.db.prepare('INSERT OR IGNORE INTO favourites(user_id,scope,key) VALUES (?,?,?)').run(userId, body.scope, body.key);
    } else {
      store.db.prepare('DELETE FROM favourites WHERE user_id=? AND scope=? AND key=?').run(userId, body.scope, body.key);
    }
  }
  return Response.json(listFavourites(store, userId), { headers: { 'Cache-Control': 'private, no-store' } });
}
