import { boundedBody } from './body';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Store } from '../store';
import { enqueueSource, sourceFlags } from './service';
export const hookSecret = (secret: string, id: string, version: number) => createHmac('sha256',secret).update(`kopes.source.hook:${id}:${version}`).digest('hex');
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export async function handleSourceHook(request:Request,store:Store,secret:string,connectionId:string){
  if(!sourceFlags().connections||!sourceFlags().scanning)return new Response('Pilot disabled.',{status:503});
  const connection=store.db.prepare("SELECT provider,credential_version FROM source_connections WHERE id=? AND disconnected=0 AND auth_kind NOT IN ('pat','github_app','gitlab_oauth')").get(connectionId);
  if(!connection)return new Response('Not found.',{status:404});
  let raw:string;try{raw=await boundedBody(request,1024*1024);}catch{return new Response('Payload too large.',{status:413});}
  const expected=hookSecret(secret,connectionId,Number(connection.credential_version));
  const signature=request.headers.get('x-hub-signature-256')??'';
  if(connection.provider==='github'?!equal(signature,'sha256='+createHmac('sha256',expected).update(raw).digest('hex')):!equal(request.headers.get('x-gitlab-token')??'',expected))return new Response('Invalid authentication.',{status:401});
  const delivery=request.headers.get(connection.provider==='github'?'x-github-delivery':'x-gitlab-event-uuid');
  if(!delivery||delivery.length>200)return new Response('Delivery identity required.',{status:400});
  const event=request.headers.get(connection.provider==='github'?'x-github-event':'x-gitlab-event');
  if(event!==(connection.provider==='github'?'push':'Push Hook'))return new Response(null,{status:204});
  let body:any;try{body=JSON.parse(raw);}catch{return new Response('Invalid JSON.',{status:400});}
  const providerId=String(connection.provider==='github'?body.repository?.id:body.project?.id);
  store.transaction(()=>{
    const inserted=store.db.prepare('INSERT OR IGNORE INTO source_deliveries VALUES (?,?,?)').run(connectionId,delivery,Date.now());
    if(!inserted.changes)return;
    const bindings=store.db.prepare(`SELECT b.id,b.branch FROM source_bindings b JOIN source_repositories r ON r.id=b.repository_id
      LEFT JOIN projects p ON p.id=b.project_id WHERE b.connection_id=? AND r.provider_id=? AND b.enabled=1 AND (b.project_id IS NULL OR p.archived=0)`).all(connectionId,providerId);
    for(const b of bindings)if(body.ref===`refs/heads/${b.branch}`)enqueueSource(store,String(b.id),'poll');
  });
  return new Response(null,{status:202});
}
