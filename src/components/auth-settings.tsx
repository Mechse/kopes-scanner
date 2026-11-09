import { useState } from 'react';
import { useResource } from '../lib/use-resource';
import { Button } from './ui/button';
import { ContentSkeleton } from './ui/loading';
import { providerNames, type AuthProvider } from './auth-setup';

type Provider = { provider: AuthProvider; clientId: string; hasSecret: boolean; administrator: string; enabled: boolean; source: string };
type Settings = { origin: string; currentProvider: AuthProvider; providers: Provider[]; mail: { configured: boolean; hasSmtpUrl: boolean; mailFrom: string } };
const fieldClass = 'mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
const registration = { github: 'https://github.com/settings/developers', google: 'https://console.cloud.google.com/auth/overview', microsoft: 'https://entra.microsoft.com/' };

export function AuthMethodsSettings() {
  const result = useResource<Settings>('auth-settings', 0);
  const [saved, setSaved] = useState<Settings>();
  const data = saved ?? result?.data;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  async function submit(body: object) {
    setBusy(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/data/auth-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Could not save sign-in settings.');
      setSaved(value); setVersion(v => v + 1);
      setMessage('Settings saved and active. Try a new sign-in to verify the provider and email delivery.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save sign-in settings.'); }
    finally { setBusy(false); }
  }
  return <section className="max-w-2xl border-t border-border py-6" aria-labelledby="auth-settings-heading">
    <h2 id="auth-settings-heading" className="text-base font-medium">Sign-in methods</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">Create an OAuth application with each provider, then enter its credentials here. Changes apply immediately. Secrets are encrypted and never displayed again.</p>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">Your current sign-in method is protected. Sign in through another method before changing or disabling it. Accounts remain tied to their original provider.</p>
    {result?.error && <p role="alert" className="mt-4 text-sm text-critical">{result.error}</p>}
    {!data ? !result?.error && <ContentSkeleton label="Loading sign-in methods…" layout="settings" /> : <div key={version}>
      {data.providers.map(provider => <ProviderForm key={provider.provider} data={provider} origin={data.origin} locked={provider.provider === data.currentProvider} busy={busy} submit={submit} />)}
      <form className="mt-6 rounded-lg border border-border p-4" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void submit({ action: 'mail', smtpUrl: form.get('smtpUrl'), mailFrom: form.get('mailFrom') });
      }}>
        <h3 className="text-sm font-medium">Microsoft email verification</h3>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Microsoft users must verify their mailbox before their first sign-in. Configure email delivery before enabling Microsoft. Use your mail service’s SMTP credentials, URL-encode special characters, and use an approved sender address.</p>
        {data.currentProvider === 'microsoft' && <p className="mt-2 text-xs">Sign in with another method to change email delivery.</p>}
        <fieldset disabled={busy || data.currentProvider === 'microsoft'} className="mt-4 space-y-4">
          <label className="block text-sm" htmlFor="auth-smtp">SMTP URL
            <input id="auth-smtp" name="smtpUrl" type="password" required={!data.mail.hasSmtpUrl} autoComplete="new-password" className={fieldClass} placeholder={data.mail.hasSmtpUrl ? 'Saved — leave blank to keep' : 'smtps://username:password@mail.example.com:465'} />
          </label>
          <label className="block text-sm" htmlFor="auth-from">Sender email
            <input id="auth-from" name="mailFrom" type="email" required defaultValue={data.mail.mailFrom} className={fieldClass} placeholder="security@example.com" />
          </label>
          <Button type="submit">Save email delivery</Button>
        </fieldset>
        <p className="mt-3 text-xs text-muted-foreground">{data.mail.configured ? 'Email delivery is configured. Verify delivery with a Microsoft sign-in.' : 'Email delivery is not configured.'}</p>
      </form>
    </div>}
    {message && <p role="status" className="mt-4 text-sm">{message}</p>}
    {error && <p role="alert" className="mt-4 text-sm text-critical">{error}</p>}
  </section>;
}
function ProviderForm({ data, origin, locked, busy, submit }: { data: Provider; origin: string; locked: boolean; busy: boolean; submit: (body: object) => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const name = providerNames[data.provider], callback = `${origin}/api/auth/callback/${data.provider}`;
  return <form className="mt-6 rounded-lg border border-border p-4" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void submit({ action: 'save', provider: data.provider, clientId: form.get('clientId'), clientSecret: form.get('clientSecret'), administrator: form.get('administrator') });
  }}>
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{name}</h3><span className="text-xs text-muted-foreground">{data.enabled ? 'Enabled' : 'Not enabled'}{locked ? ' · Current sign-in' : data.source === 'environment' && data.enabled ? ' · Deployment settings' : ''}</span></div>
    <p className="mt-3 text-xs leading-5 text-muted-foreground"><a className="underline" href={registration[data.provider]} target="_blank" rel="noreferrer">Open {name} application settings</a>. {data.provider === 'github' ? 'Create an OAuth App; no repository access is needed.' : data.provider === 'google' ? 'Create a Web application OAuth client. While in testing, add your users as test users.' : 'Register an application for accounts in any organization and personal Microsoft accounts. Use a Web redirect URI and copy the secret value, not its ID.'}</p>
    <p className="mt-3 text-xs text-muted-foreground">Callback URL</p>
    <div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 break-all text-xs">{callback}</code><Button type="button" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(callback); setCopied(true); setCopyError(false); } catch { setCopyError(true); } }}>{copied ? 'Copied' : 'Copy'}</Button></div>
    {copyError && <p role="status" className="mt-2 text-xs">Select and copy the callback URL above.</p>}
    <fieldset disabled={busy || locked} className="mt-4 space-y-4">
      <label className="block text-sm" htmlFor={`${data.provider}-id`}>Client ID<input id={`${data.provider}-id`} name="clientId" required defaultValue={data.clientId} className={fieldClass} autoComplete="off" /></label>
      <label className="block text-sm" htmlFor={`${data.provider}-secret`}>Client secret<input id={`${data.provider}-secret`} name="clientSecret" type="password" required={!data.hasSecret} className={fieldClass} autoComplete="new-password" placeholder={data.hasSecret ? 'Saved — leave blank to keep' : 'Paste client secret'} /></label>
      <p className="text-xs text-muted-foreground">Changing the client ID requires a new secret.</p>
      <label className="block text-sm" htmlFor={`${data.provider}-admin`}>{data.provider === 'github' ? 'Administrator GitHub username' : 'Administrator email'}<input id={`${data.provider}-admin`} name="administrator" type={data.provider === 'github' ? 'text' : 'email'} required defaultValue={data.administrator} className={fieldClass} /></label>
      {data.provider !== 'github' && <p className="text-xs text-muted-foreground">Google and Microsoft share the same administrator email. Add other people on the User access page.</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit">Save {name}</Button>{data.enabled && <Button type="button" variant="ghost" onClick={() => void submit({ action: 'disable', provider: data.provider })}>Disable {name}</Button>}</div>
    </fieldset>
  </form>;
}
