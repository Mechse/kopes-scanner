import { useEffect, useState } from 'react';
import { Button } from './ui/button';

type Access = { admin: string; users: string[] };
export function UserAccess() {
  const [access, setAccess] = useState<Access | null>(null);
  const [login, setLogin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/data/users', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 403 ? 'Administrator access required.' : 'Unable to load user access.');
      setAccess(await response.json());
    }).catch(e => { if (!controller.signal.aborted) setError((e as Error).message); });
    return () => controller.abort();
  }, []);
  async function update(action: 'add' | 'remove', username: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/data/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, login: username }) });
      if (!response.ok) throw new Error(await response.text());
      setAccess(await response.json());
      if (action === 'add') setLogin('');
    } catch (e) { setError((e as Error).message || 'Unable to update user access.'); }
    finally { setBusy(false); }
  }
  return <section className="mb-6 max-w-[740px] [&_li]:flex [&_li]:min-h-12 [&_li]:items-center [&_li]:justify-between [&_li]:gap-3 [&_li]:border-b [&_li]:border-border [&_li]:py-2" aria-label="User access">

    {error && <p className="text-critical" role="alert">{error}</p>}
    {access ? <><h2>Grant access</h2><p className="text-muted-foreground">Members can view reports, download SBOMs and request scans.</p>
      <form className="flex flex-wrap items-end gap-3 border-b border-border pt-4 pb-6" onSubmit={event => { event.preventDefault(); void update('add', login); }}>
        <label className="min-w-[180px] flex-1">GitHub username<input className="mt-1.5 w-full rounded-sm border border-border bg-background px-3 py-2.5 text-foreground" required maxLength={39} pattern="[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?" autoComplete="off" placeholder="octocat" value={login} onChange={event => setLogin(event.target.value)} /></label>
        <Button type="submit" disabled={busy}>Grant access</Button>
      </form>
      <h2>People <span className="rounded-[5px] bg-sunken px-[7px] py-px text-xs text-muted-foreground">{access.users.length + 1}</span></h2>
      <ul aria-label="People with access"><li><strong>@{access.admin}</strong><span className="text-xs text-muted-foreground" title="Configured in your deployment environment">Administrator</span></li>{access.users.map(user => <li key={user}><span>@{user}</span><Button variant="ghost" size="sm" disabled={busy} aria-label={`Revoke access for ${user}`} onClick={() => { void update('remove', user); }}>Revoke access</Button></li>)}</ul>
      {!access.users.length && <p className="text-muted-foreground" role="status">Only the administrator has access.</p>}
    </> : !error && <p role="status">Loading user access…</p>}
  </section>;
}
