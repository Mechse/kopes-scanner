import { useResource } from '../lib/use-resource';
export function ProjectHistory({ projectId }: { projectId: string }) {
  const path=`provenance?projectId=${encodeURIComponent(projectId)}`;
  const data=useResource<{events:{id:string;kind:string;observed_at:number;source_time:number|null;actor:{id?:string;role?:string;name?:string;providerId?:string}|null;evidence:Record<string,unknown>}[]}>(path,0);
  return <section className="space-y-3"><h2>Remediation and deployment evidence</h2>
    <p className="text-sm text-muted-foreground">Fix availability, source changes, merge, deployment, and runtime verification are separate facts. Unobserved steps and actors remain unknown.</p>
    {!data?.data?<p role="status">{data?.error?'Provenance pilot is disabled or unavailable.':'Loading history…'}</p>:<>
      {!data.data.events.length&&<p>No collected evidence.</p>}
      <ol className="space-y-3">{data.data.events.map(e=><li key={e.id} className="rounded border border-border p-3"><strong>{({'fix-available':'Fix available','source-no-longer-vulnerable':'No longer vulnerable in source','deployment-reported':'Deployment reported','binding-created':'Source connected'} as Record<string,string>)[e.kind]??e.kind}</strong><p>Observed {new Date(e.observed_at).toLocaleString()} · {e.actor?`${e.actor.role??'Actor'}: ${e.actor.name??e.actor.id??e.actor.providerId??'unknown'}`:'Actor unknown'}</p>{e.source_time&&<p>Provider timestamp: {new Date(e.source_time).toLocaleString()}</p>}<details><summary>Evidence</summary><pre className="max-h-64 overflow-auto text-xs">{JSON.stringify(e.evidence,null,2)}</pre></details></li>)}</ol>
    </>}
  </section>;
}
