import { SelectField } from './ui/select-field';
import { SelectItem } from './ui/select';
import { useState } from 'react';
import { useResource } from '../lib/use-resource';
import type { GithubSettingsData } from '../lib/github';
export function RepositoryConnectionSelector() {
  const settings = useResource<GithubSettingsData>('github',0);
  const [selected, setSelected] = useState('anonymous');
  return <>
    <label className="block text-sm">Repository connection<SelectField aria-label="Repository connection" className="mt-1 w-full" name="connectionId" value={selected} onValueChange={setSelected}>
      <SelectItem value="anonymous">Keep current connection</SelectItem>
      {settings?.data?.connections.filter(c=>!c.disconnected).map(c=><SelectItem key={c.id} value={c.id}>{c.label||c.owner_login||'GitHub connection'} · {c.auth_kind==='github_app'?'GitHub App':'PAT'}</SelectItem>)}
    </SelectField></label>
    {settings?.error && <p role="alert" className="text-sm">{settings.error}</p>}
  </>;
}
