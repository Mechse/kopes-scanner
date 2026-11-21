import { SelectField } from './ui/select-field';
import { SelectItem } from './ui/select';
import { useState, type FormEvent } from 'react';
import { useResource } from '../lib/use-resource';
import type { GithubSettingsData, GithubConnection, GithubAppView } from '../lib/github';
import { githubSetupNotices, type GithubSetupNotice } from '../lib/github';
import { Button } from './ui/button';
import { useWorkspace } from './app-shell';

const field = 'mt-1 block w-full rounded border border-border bg-background px-3 py-2 text-sm';
async function githubPost(body: unknown) {
  const response = await fetch('/api/data/github',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'GitHub operation failed.'); return result;
}
export function GithubSettings({setupNotice}: {setupNotice?: GithubSetupNotice}) {
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
      if(data) {form.reset();setMode(null);setApp(null);setMessage('App credentials verified and saved. Resume installation to associate a new connection.');}
    }
  }
  const tokenUrl = `https://github.com/settings/personal-access-tokens/new?${new URLSearchParams({name:'Kopes Scanner',target_name:owner,expires_in:'90',contents:'read',...(history?{pull_requests:'read'}:{})})}`;
  return <section className="max-w-3xl border-t border-border py-6" aria-labelledby="github-heading">
    <h2 id="github-heading" className="text-base font-medium">GitHub connections</h2>
    <p className="mt-2 text-sm text-muted-foreground">Use a private GitHub App owned by the account containing your repositories. Create a separate connection for each owner. Manage GitHub sign-in in the Auth tab.</p>
    <p className="mt-2 text-xs text-muted-foreground">Contents read allows access to repository contents. Kopes fetches dependency inputs without cloning or executing source code. Private GitHub validation is required for your installation before relying on scans.</p>
    {(error || result?.error) && <p role="alert" className="mt-3 text-sm text-critical">{error || result?.error}</p>}
    {setupNotice && <p role="alert" className="mt-3 text-sm text-critical">{githubSetupNotices[setupNotice]}</p>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    <div className="mt-4 flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={()=>open('app')}>Connect with GitHub App</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>open('pat')}>Use personal access token</Button><Button type="button" variant="ghost" disabled={busy} onClick={()=>open('import')}>Reconnect an existing App</Button></div>
    {manifest ? <form method="post" action={manifest.action} className="mt-5 rounded border border-border p-4"><input type="hidden" name="manifest" value={JSON.stringify(manifest.manifest)}/><p className="mb-3 text-sm">Continue on GitHub to create your private App. Return in this browser session within 30 minutes.</p><Button>Continue on GitHub</Button></form> : mode && <form key={`${mode}:${editing?.id}:${app?.id}`} onSubmit={submit} className="mt-5 rounded border border-border p-4">
      <fieldset disabled={busy} className="space-y-4">
        <legend className="mb-3 font-medium">{mode==='app'?'Register a private App':mode==='pat'?editing?'Replace personal access token':'Fine-grained personal access token':app?'Update App credentials':'Import App credentials'}</legend>
        {mode==='pat' && <label className="block text-sm">Connection name<input className={field} name="label" defaultValue={editing?.label??''} required maxLength={120}/></label>}
        <label className="block text-sm">Resource owner (GitHub login)<input className={field} value={owner} onChange={e=>setOwner(e.target.value)} required maxLength={80} placeholder="octocat" aria-describedby="github-owner-help"/></label>
        <p id="github-owner-help" className="text-xs text-muted-foreground">Enter the username or organization login, without @ or a URL. Surrounding whitespace is ignored.</p>
        {mode!=='pat' && <label className="block text-sm">Account type<SelectField aria-label="Account type" className="mt-1 w-full" name="ownerType" defaultValue={app?.owner_type??'User'}><SelectItem value="User">Personal account</SelectItem><SelectItem value="Organization">Organization</SelectItem></SelectField></label>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={history} onChange={e=>setHistory(e.target.checked)}/>Include pull request and review history (read only)</label>
        {mode==='pat' ? <>
          <a className="block text-sm underline" href={tokenUrl} target="_blank" rel="noreferrer">Create a fine-grained, read-only token on GitHub</a>
          <p className="text-xs text-muted-foreground">Select only the repositories to scan and Contents read. Organization approval may be required. Classic token onboarding is not supported. Successful reads do not prove that a token has no write permissions.</p>
          <label className="block text-sm">Token<input className={field} type="password" name="token" autoComplete="new-password" required={!editing} placeholder={editing?'Leave blank to retain the saved token':''}/></label>
          <label className="block text-sm">Private repository URL for validation<input className={field} name="repository" required defaultValue={editing?.validation_repository??''} placeholder="https://github.com/owner/private-repository"/></label>
          <label className="block text-sm">Expiry date (optional, supplied by you)<input className={field} type="date" name="expiry" defaultValue={editing?.expires_at?new Date(editing.expires_at).toISOString().slice(0,10):''}/></label>
          <p className="text-xs text-muted-foreground">Testing reads metadata, the default branch, tree and supported dependency inputs. Saving retests the submitted token. Tokens are never renewed automatically.</p>
        </> : <label className="block text-sm">Change detection<SelectField aria-label="Change detection" name="webhookMode" className="mt-1 w-full" defaultValue={app?.webhook_mode??'polling'}><SelectItem value="polling">Polling only (no inbound GitHub access required)</SelectItem><SelectItem value="webhook">Webhooks with polling recovery (public HTTPS required)</SelectItem></SelectField></label>}
        {mode==='import' && <>
          <label className="block text-sm">GitHub App ID<input name="githubId" className={field} required defaultValue={app?.github_id??''}/></label>
          <label className="block text-sm">Client ID<input name="clientId" className={field} required defaultValue={app?.client_id??''}/></label>
          <label className="block text-sm">Private key (PEM)<textarea name="privateKey" className={`${field} font-mono`} required={!app} autoComplete="off" placeholder={app?'Leave blank to retain saved key':''}/></label>
          <label className="block text-sm">Client secret<input type="password" name="clientSecret" className={field} required={!app} autoComplete="new-password" placeholder={app?'Leave blank to retain saved secret':''}/></label>
          <label className="block text-sm">Webhook secret (optional for polling)<input type="password" name="webhookSecret" className={field} autoComplete="new-password" placeholder={app?'Leave blank to retain saved secret':''}/></label>
          <p className="text-xs text-muted-foreground">Webhook mode requires a matching secret configured on GitHub. Polling-only Apps do not need one.</p>
          <p className="text-xs text-muted-foreground">The private key is verified against the same App before saving. Client and webhook secrets are verified when GitHub uses them. Update GitHub with the callback URLs shown on the App card; for a new import, the webhook URL appears after saving.</p>
          <label className="flex gap-2 text-sm"><input type="checkbox" name="urlsConfirmed" required/>I have checked the private App owner, read permissions, callback URLs and webhook configuration on GitHub.</label>
        </>}
        <div className="flex gap-2"><Button busy={busy}>{mode==='app'?'Prepare registration':'Save connection'}</Button>{mode==='pat' && <Button type="submit" value="test-pat" variant="outline">Test connection</Button>}<Button type="button" variant="ghost" onClick={()=>setMode(null)}>Cancel</Button></div>
      </fieldset>
    </form>}
    <div className="mt-5 space-y-3">{result?.data?.apps.map(a=><article key={a.id} className="rounded border border-border p-4 text-sm">
      <h3 className="font-medium">{a.owner_login} · GitHub App</h3><p className="mt-1">{a.status==='pending-installation'||a.status==='registered'?'App created — installation required':a.status} · {a.webhook_mode==='polling'?'Polling only':`Webhooks: ${a.last_webhook_at?`last receipt ${new Date(a.last_webhook_at).toLocaleString()}`:'no verified delivery yet'}`}</p>
      {a.setup_status && ['expired','verification-failed','cancelled'].includes(a.setup_status) && <p role="status">Last setup attempt: {a.setup_status}. Resume with a fresh state or import the App if registration was interrupted.</p>}
      {!a.github_id && a.status==='verification-failed' && <p role="alert">App credentials were not saved. If GitHub created the App, use Reconnect an existing App to import its credentials. The previous registration callback cannot be reused.</p>}
      {a.originChanged && <p role="alert">Canonical origin changed. Update GitHub URLs and import the existing App with the current origin.</p>}
      <details className="mt-2"><summary>Callback URLs and recovery</summary><dl className="mt-2 break-all">{Object.entries(a.urls).map(([key,value])=><div key={key}><dt className="font-medium">{key}</dt><dd>{value}</dd></div>)}</dl><p className="mt-2">After interrupted registration, resume if credentials were saved. Otherwise import the App created on GitHub, or delete it there and start again. Use the same local session for each setup attempt.</p></details>
      <div className="mt-3 flex flex-wrap gap-2">{a.github_id && <Button type="button" size="sm" disabled={busy||a.originChanged} onClick={()=>void run({action:'resume',appId:a.id})}>Resume / verify installation</Button>}<a href={a.manageUrl} target="_blank" rel="noreferrer" className="p-2 underline">Manage App on GitHub</a>{a.github_id && <Button type="button" size="sm" variant="outline" onClick={()=>open('import',null,a)}>Replace credentials</Button>}</div>
      <details className="mt-3"><summary>Remove local App registration</summary><p className="my-2">Stops future scans for {a.repository_count} linked repositories and deletes local App secrets. Historical reports remain. The App on GitHub is kept.</p><Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>void run({action:'remove-app',appId:a.id})}>Remove local registration</Button></details>
    </article>)}</div>
    <div className="mt-4 space-y-3">{result?.data?.connections.map(c=><article key={c.id} className="rounded border border-border p-4 text-sm"><h3 className="font-medium">{c.label||c.owner_login||'Legacy GitHub connection'}</h3><p className="mt-1">{c.owner_login} · {c.auth_kind==='github_app'?'App installation':c.auth_kind==='pat'?'Fine-grained PAT':'Legacy token (unvalidated)'} · {c.disconnected?'Disconnected':c.health}</p><p className="mt-1">{c.repository_count} linked repositories · Last successful check: {c.validated_at?new Date(c.validated_at).toLocaleString():'Not yet validated'} · {c.history?'Contents and PR history':'Contents read'}</p>{c.auth_kind!=='github_app' && <p>{c.expires_at?`Expiry (user supplied): ${new Date(c.expires_at).toLocaleDateString()}`:'Expiry unknown'}</p>}
      <div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={busy||!!c.disconnected} onClick={()=>void run({action:'refresh',connectionId:c.id})}>Test / refresh access</Button><a className="p-2 underline" href="/repositories">Choose repositories</a><a className="p-2 underline" href={c.manageUrl} target="_blank" rel="noreferrer">Manage access on GitHub</a>{c.auth_kind!=='github_app' && <Button type="button" size="sm" variant="outline" onClick={()=>open('pat',c)}>Replace token</Button>}</div>
      {!c.disconnected && <details className="mt-3"><summary>Disconnect</summary><p className="my-2">Stop future scans for {c.repository_count} repositories. Historical reports remain. GitHub access is managed separately.</p><Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>void run({action:'disconnect',connectionId:c.id})}>Disconnect this connection</Button></details>}
    </article>)}</div>
  </section>;
}
