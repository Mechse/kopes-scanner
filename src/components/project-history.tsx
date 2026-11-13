import { useState } from 'react';
import { useResource } from '../lib/use-resource';
import { Button } from './ui/button';
export function ProjectHistory({ projectId, resources, administrator }: { projectId: string; resources: {id:string;name:string}[];administrator:boolean }) {
  const [revision,refresh]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const path=`provenance?projectId=${encodeURIComponent(projectId)}`;
  const data=useResource<{errors:{resourceId:string;error:string}[];events:{id:string;kind:string;observed_at:number;source_time:number|null;actor:{id?:string;role?:string;name?:string;providerId?:string}|null;evidence:Record<string,unknown>}[]}>(path,revision);
  async function collect(resourceId:string){setBusy(true);setError('');try{const r=await fetch('/api/data/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resourceId})});const result=await r.json();if(!r.ok)throw new Error(result.error);refresh(n=>n+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section className="space-y-3"><h2>Remediation and deployment evidence</h2>
    <p className="text-sm text-muted-foreground">Fix availability, source changes, merge, deployment, and runtime verification are separate facts. Unobserved steps and actors remain unknown.</p>
    {error&&<p role="alert">{error}</p>}
    {!data?.data?<p role="status">{data?.error?'Provenance pilot is disabled or unavailable.':'Loading history…'}</p>:<>
      {administrator&&resources.map(r=><Button key={r.id} size="sm" variant="outline" busy={busy} onClick={()=>void collect(r.id)}>Read deployment history: {r.name}</Button>)}
      {data.data.errors.map(e=><p key={e.resourceId} role="status">{e.error}</p>)}
      {!data.data.events.length&&<p>No collected evidence.</p>}
      <ol className="space-y-3">{data.data.events.map(e=><li key={e.id} className="rounded border border-border p-3"><strong>{({'fix-available':'Fix available','source-no-longer-vulnerable':'No longer vulnerable in source','deployment-reported':'Deployment reported','binding-created':'Source connected'} as Record<string,string>)[e.kind]??e.kind}</strong><p>Observed {new Date(e.observed_at).toLocaleString()} · {e.actor?`${e.actor.role??'Actor'}: ${e.actor.name??e.actor.id??e.actor.providerId??'unknown'}`:'Actor unknown'}</p>{e.source_time&&<p>Provider timestamp: {new Date(e.source_time).toLocaleString()}</p>}<details><summary>Evidence</summary><pre className="max-h-64 overflow-auto text-xs">{JSON.stringify(e.evidence,null,2)}</pre></details></li>)}</ol>
    </>}
  </section>;
}
