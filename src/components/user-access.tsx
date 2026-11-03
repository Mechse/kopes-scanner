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
      if (!response.ok) throw new Error('Unable to load user access.');
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
  return <details className="user-access"><summary>User access</summary>
    <p className="muted">Allowed users can view reports, download SBOMs and request scans. Only the administrator manages access.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {access ? <><p>Administrator: <strong>@{access.admin}</strong> · configured in Coolify or your deployment environment.</p>
      <form className="user-access-form" onSubmit={event => { event.preventDefault(); void update('add', login); }}>
        <label className="search">GitHub username<input required maxLength={39} pattern="[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?" autoComplete="off" placeholder="octocat" value={login} onChange={event => setLogin(event.target.value)} /></label>
        <Button type="submit" disabled={busy}>Grant access</Button>
      </form>
      <ul aria-label="Allowed GitHub users">{access.users.map(user => <li key={user}><span>@{user}</span><Button variant="ghost" size="sm" disabled={busy} aria-label={`Revoke access for ${user}`} onClick={() => { void update('remove', user); }}>Revoke access</Button></li>)}</ul>
      {!access.users.length && <p className="muted" role="status">Only the administrator has access.</p>}
    </> : !error && <p role="status">Loading user access…</p>}
  </details>;
}
