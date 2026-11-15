import { useState } from 'react';
import { useResource } from '../lib/use-resource';
import type { GithubSettingsData } from '../lib/github';
import { Button } from './ui/button';
const field = 'mt-1 block w-full rounded border border-border bg-background px-3 py-2 text-sm';
export function RepositoryConnectionSelector({initial='',repository=true}:{initial?:string;repository?:boolean}) {
  const settings = useResource<GithubSettingsData>('github',0), [selected,setSelected] = useState(initial), [page,setPage] = useState(1);
  const connection = settings?.data?.connections.find(c=>c.id===selected);
  const picker = useResource<{repositories:{repository_id:string;name:string;private:number}[];hasMore:boolean}>(repository && connection?.auth_kind==='github_app'?`github-repositories?connectionId=${encodeURIComponent(selected)}&page=${page}`:'',0);
  return <>
    <label className="block text-sm">Repository connection<select className={field} name="connectionId" value={selected} onChange={e=>{setSelected(e.target.value);setPage(1);}}>
      <option value="">{repository?'Public repository (anonymous)':'Keep current connection'}</option>
      {settings?.data?.connections.filter(c=>!c.disconnected).map(c=><option key={c.id} value={c.id}>{c.label||c.owner_login||'Legacy connection'} · {c.auth_kind==='github_app'?'GitHub App':'PAT'}</option>)}
    </select></label>
    {settings?.error && <p role="alert" className="text-sm">{settings.error}</p>}
    {repository && (connection?.auth_kind==='github_app'?<>
      <label className="block text-sm">Repository<select key={`${selected}:${page}`} className={field} name="repository" required defaultValue=""><option value="">Select an accessible repository</option>{picker?.data?.repositories.map(r=><option key={r.repository_id} value={r.name}>{r.name}{r.private?' · Private':''}</option>)}</select></label>
      {picker?.error && <p role="alert" className="text-sm">{picker.error}</p>}
      <div className="flex gap-2"><Button type="button" variant="ghost" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</Button><span className="p-2 text-sm">Page {page}</span><Button type="button" variant="ghost" disabled={!picker?.data?.hasMore} onClick={()=>setPage(p=>p+1)}>Next</Button></div>
    </>:<label className="block text-sm">Repository URL<input className={field} name="repository" placeholder="https://github.com/owner/repository" required maxLength={300}/></label>)}
  </>;
}
