import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { useResource } from '../lib/use-resource';
import { useWorkspace } from './app-shell';
import { Button } from './ui/button';
import { ContentSkeleton } from './ui/loading';

type Connection = { url: string; hasToken: boolean; enabled: boolean; source: string };
const fieldClass = 'mt-2 w-full rounded-md border border-border bg-raised px-3 py-2 text-sm';

export function CoolifySettings() {
  const { revision, refresh } = useWorkspace();
  const result = useResource<Connection>('coolify', revision);
  const [saved, setSaved] = useState<Connection | null>(null);
  const data = saved ?? result?.data;
  const [url, setUrl] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  function edit() { setMessage(''); setError(''); }
  async function submit(action: 'save' | 'test' | 'disconnect') {
    setBusy(action); edit();
    try {
      const response = await fetch('/api/data/coolify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, url: url ?? data?.url ?? '', token }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not update the Coolify connection.');
      if (action === 'test') {
        setMessage(`Connection successful. Found ${body.counts.applications} applications, ${body.counts.services} services and ${body.counts.databases} databases. Testing does not save changes.`);
      } else {
        setSaved(body); setUrl(null); setToken(''); refresh();
        setMessage(action === 'save' ? 'Connection saved. Names will update on the next inventory refresh.' : 'Coolify disconnected. Docker scanning will continue.');
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not connect to Coolify.'); }
    finally { setBusy(''); }
  }
  return <section className="max-w-2xl py-6" aria-labelledby="app-settings-heading">
    <h1 id="app-settings-heading" className="text-xl font-medium tracking-tight">Settings</h1>
    <div className="mt-6 border-b border-border pb-6">
      <Button asChild variant="outline"><Link to="/settings/users"><Users aria-hidden="true" />User access</Link></Button>
      <p className="mt-2 text-sm text-muted-foreground">Manage who can sign in and access the workspace.</p>
    </div>
    <h2 className="mt-6 text-base font-medium">Coolify connection</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">Show the app names from Coolify automatically. Create an API token with read permission in Coolify’s Keys &amp; Tokens, and enable API access.</p>
    {result?.error && <p role="alert" className="mt-4 text-sm text-critical">{result.error}</p>}
    {!data ? !result?.error && <ContentSkeleton label="Loading Coolify connection…" layout="settings" /> : <form className="mt-5" onSubmit={event => { event.preventDefault(); if (!busy) void submit('save'); }}>
      <p className="mb-4 text-xs text-muted-foreground">{data.enabled ? `Connection configured${data.source === 'environment' ? ' through deployment settings' : ''}. Use Test connection to check access.` : 'No Coolify connection configured.'}</p>
      <fieldset disabled={!!busy} className="space-y-4">
        <label className="block text-sm" htmlFor="coolify-url">Coolify URL
          <input id="coolify-url" type="url" required placeholder="https://coolify.example.com" value={url ?? data.url} onChange={event => { setUrl(event.target.value); edit(); }} className={fieldClass} autoComplete="url" aria-describedby="coolify-url-help" />
        </label>
        <p id="coolify-url-help" className="text-xs text-muted-foreground">Use the address where you open Coolify, without /api/v1.</p>
        <label className="block text-sm" htmlFor="coolify-token">API token
          <input id="coolify-token" type="password" value={token} onChange={event => { setToken(event.target.value); edit(); }} className={fieldClass} autoComplete="new-password" spellCheck={false} placeholder={data.hasToken ? 'Token saved — leave blank to keep it' : 'Paste your read-only API token'} aria-describedby="coolify-token-help" />
        </label>
        <p id="coolify-token-help" className="text-xs text-muted-foreground">The token is stored encrypted and is never displayed again. Changing the URL requires a new token.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={busy === 'save'}>Save connection</Button>
          <Button type="button" variant="outline" busy={busy === 'test'} onClick={() => void submit('test')}>Test connection</Button>
          {data.enabled && <Button type="button" variant="ghost" busy={busy === 'disconnect'} onClick={() => void submit('disconnect')}>Disconnect</Button>}
        </div>
      </fieldset>
      {message && <p role="status" className="mt-4 text-sm">{message}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-critical">{error}</p>}
    </form>}
  </section>;
}
