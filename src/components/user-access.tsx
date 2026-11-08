import { useEffect, useState } from 'react';
import { AlertDialog } from 'radix-ui';
import { Button } from './ui/button';
import { accessIdentifier, type AccessData, type AccessPerson } from '../lib/user-access';

const field = 'w-full rounded-sm border border-border bg-background px-3 py-2.5 text-foreground';
const label = (person: AccessPerson) => person.login ? `@${person.login}` : person.identifier;
const date = (time: number) => new Date(time).toLocaleString();

export function UserAccess() {
  const [access, setAccess] = useState<AccessData | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [revoke, setRevoke] = useState<AccessPerson | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void fetch('/api/data/users', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 403 ? 'Administrator access required.' : 'Unable to load user access.');
      setAccess(await response.json());
    }).catch(e => { if (!controller.signal.aborted) setError((e as Error).message); });
    return () => controller.abort();
  }, [reload]);
  async function update(action: 'add' | 'remove', value: string) {
    const login = accessIdentifier(value);
    if (!login) { setError('Enter a GitHub handle or valid email address.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/data/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, login }) });
      if (!response.ok) throw new Error(await response.text());
      setAccess(await response.json());
      setNotice(action === 'add' ? `Access granted for ${login}. They can now sign in with GitHub.` : `Access revoked for ${login}.`);
      if (action === 'add') setIdentifier('');
      else setRevoke(null);
    } catch (e) { setError((e as Error).message || 'Unable to update user access.'); }
    finally { setBusy(false); }
  }
  const people = access?.people.filter(person =>
    [person.identifier, person.login, person.name, person.email].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())) &&
    (role === 'all' || person.role === role) &&
    (status === 'all' || (status === 'active' ? person.lastSignIn !== null : person.lastSignIn === null))) ?? [];
  return <section className="mb-6 max-w-[1000px] space-y-6" aria-label="User access">
    {error && !revoke && <p className="text-critical" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!access ? error ? <Button variant="outline" onClick={() => setReload(value => value + 1)}>Try again</Button> : <p role="status">Loading user access…</p> : <>
      <div className="rounded-lg border border-border p-5">
        <h2>Grant access</h2><p className="text-sm text-muted-foreground">Members can view reports, download SBOMs and request scans.</p>
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void update('add', identifier); }}>
          <label className="min-w-[200px] flex-1 text-sm">GitHub handle or email<input className={`${field} mt-1.5`} required maxLength={254} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="@octocat or name@example.com" aria-describedby="access-help" value={identifier} onChange={event => setIdentifier(event.target.value)} /></label>
          <Button type="submit" disabled={busy}>{busy && !revoke ? 'Granting…' : 'Grant access'}</Button>
        </form>
        <p id="access-help" className="mt-3 text-sm text-muted-foreground">Everyone signs in with GitHub. Use an email verified on their GitHub account, including a private email. No invitation is sent.</p>
      </div>
      <div>
        <h2>People <span className="text-sm text-muted-foreground">{access.people.length}</span></h2>
        <div className="my-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <label className="text-sm">Search people<input type="search" className={`${field} mt-1.5`} placeholder="Name, handle or email" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <label className="text-sm">Role<select className={`${field} mt-1.5`} value={role} onChange={event => setRole(event.target.value)}><option value="all">All roles</option><option>Administrator</option><option>Member</option></select></label>
          <label className="text-sm">Status<select className={`${field} mt-1.5`} value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="active">Has signed in</option><option value="pending">Awaiting first sign-in</option></select></label>
        </div>
        <ul aria-label="People with access" className="divide-y divide-border">
          {people.map(person => <li key={person.identifier} className="flex flex-wrap items-center gap-3 py-4">
            {person.image ? <img className="size-10 rounded-full" src={person.image} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-sunken text-muted-foreground">{(person.name || person.identifier).slice(0, 1).toUpperCase()}</span>}
            <div className="min-w-0 flex-1 basis-48 break-words"><p className="font-medium">{person.name || label(person)}</p><p className="text-sm text-muted-foreground">{person.name && `${label(person)} · `}{person.email || (person.identifier.includes('@') ? person.identifier : 'Profile available after sign-in')}</p>
              {person.identifier.includes('@') && person.email && person.email.toLowerCase() !== person.identifier && <p className="text-xs text-muted-foreground">Granted via {person.identifier}</p>}
              <p className="mt-1 text-xs text-muted-foreground">{person.lastSignIn ? `Last GitHub sign-in: ${date(person.lastSignIn)}` : 'Awaiting first sign-in'}</p></div>
            <span className="rounded-md bg-sunken px-2 py-1 text-xs">{person.role}</span>
            {person.role === 'Member' ? <Button variant="ghost" size="sm" disabled={busy} aria-label={`Revoke access for ${label(person)}`} onClick={() => { setError(''); setRevoke(person); }}>Revoke access</Button> : <span className="text-xs text-muted-foreground">Managed in deployment</span>}
          </li>)}
        </ul>
        {!people.length && <p className="py-6 text-muted-foreground" role="status">No people match these filters.</p>}
      </div>
      <div className="border-t border-border pt-5"><h2>Access history</h2><p className="text-sm text-muted-foreground">The latest 100 changes, recorded from this update onward.</p>
        <ol className="mt-3 divide-y divide-border">{access.history.map(event => <li key={event.seq} className="py-3 text-sm"><p><strong>@{event.actor}</strong> {event.action === 'matched' ? 'matched their GitHub account to' : `${event.action} access for`} <span className="break-all">{event.identifier}</span></p><time className="text-xs text-muted-foreground" dateTime={new Date(event.time).toISOString()}>{date(event.time)}</time></li>)}</ol>
        {!access.history.length && <p className="mt-3 text-sm text-muted-foreground">No access changes recorded yet.</p>}
      </div>
    </>}
    <AlertDialog.Root open={revoke !== null} onOpenChange={open => { if (!open && !busy) setRevoke(null); }}>
      <AlertDialog.Portal><AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/55" /><AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-raised p-6 shadow-lg">
        <AlertDialog.Title className="text-lg font-semibold">Revoke access for {revoke && label(revoke)}?</AlertDialog.Title>
        <AlertDialog.Description className="mt-3 text-sm text-muted-foreground">They will lose access immediately and their sessions will end. All known access entries for this GitHub account will be removed. You can grant access again later.</AlertDialog.Description>
        {error && <p className="mt-3 text-critical" role="alert">{error}</p>}
        <div className="mt-6 flex justify-end gap-3"><AlertDialog.Cancel asChild><Button variant="outline" disabled={busy}>Cancel</Button></AlertDialog.Cancel><Button disabled={busy} onClick={() => { if (revoke) void update('remove', revoke.identifier); }}>{busy ? 'Revoking…' : 'Revoke access'}</Button></div>
      </AlertDialog.Content></AlertDialog.Portal>
    </AlertDialog.Root>
  </section>;
}
