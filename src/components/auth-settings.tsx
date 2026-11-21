import { useState } from 'react';
import { useResource } from '../lib/use-resource';
import { CallbackRow, SectionHeading, SettingsInput } from './settings-fields';
import { Button } from './ui/button';
import { ContentSkeleton } from './ui/loading';
import { providerNames, type AuthProvider } from './auth-setup';

type Provider = { provider: AuthProvider; clientId: string; hasSecret: boolean; administrator: string; enabled: boolean; source: string };
type Settings = { origin: string; currentProvider: AuthProvider; providers: Provider[] };

const registration = { github: 'https://github.com/settings/developers', google: 'https://console.cloud.google.com/auth/overview', microsoft: 'https://entra.microsoft.com/' };

export function AuthMethodsSettings({ section }: { section: string }) {
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
      setMessage('Settings saved and active. Try a new sign-in to verify the provider.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save sign-in settings.'); }
    finally { setBusy(false); }
  }
  return <section className="max-w-2xl py-6">
    {result?.error && <p role="alert" className="mt-4 text-sm text-critical">{result.error}</p>}
    {!data ? !result?.error && <ContentSkeleton label="Loading sign-in methods…" layout="settings" /> : <div key={version}>
      {data.providers.filter(provider => provider.provider === section).map(provider => <ProviderForm key={provider.provider} data={provider} origin={data.origin} locked={provider.provider === data.currentProvider} busy={busy} submit={submit} />)}
    </div>}
    {message && <p role="status" className="mt-4 text-sm">{message}</p>}
    {error && <p role="alert" className="mt-4 text-sm text-critical">{error}</p>}
  </section>;
}
function ProviderForm({ data, origin, locked, busy, submit }: { data: Provider; origin: string; locked: boolean; busy: boolean; submit: (body: object) => Promise<void> }) {
  const name = providerNames[data.provider], callback = `${origin}/api/auth/callback/${data.provider}`;
  return <div>
    <SectionHeading title={name} status={`${data.enabled ? 'Enabled' : 'Not enabled'}${locked ? ' · Current sign-in' : data.source === 'environment' && data.enabled ? ' · Deployment settings' : ''}`} />
    <form className="mt-4" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void submit({ action: 'save', provider: data.provider, clientId: form.get('clientId'), clientSecret: form.get('clientSecret'), administrator: form.get('administrator') });
  }}>
    <p className="mt-3 text-xs leading-5 text-muted-foreground"><a className="underline" href={registration[data.provider]} target="_blank" rel="noreferrer">Open {name} application settings</a>. {data.provider === 'github' ? 'Create an OAuth App; no repository access is needed.' : data.provider === 'google' ? 'Create a Web application OAuth client. While in testing, add your users as test users.' : 'Register an application for accounts in any organization and personal Microsoft accounts. Use a Web redirect URI and copy the secret value, not its ID.'}</p>
    <CallbackRow label="Callback URL" url={callback} />
    <fieldset disabled={busy || locked} className="mt-4 space-y-4">
      <label className="block text-sm" htmlFor={`${data.provider}-id`}>Client ID<SettingsInput id={`${data.provider}-id`} name="clientId" required defaultValue={data.clientId} autoComplete="off" /></label>
      <label className="block text-sm" htmlFor={`${data.provider}-secret`}>Client secret<SettingsInput id={`${data.provider}-secret`} name="clientSecret" type="password" required={!data.hasSecret} autoComplete="new-password" placeholder={data.hasSecret ? 'Saved — leave blank to keep' : 'Paste client secret'} /></label>
      <p className="text-xs text-muted-foreground">Changing the client ID requires a new secret.</p>
      <label className="block text-sm" htmlFor={`${data.provider}-admin`}>{data.provider === 'github' ? 'Administrator GitHub username' : data.provider === 'microsoft' ? 'Administrator Microsoft identity' : 'Administrator email'}<SettingsInput id={`${data.provider}-admin`} name="administrator" type={data.provider === 'google' ? 'email' : 'text'} required defaultValue={data.administrator} /></label>
      {data.provider === 'microsoft' && <p className="text-xs text-muted-foreground">Enter microsoft:&lt;tenant ID&gt;:&lt;user object ID&gt; from Microsoft Entra. Approve other accounts in Users after their first sign-in attempt.</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit">Save changes</Button>{data.enabled && <Button type="button" variant="ghost" onClick={() => void submit({ action: 'disable', provider: data.provider })}>Disable {name}</Button>}</div>
    </fieldset>
  </form>
  </div>;
}
