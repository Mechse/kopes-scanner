import { ContentSkeleton } from "./ui/loading";
import { useEffect, useRef, useState } from 'react';
import { AlertDialog, Dialog } from 'radix-ui';
import { ChevronRight, SlidersHorizontal, UserPlus, X } from 'lucide-react';
import { SearchToolbar } from './search-toolbar';
import { FindingsSearch } from './findings-search';
import { Select } from './ui/filters';
import { pillClass } from './ui/pill';
import { Button } from './ui/button';
import { accessIdentifier, type AccessData, type AccessPerson } from '../lib/user-access';

const field = 'w-full rounded-sm border border-border bg-background px-3 py-2.5 text-foreground';
const label = (person: AccessPerson) => person.login ? (person.login.includes('@') ? person.login : `@${person.login}`) : person.identifier;
const date = (time: number) => new Date(time).toLocaleString();

export function UserAccess() {
  const [access, setAccess] = useState<AccessData | null>(null);
  const identifierInput = useRef<HTMLInputElement>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
      if (action === 'add') { setIdentifier(''); setGrantOpen(false); }
      else setRevoke(null);
    } catch (e) { setError((e as Error).message || 'Unable to update user access.'); }
    finally { setBusy(false); }
  }
  const people = access?.people.filter(person =>
    [person.identifier, person.login, person.name, person.email].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())) &&
    (role === 'all' || person.role === role) &&
    (status === 'all' || (status === 'active' ? person.lastSignIn !== null : person.lastSignIn === null))) ?? [];
  const filterCount = Number(role !== 'all') + Number(status !== 'all');
  const filtered = !!query.trim() || filterCount > 0;
  return <section className="mb-6" aria-label="User access">
    <Dialog.Root open={grantOpen} onOpenChange={open => { if (!busy) { setGrantOpen(open); setError(''); if (open) setNotice(''); } }}>
      <SearchToolbar>
        <FindingsSearch label="Search people" value={query} onChange={setQuery} />
        <Button variant="outline" size="sm" aria-expanded={filtersOpen} aria-controls="people-filters" onClick={() => setFiltersOpen(open => !open)}>
          <SlidersHorizontal aria-hidden="true" />Filters{filterCount > 0 && <span className={pillClass}>{filterCount}</span>}
        </Button>
        <Dialog.Trigger asChild><Button size="sm" disabled={!access || busy}><UserPlus aria-hidden="true" />Grant access</Button></Dialog.Trigger>
      </SearchToolbar>
      {filtersOpen && <div id="people-filters" className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Select label="Filter by role" value={role} options={['all', 'Administrator', 'Member']} display={value => value === 'all' ? 'All roles' : value} onValueChange={setRole} />
        <Select label="Filter by sign-in status" value={status} options={['all', 'active', 'pending']} display={value => value === 'all' ? 'All statuses' : value === 'active' ? 'Has signed in' : 'Awaiting first sign-in'} onValueChange={setStatus} />
        {filterCount > 0 && <Button variant="ghost" size="sm" onClick={() => { setRole('all'); setStatus('all'); }}>Reset filters</Button>}
      </div>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content onOpenAutoFocus={event => { event.preventDefault(); identifierInput.current?.focus(); }} className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-32px)] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-raised p-6 shadow-lg">
          <Dialog.Title className="pr-8 text-lg font-semibold">Grant access</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">Members can view reports, download SBOMs and request scans.</Dialog.Description>
          <Dialog.Close asChild><Button variant="ghost" size="icon" className="absolute top-3 right-3" aria-label="Close grant access" disabled={busy}><X aria-hidden="true" /></Button></Dialog.Close>
          <form className="mt-5" onSubmit={event => { event.preventDefault(); void update('add', identifier); }}>
            <label className="block text-sm">GitHub handle or email<input ref={identifierInput} className={`${field} mt-1.5`} required disabled={busy} maxLength={254} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="@octocat or name@example.com" aria-describedby="access-help" value={identifier} onChange={event => setIdentifier(event.target.value)} /></label>
            <p id="access-help" className="mt-3 text-xs leading-relaxed text-muted-foreground">Use an email address for Google or Microsoft, or a GitHub handle or verified email for GitHub. No invitation is sent. Microsoft users verify their email when first signing in.</p>
            {error && <p className="mt-3 text-sm text-critical" role="alert">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Dialog.Close asChild><Button variant="outline" disabled={busy}>Cancel</Button></Dialog.Close>
              <Button type="submit" busy={busy} disabled={busy}>{busy ? 'Granting…' : 'Grant access'}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    {error && !revoke && !grantOpen && <p className="my-4 text-sm text-critical" role="alert">{error}</p>}
    {notice && <p className="my-4 rounded-md border border-border bg-sunken px-3 py-2 text-sm" role="status">{notice}</p>}
    {!access ? error ? <Button variant="outline" onClick={() => setReload(value => value + 1)}>Try again</Button> : <ContentSkeleton label="Loading user access…" /> : <>
      <div>
        <div className="mb-2 flex items-center gap-2"><h2 className="my-0!">People</h2><span className={pillClass}>{filtered ? `${people.length} of ${access.people.length}` : access.people.length}</span></div>
        <div className="overflow-x-auto" role="region" aria-label="People list" tabIndex={0}>
        <ul aria-label="People with access" className="min-w-[720px] divide-y divide-border/60">
          {people.map(person => <li key={person.identifier} className="flex items-center gap-3 whitespace-nowrap px-3 py-2.5 hover:bg-sunken/50">
            {person.image ? <img className="size-8 shrink-0 rounded-full" src={person.image} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sunken text-muted-foreground">{(person.name || person.identifier).slice(0, 1).toUpperCase()}</span>}
            <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
              <span className="min-w-0 truncate font-medium" title={person.name || label(person)}>{person.name || label(person)}</span>
              {(person.name || (person.email && person.email !== person.identifier)) && <span className="min-w-0 truncate text-xs text-muted-foreground" title={person.name ? label(person) : person.email || undefined}>{person.name ? label(person) : person.email}</span>}
              {person.identifier.includes('@') && person.email && person.email.toLowerCase() !== person.identifier && <span className="min-w-0 truncate text-xs text-muted-foreground" title={`Granted via ${person.identifier}`}>Granted via {person.identifier}</span>}
            </div>
            <div className="w-36 shrink-0 text-xs text-muted-foreground">
              {person.lastSignIn !== null ? <time dateTime={new Date(person.lastSignIn).toISOString()} title={`Last sign-in: ${date(person.lastSignIn)}`}>Signed in {new Date(person.lastSignIn).toLocaleDateString()}</time> : <span>Awaiting first sign-in</span>}
            </div>
            <span className={pillClass}>{person.role}</span>
            <div className="flex w-36 shrink-0 justify-end">
              {person.role === 'Member' ? <Button variant="ghost" size="sm" disabled={busy} aria-label={`Revoke access for ${label(person)}`} onClick={() => { setError(''); setRevoke(person); }}>Revoke access</Button> : <span className="text-xs text-muted-foreground" title="Administrator access is managed in sign-in settings or the deployment configuration">Managed in sign-in settings</span>}
            </div>
          </li>)}
        </ul>
        </div>
        {!people.length && <div className="rounded-lg border border-dashed border-border px-4 py-7 text-sm text-muted-foreground">
          <p role="status">{filtered ? 'No people match your search or filters.' : 'No people have access yet.'}</p>
          {filtered ? <Button className="mt-3" variant="outline" size="sm" onClick={() => { setQuery(''); setRole('all'); setStatus('all'); }}>Clear search and filters</Button> : <Button className="mt-3" variant="outline" size="sm" onClick={() => { setError(''); setGrantOpen(true); }}>Grant access</Button>}
        </div>}
      </div>
      <details className="group mt-6 border-t border-border">
        <summary className="flex items-center gap-2 rounded-sm py-4 text-sm font-medium hover:text-brand-ink [&::-webkit-details-marker]:hidden"><ChevronRight size={15} aria-hidden="true" className="transition-transform group-open:rotate-90 motion-reduce:transition-none" />Access history<span className={pillClass}>{access.history.length}</span></summary>
        <p className="text-xs text-muted-foreground">Latest 100 access changes.</p>
        <ol className="mt-2 divide-y divide-border/60">{access.history.map(event => <li key={event.seq} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm"><p className="min-w-0 break-words"><span className="font-medium">{event.actor.includes('@') ? event.actor : `@${event.actor}`}</span> {event.action === 'matched' ? 'matched their account to' : `${event.action} access for`} <span className="break-all">{event.identifier}</span></p><time className="shrink-0 text-xs text-muted-foreground" dateTime={new Date(event.time).toISOString()}>{date(event.time)}</time></li>)}</ol>
        {!access.history.length && <p className="py-3 text-sm text-muted-foreground">No access changes recorded yet.</p>}
      </details>
    </>}
    <AlertDialog.Root open={revoke !== null} onOpenChange={open => { if (!open && !busy) setRevoke(null); }}>
      <AlertDialog.Portal><AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/55" /><AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-raised p-6 shadow-lg">
        <AlertDialog.Title className="text-lg font-semibold">Revoke access for {revoke && label(revoke)}?</AlertDialog.Title>
        <AlertDialog.Description className="mt-3 text-sm text-muted-foreground">They will lose access immediately and their sessions will end. All known access entries for this account will be removed. You can grant access again later.</AlertDialog.Description>
        {error && <p className="mt-3 text-critical" role="alert">{error}</p>}
        <div className="mt-6 flex justify-end gap-3"><AlertDialog.Cancel asChild><Button variant="outline" disabled={busy}>Cancel</Button></AlertDialog.Cancel><Button busy={busy} disabled={busy} onClick={() => { if (revoke) void update('remove', revoke.identifier); }}>{busy ? 'Revoking…' : 'Revoke access'}</Button></div>
      </AlertDialog.Content></AlertDialog.Portal>
    </AlertDialog.Root>
  </section>;
}
