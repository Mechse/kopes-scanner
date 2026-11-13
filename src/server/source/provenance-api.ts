import type { Store } from '../store';
import type { Config } from '../config';
import { ProjectStore, type ProjectPrincipal } from '../project-store';
import { readCoolifyConnection } from '../coolify-settings';
import { sourceFlags, enqueueSource } from './service';
import { appendEvidence, deploymentHistory } from './provenance';
export async function handleProvenance(request: Request, store: Store, principal: ProjectPrincipal, config: Config) {
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control':'private, no-store' } });
  if (!sourceFlags().provenance) return json({ enabled:false,reason:'Provenance pilot disabled.' },503);
  const projectId = new URL(request.url).searchParams.get('projectId') ?? '';
  const projects = new ProjectStore(store.db,principal);
  if (!projects.canRead(projectId)) return json({error:'Container not found.'},404);
  if (request.method === 'GET') return json({ errors: projects.detail(projectId).resources.map(r=>({ resourceId:r.id, error:store.getMeta('provenance.error.'+r.id)??'' })).filter(r=>r.error), events: store.db.prepare('SELECT * FROM source_events WHERE project_id=? ORDER BY observed_at DESC LIMIT 200').all(projectId).map(e=>({...e,evidence:JSON.parse(String(e.evidence_json)),evidence_json:undefined,actor:e.actor_json?JSON.parse(String(e.actor_json)):null,actor_json:undefined})) });
  if (request.method !== 'POST') return json({error:'Method not allowed.'},405);
  if (!principal.administrator || request.headers.get('origin') !== config.origin) return json({error:'Administrator and same-origin request required.'},403);
  const body = await request.json().catch(()=>null);
  if (typeof body?.resourceId !== 'string') return json({error:'Select a resource.'},400);
  try {
    projects.resource(projectId,body.resourceId);
    const records = await collectProvenance(store,config,projectId,body.resourceId);
    return json({observations:records.length,note:'Provider-reported only. Runtime source/image linkage and actor attribution remain unknown.'});
  } catch { return json({error:'Deployment history unavailable; prior observations retained.'},502); }
}

export async function collectProvenance(store: Store, config: Config, projectId: string, resourceId: string) {
  const projects = new ProjectStore(store.db,{userId:'collector',administrator:true});
    const resource = projects.resource(projectId,resourceId);
    const aliases = store.db.prepare('SELECT alias FROM resource_aliases WHERE resource_id=?').all(resourceId).map(r=>{try{return JSON.parse(String(r.alias));}catch{return [];} });
    const identities = aliases.filter(a=>Array.isArray(a)&&a[0]==='local'&&a[1]==='Coolify'&&a[2]==='application'&&a.length===4);
    if (identities.length!==1) throw new Error('A unique Coolify application identity is unavailable.');
    const connection = readCoolifyConnection(store,config);
    if (!connection.url || !connection.token) throw new Error('Read-only Coolify connection required.');
    const records = await deploymentHistory(connection.url,connection.token,identities[0][3],resourceId,resource.environment?String(resource.environment):null);
    store.transaction(()=>{for(const record of records){const {observedAt,...evidence}=record;appendEvidence(store,projectId,'deployment-reported',evidence,record.sourceTime);}});
  store.setMeta('provenance.error.'+resourceId,'');
  return records;
}

