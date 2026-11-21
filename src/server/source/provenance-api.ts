import type { Store } from '../store';
import { ProjectStore, type ProjectPrincipal } from '../project-store';
import { sourceFlags } from './service';

export function handleProvenance(request: Request, store: Store, principal: ProjectPrincipal) {
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control':'private, no-store' } });
  if (!sourceFlags().provenance) return json({ enabled:false,reason:'Provenance pilot disabled.' },503);
  const projectId = new URL(request.url).searchParams.get('projectId') ?? '';
  const projects = new ProjectStore(store.db,principal);
  if (!projects.canRead(projectId)) return json({error:'Container not found.'},404);
  if (request.method !== 'GET') return json({error:'Method not allowed.'},405);
  return json({ events: store.db.prepare('SELECT * FROM source_events WHERE project_id=? ORDER BY observed_at DESC LIMIT 200').all(projectId).map(e=>({...e,evidence:JSON.parse(String(e.evidence_json)),evidence_json:undefined,actor:e.actor_json?JSON.parse(String(e.actor_json)):null,actor_json:undefined})) });
}
