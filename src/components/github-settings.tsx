import { SelectField } from './ui/select-field';
import { SelectItem } from './ui/select';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { AlertDialog } from 'radix-ui';
import { ContentSkeleton } from './ui/loading';
import { ChevronRight, Plus } from 'lucide-react';
import { FindingsSearch } from './findings-search';
import { SearchToolbar } from './search-toolbar';
import { pillClass } from './ui/pill';
import { useResource } from '../lib/use-resource';
import type { GithubSettingsData, GithubConnection, GithubAppView } from '../lib/github';
import { githubAccessStatus, githubAppStatus, githubConnectionGroups, githubSetupNotices, type GithubSetupNotice } from '../lib/github';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Button } from './ui/button';
import { useWorkspace } from './app-shell';

const field = 'mt-2 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
async function githubPost(body: unknown) {
  const response = await fetch('/api/data/github',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'GitHub operation failed.'); return result;
}
const githubSearch = { tab: 'integrations', section: 'github' };
function ConnectionStatus({ label, children }: { label: string; children?: ReactNode }) {
  return <section aria-label="Connection status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-4 py-3">
    <div>
      <h3 className="text-xs text-muted-foreground">Connection status</h3>
      <p className="mt-1 flex items-center gap-2 font-medium" role="status">
        <span aria-hidden="true" className={`size-2 rounded-full ${label === 'Connected' ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
        {label}
      </p>
    </div>
    {children}
  </section>;
}
function ManagementRow({ name, owner, status, count, selection }: { name: string; owner: string; status: string; count: number; selection: string }) {
  return <li>
    <Link to="/settings" search={{ ...githubSearch, connection: selection }}
      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-3 text-sm hover:bg-sunken/50 focus-visible:outline-brand-ink sm:grid-cols-[minmax(0,1fr)_8rem_9rem_auto]">
      <span className="col-start-1 row-start-1 min-w-0 break-words font-medium">
        {name}
        {owner && <span className="block text-xs font-normal text-muted-foreground">{owner}</span>}
      </span>
      <span className="col-start-1 row-start-2 text-xs text-muted-foreground sm:col-start-2 sm:row-start-1">{count} {count === 1 ? 'repository' : 'repositories'}</span>
      <span className={`${pillClass} col-start-2 row-start-1 justify-self-start capitalize sm:col-start-3`}>{status.replaceAll('-', ' ')}</span>
      <ChevronRight size={14} aria-hidden="true" className="col-start-3 row-start-1 text-muted-foreground sm:col-start-4" />
    </Link>
  </li>;
}
function ConnectionRow({ c }: { c: GithubConnection }) {
  return <ManagementRow selection={`connection:${c.id}`} name={c.label || c.owner_login || 'GitHub connection'} owner={[c.auth_kind==='pat'?'Fine-grained PAT':'App installation', c.owner_login].filter(Boolean).join(' · ')} count={c.repository_count} status={githubAccessStatus(c)} />;
}

export function GithubSettings({setupNotice, selection}: {setupNotice?: GithubSetupNotice; selection?: string}) {
  const {revision,refresh} = useWorkspace(), result = useResource<GithubSettingsData>('github',revision,15000);
  const [mode,setMode] = useState<'app'|'pat'|'import'|null>(null), [editing,setEditing] = useState<GithubConnection|null>(null), [app,setApp] = useState<GithubAppView|null>(null);
  const [busy,setBusy] = useState(false), [message,setMessage] = useState(''), [error,setError] = useState('');
  const [manifest,setManifest] = useState<{action:string;manifest:object}|null>(null);
  const [owner,setOwner] = useState(''), [history,setHistory] = useState(false);
  async function run(body: unknown) {
    setBusy(true); setError(''); setMessage('');
    try { const data = await githubPost(body); refresh(); if(data.url) window.location.assign(data.url); return data; }
    catch(e) { setError((e as Error).message); return null; } finally { setBusy(false); }
  }
  function open(next: typeof mode, connection: GithubConnection|null = null, app: GithubAppView|null = null) {setMode(next);setEditing(connection);setApp(app);setOwner(connection?.owner_login ?? app?.owner_login ?? '');setHistory(!!(connection?.history ?? app?.history));setError('');setMessage('');setManifest(null);}
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, f = new FormData(form), text = (name:string)=>String(f.get(name)??'');
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
    if(mode==='app') {
      const data = await run({action:'start',owner,ownerType:text('ownerType'),history,webhookMode:text('webhookMode')}); if(data) setManifest(data);
    } else if(mode==='pat') {
      const data = await run({action:action==='test-pat'?'test-pat':'save-pat',...(editing?{connectionId:editing.id}:{}),label:text('label'),owner,token:text('token'),repository:text('repository'),history,expiresAt:text('expiry')?Date.parse(text('expiry')):null});
      if(data) {setMessage(`${data.privateVerified?'Private repository reads verified':'Private access not verified'} · ${data.readiness}. ${data.historyAvailable?'PR history available.':history?'PR history unavailable; dependency scanning remains available.':''}`); if(action!=='test-pat') {form.reset();setMode(null);setEditing(null);}}
    } else {
      const data = await run({action:'import-app',...(app?{appId:app.id}:{}),githubId:text('githubId'),clientId:text('clientId'),owner,ownerType:text('ownerType'),privateKey:text('privateKey'),clientSecret:text('clientSecret'),webhookSecret:text('webhookSecret'),history,webhookMode:text('webhookMode'),urlsConfirmed:f.has('urlsConfirmed')});
      if(data) {form.reset();setMode(null);setApp(null);setMessage('App credentials verified and saved.');}
    }
  }
  const [query, setQuery] = useState('');
  const [copyFeedback, setCopyFeedback] = useState({key:'', text:''});
  async function copyUrl(key: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopyFeedback({key, text:'Copied'});
    } catch {
      setCopyFeedback({key, text:'Copy unavailable. Select the URL and copy it manually.'});
    }
  }
  const groups = result?.data && githubConnectionGroups(result.data, query);
  const a = result?.data?.apps.find(item => selection === `app:${item.id}`);
  const c = result?.data?.connections.find(item => selection === `connection:${item.id}`);
  const parent = c && result?.data?.apps.find(item => item.id === c.app_id);
  const installations = a ? result?.data?.connections.filter(item => item.app_id === a.id) ?? [] : [];
  const appStatus = a && githubAppStatus(a, installations);
  const statusLabel = c ? githubAccessStatus(c) : appStatus?.label;
  function accessDetails(c: GithubConnection) {
    return <section key={c.id} className="border-t border-border/60 py-3">
      <h3 className="font-medium">Repository access</h3>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-sm [&_dt]:text-muted-foreground">
        <dt>Linked repositories</dt><dd>{c.repository_count}</dd>
        <dt>Permissions</dt><dd>{c.history?'Contents and PR history':'Contents read'}</dd>
        <dt>Last successful check</dt><dd>{c.validated_at?new Date(c.validated_at).toLocaleString():'Not yet validated'}</dd>
        {c.auth_kind==='pat' && <><dt>Token expiry</dt><dd>{c.expires_at?`${new Date(c.expires_at).toLocaleDateString()} (user supplied)`:'Unknown'}</dd></>}
      </dl>
    </section>;
  }
  const hasConnections = !!(result?.data?.apps.length || result?.data?.connections.length);
  const addConnection = <DropdownMenu>
    <DropdownMenuTrigger asChild><Button size="sm"><Plus aria-hidden="true" />Add connection</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => open('app')}>Create a GitHub App</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => open('import')}>Reconnect an existing App</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => open('pat')}>Use a personal access token</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
  const tokenUrl = `https://github.com/settings/personal-access-tokens/new?${new URLSearchParams({name:'Kopes Scanner',target_name:owner,expires_in:'90',contents:'read',...(history?{pull_requests:'read'}:{})})}`;
  return <section className="max-w-2xl py-6 text-sm" aria-labelledby="github-heading">
    {selection && <nav aria-label="Connection navigation" className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Link to="/settings" search={githubSearch} className="hover:underline">GitHub connections</Link>{parent && <><ChevronRight size={12}/><Link to="/settings" search={{...githubSearch,connection:`app:${parent.id}`}} className="hover:underline">{parent.slug || parent.owner_login}</Link></>}</nav>}
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="github-heading" className="m-0! break-words text-base font-medium">{a ? a.slug || a.owner_login : c ? c.label || c.owner_login || 'GitHub connection' : selection ? 'Connection details' : 'GitHub connections'}</h2>
      {!selection && !mode && hasConnections && addConnection}
    </div>
    {(a || c) && <p className="mt-1 text-xs text-muted-foreground">{a ? 'GitHub App' : c?.auth_kind==='pat' ? 'Fine-grained PAT' : 'App installation'} · {a?.owner_login || c?.owner_login}</p>}
    {!mode && statusLabel && <ConnectionStatus label={statusLabel}>
      {a && appStatus?.action && <Button size="sm" variant="outline" disabled={busy} onClick={()=>void run({action:'resume',appId:a.id})}>{appStatus.action}</Button>}
    </ConnectionStatus>}
    {(error || result?.error) && <p role="alert" className="mt-3 text-sm text-critical">{error || result?.error}</p>}
    {setupNotice && <p role="alert" className="mt-3 text-sm text-critical">{githubSetupNotices[setupNotice]}</p>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    {manifest ? <form method="post" action={manifest.action} className="mt-5 rounded border border-border p-4"><input type="hidden" name="manifest" value={JSON.stringify(manifest.manifest)}/><p className="mb-3 text-sm">Continue on GitHub to create your private App. Return in this browser session within 30 minutes.</p><div className="flex gap-2"><Button>Continue on GitHub</Button><Button type="button" variant="ghost" onClick={()=>open(null)}>Cancel</Button></div></form> : mode && <form key={`${mode}:${editing?.id}:${app?.id}`} onSubmit={submit} className="mt-5 rounded border border-border p-4">
      <fieldset disabled={busy} className="space-y-4">
        <legend className="mb-3 font-medium">{mode==='app'?'Register a private App':mode==='pat'?editing?'Replace personal access token':'Fine-grained personal access token':app?'Update App credentials':'Import App credentials'}</legend>
        {mode==='pat' && <label className="block text-sm">Connection name<input className={field} name="label" defaultValue={editing?.label??''} required maxLength={120}/></label>}
        <label className="block text-sm">GitHub username or organization<input className={field} value={owner} onChange={e=>setOwner(e.target.value)} required maxLength={80} placeholder="octocat"/></label>
        {mode!=='pat' && <label className="block text-sm">Account type<SelectField aria-label="Account type" className="mt-1 w-full" name="ownerType" defaultValue={app?.owner_type??'User'}><SelectItem value="User">Personal account</SelectItem><SelectItem value="Organization">Organization</SelectItem></SelectField></label>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={history} onChange={e=>setHistory(e.target.checked)}/>Include pull request and review history (read only)</label>
        {mode==='pat' ? <>
          <a className="block text-sm underline" href={tokenUrl} target="_blank" rel="noreferrer">Create a fine-grained, read-only token on GitHub</a>
          <p className="text-xs text-muted-foreground">Grant read-only Contents access to the repositories you want to scan. Your organization may need to approve the token.</p>
          <label className="block text-sm">Token<input className={field} type="password" name="token" autoComplete="new-password" required={!editing} placeholder={editing?'Leave blank to retain the saved token':''}/></label>
          <label className="block text-sm">Private repository URL for validation<input className={field} name="repository" required defaultValue={editing?.validation_repository??''} placeholder="https://github.com/owner/private-repository"/></label>
          <label className="block text-sm">Token expiry (optional)<input className={field} type="date" name="expiry" defaultValue={editing?.expires_at?new Date(editing.expires_at).toISOString().slice(0,10):''}/></label>
        </> : <label className="block text-sm">Change detection<SelectField aria-label="Change detection" name="webhookMode" className="mt-1 w-full" defaultValue={app?.webhook_mode??'polling'}><SelectItem value="polling">Polling</SelectItem><SelectItem value="webhook">Webhooks and polling (requires public HTTPS)</SelectItem></SelectField></label>}
        {mode==='import' && <>
          <label className="block text-sm">GitHub App ID<input name="githubId" className={field} required defaultValue={app?.github_id??''}/></label>
          <label className="block text-sm">Client ID<input name="clientId" className={field} required defaultValue={app?.client_id??''}/></label>
          <label className="block text-sm">Private key (PEM)<textarea name="privateKey" className={`${field} font-mono`} required={!app} autoComplete="off" placeholder={app?'Leave blank to retain saved key':''}/></label>
          <label className="block text-sm">Client secret<input type="password" name="clientSecret" className={field} required={!app} autoComplete="new-password" placeholder={app?'Leave blank to retain saved secret':''}/></label>
          <label className="block text-sm">Webhook secret (optional for polling)<input type="password" name="webhookSecret" className={field} autoComplete="new-password" placeholder={app?'Leave blank to retain saved secret':''}/></label>
          <p className="text-xs text-muted-foreground">Find callback URLs under Configuration URLs. For a new import, the webhook URL appears after saving.</p>
          <label className="flex gap-2 text-sm"><input type="checkbox" name="urlsConfirmed" required/>I have checked the private App owner, read permissions, callback URLs and webhook configuration on GitHub.</label>
        </>}
        <div className="flex flex-wrap gap-2"><Button busy={busy}>{mode==='app'?'Prepare registration':'Save connection'}</Button>{mode==='pat' && <Button type="submit" value="test-pat" variant="outline">Test connection</Button>}<Button type="button" variant="ghost" onClick={()=>open(null)}>Cancel</Button></div>
      </fieldset>
    </form>}
    {!result?.data && !result?.error && <ContentSkeleton layout="settings" label="Loading GitHub connections…" />}
    {result?.data && selection && !a && !c && <p role="status" className="mt-4 text-muted-foreground">This connection no longer exists.</p>}
    {!selection && !mode && groups && (hasConnections ? <div className="mt-5">
      <SearchToolbar><FindingsSearch label="Search apps and connections" value={query} onChange={setQuery} /></SearchToolbar>
      <ul aria-label="GitHub connections" className="divide-y divide-border/60">
        {groups.apps.map(({app, installations})=><ManagementRow key={app.id} selection={`app:${app.id}`} name={app.slug || app.owner_login} owner={`GitHub App · ${app.owner_login}`} count={app.repository_count} status={githubAppStatus(app, installations).label} />)}
        {groups.standalone.map(item => <ConnectionRow key={item.id} c={item} />)}
      </ul>
      {!groups.apps.length && !groups.standalone.length && <p className="py-4 text-muted-foreground">No matching connections.</p>}
    </div> : <div className="mt-5 rounded-lg border border-border px-5 py-6">
      <h3 className="font-medium">Connect your first GitHub account</h3>
      <p className="mb-4 mt-1 text-muted-foreground">Give Kopes access to the repositories you want to scan.</p>
      {addConnection}
    </div>)}
    {!mode && c && <div className="mt-5">{accessDetails(c)}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy||!!c.disconnected} onClick={()=>void run({action:'refresh',connectionId:c.id})}>Test / refresh access</Button>
        <Button size="sm" variant="outline" asChild><Link to="/repositories">View repositories</Link></Button>
      </div>
    </div>}
    {!mode && a && <div className="mt-5 space-y-5">
      <section className="border-t border-border pt-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Installations</h3>
      </div>
      {installations.length ? <ul className="divide-y divide-border/60">{installations.map(item => <ConnectionRow key={item.id} c={item} />)}</ul> : <p className="text-muted-foreground">No installations connected yet.</p>}</section>
      {!a.github_id && a.status==='verification-failed' && <p role="alert">App credentials were not saved. If GitHub created the App, return to GitHub connections and choose Reconnect an existing App to import its credentials. The previous registration callback cannot be reused.</p>}
      {a.originChanged && <p role="alert">Canonical origin changed. Update GitHub URLs and import the existing App with the current origin.</p>}
      <details className="border-t border-border pt-4">
        <summary className="cursor-pointer font-medium">Configuration URLs</summary>
        <p className="mt-2 text-xs text-muted-foreground">{a.webhook_mode==='polling'?'Change detection uses polling.':a.last_webhook_at?`Last webhook received ${new Date(a.last_webhook_at).toLocaleString()}`:'Waiting for the first webhook.'}</p>
        <dl className="mt-3 space-y-3">{Object.entries(a.urls).map(([key,url]) => <div key={key}>
          <dt className="text-xs capitalize text-muted-foreground">{key}</dt>
          <dd className="mt-1 flex items-center gap-3"><code className="min-w-0 flex-1 select-all break-all text-xs">{url}</code><Button size="sm" variant="outline" aria-label={`Copy ${key} URL`} onClick={()=>void copyUrl(key,url)}>Copy</Button></dd>
          {copyFeedback.key===key && <dd role="status" className="text-xs text-muted-foreground">{copyFeedback.text}</dd>}
        </div>)}</dl>
      </details>
    </div>}
    {!mode && (a || c) && <footer className="mt-6 border-t border-border pt-4" aria-label="Connection actions">
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {a?.github_id && <Button size="sm" variant="outline" disabled={busy} onClick={()=>open('import',null,a)}>Replace credentials</Button>}
        {c?.auth_kind==='pat' && <Button size="sm" variant="outline" disabled={busy} onClick={()=>open('pat',c)}>Replace token</Button>}
        <Button size="sm" variant="outline" asChild><a href={a?.manageUrl ?? c?.manageUrl} target="_blank" rel="noreferrer">{a?'Manage App on GitHub':'Manage access on GitHub'}</a></Button>
        {(a || (c && !c.disconnected)) && <AlertDialog.Root>
          <AlertDialog.Trigger asChild><Button size="sm" variant="ghost" className="text-critical" disabled={busy}>{a?'Remove local registration':'Disconnect'}</Button></AlertDialog.Trigger>
          <AlertDialog.Portal><AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
            <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-raised p-6 shadow-lg">
              <AlertDialog.Title className="text-lg font-semibold">{a?`Remove ${a.slug || a.owner_login} locally?`:`Disconnect ${c?.label || c?.owner_login || 'this connection'}?`}</AlertDialog.Title>
              <AlertDialog.Description className="mt-3 text-sm text-muted-foreground">Future scans stop for {a?.repository_count ?? c?.repository_count} linked repositories. Historical reports remain. {a?'Local App secrets are deleted, but the App stays on GitHub.':'This does not revoke access on GitHub.'}</AlertDialog.Description>
              <div className="mt-6 flex justify-end gap-2"><AlertDialog.Cancel asChild><Button variant="outline">Cancel</Button></AlertDialog.Cancel>
                <AlertDialog.Action asChild><Button className="bg-critical text-white hover:bg-critical/90" onClick={()=>void run(a?{action:'remove-app',appId:a.id}:{action:'disconnect',connectionId:c!.id})}>{a?'Remove local registration':'Disconnect'}</Button></AlertDialog.Action></div>
            </AlertDialog.Content></AlertDialog.Portal>
        </AlertDialog.Root>}
      </div>
    </footer>}
  </section>;
}
