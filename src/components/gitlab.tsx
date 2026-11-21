import { useState } from 'react';
import { useResource } from '../lib/use-resource';
import { post } from './repositories';
import { Button } from './ui/button';

import { CallbackRow, SectionHeading, SettingsInput } from './settings-fields';
import { ContentSkeleton } from './ui/loading';

export function GitlabSettings() {
  const [revision, refresh] = useState(0),
    [message, status] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const result = useResource<{
      origin: string;
      clientId: string;
      login: boolean;
      callbacks: { login: string; connect: string };
    }>('gitlab/settings', revision),
    app = result?.data;
  async function submit(data?: FormData) {
    setBusy(true); setError(''); status('');
    try {
      if (data) await post('gitlab/settings', { ...Object.fromEntries(data), login: data.has('login') });
      else await post('gitlab/reset', {});
      refresh(v => v + 1);
      status(data ? 'Application saved. No repository access granted.' : 'Deployment disconnected.');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="max-w-2xl py-6">
    {!app && !result?.error && <ContentSkeleton label="Loading GitLab settings…" layout="settings" />}
    {app && <>
      <SectionHeading title="GitLab" status={app.clientId ? 'Configured' : 'Not configured'} />
      <form key={`${revision}:${app.clientId}`} className="mt-4" onSubmit={e => {
        e.preventDefault(); void submit(new FormData(e.currentTarget));
      }}>
        <p className="text-xs leading-5 text-muted-foreground">Register a confidential OAuth application on your GitLab instance. Add both redirect URIs below and enable the <code>openid</code>, <code>email</code> and <code>read_api</code> scopes. Each user authorizes repository access separately.</p>
        <CallbackRow label="Sign-in redirect URI" url={app.callbacks.login} />
        <CallbackRow label="Repository connection redirect URI" url={app.callbacks.connect} />
        <fieldset disabled={busy} className="mt-4 space-y-4">
          <label className="block text-sm">Base URL (GitLab.com or self-managed)
            <SettingsInput name="origin" type="url" defaultValue={app.origin} required />
          </label>
          <label className="block text-sm">Application ID
            <SettingsInput name="clientId" defaultValue={app.clientId} autoComplete="off" required />
          </label>
          <label className="block text-sm">Client secret
            <SettingsInput name="password" type="password" autoComplete="new-password" required={!app.clientId} placeholder={app.clientId ? 'Saved — leave blank to keep' : 'Paste client secret'} />
          </label>
          <div>
            <label className="flex items-center gap-2 text-sm"><input name="login" type="checkbox" defaultChecked={app.login} aria-describedby="gitlab-login-help" />Enable verified-email GitLab sign-in</label>
            <p id="gitlab-login-help" className="mt-2 text-xs text-muted-foreground">Leave this off if your instance cannot verify email addresses. Users can still connect repositories after signing in another way.</p>
          </div>
          <Button type="submit">Save changes</Button>
        </fieldset>
      </form>
    </>}
    {message && <p role="status" className="mt-4 text-sm">{message}</p>}
    {(error || result?.error) && <p role="alert" className="mt-4 text-sm text-critical">{error || result?.error}</p>}
    {app?.clientId && <section className="mt-6 space-y-3 border-t border-border pt-6">
      <h3 className="text-sm font-medium">Disconnect GitLab</h3>
      <p className="text-xs text-muted-foreground">Disconnecting removes this application from the workspace, disconnects every user’s GitLab account here, and pauses their GitLab scans.</p>
      <Button type="button" variant="outline" disabled={busy} onClick={() => {
        if (window.confirm('Disconnect every personal GitLab grant and pause its scans?')) void submit();
      }}>Disconnect deployment</Button>
    </section>}
  </section>;
}
export function GitlabPicker({
  review,
}: {
  review?: (id: string, connection: string, label: string) => void;
}) {
  const [revision, refresh] = useState(0),
    [page, setPage] = useState(1),
    [q, search] = useState(''),
    [error, fail] = useState('');
  const result = useResource<{
      configured: boolean;
      grant?: { id: string; owner_login: string; health: string };
    }>('gitlab', revision),
    grant = result?.data?.grant;
  const projects = useResource<{ projects: { id: number; path_with_namespace: string }[]; more: boolean }>(
    grant?.health === 'connected'
      ? 'gitlab/projects?' + new URLSearchParams({ connectionId: grant.id, page: String(page), q })
      : '',
    revision,
  );
  if (!result?.data?.configured) return result?.error ? <p role="alert">{result.error}</p> : null;
  return (
    <section className="my-8 grid gap-3">
      <h2 className="text-xl font-semibold">Personal GitLab repositories</h2>
      {grant && (
        <p>
          Connected account: {grant.owner_login} · {grant.health}
        </p>
      )}
      {grant?.health !== 'connected' && (
        <Button
          onClick={async () => {
            try {
              location.assign((await post('gitlab/connect', {})).url);
            } catch (e) {
              fail((e as Error).message);
            }
          }}
        >
          Connect my GitLab account
        </Button>
      )}
      {grant && (
        <Button
          variant="outline"
          onClick={async () => {
            if (!confirm('Disconnect this account and pause dependent scans?')) return;
            try {
              await post('gitlab/disconnect?connectionId=' + grant.id, {});
              refresh(revision + 1);
            } catch (e) {
              fail((e as Error).message);
            }
          }}
        >
          Disconnect account
        </Button>
      )}
      {grant?.health === 'connected' && (
        <>
          <label>
            Search GitLab projects{' '}
            <input
              type="search"
              maxLength={300}
              value={q}
              onChange={(e) => {
                search(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <ul>
            {projects?.data?.projects.map((p) => (
              <li className="flex justify-between py-2" key={p.id}>
                {p.path_with_namespace}
                {review && (
                  <Button size="sm" onClick={() => review(String(p.id), grant.id, p.path_with_namespace)}>
                    Import
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div>
            <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>{' '}
            Page {page}{' '}
            <Button disabled={!projects?.data?.more} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </>
      )}
      {(error || projects?.error) && <p role="alert">{error || projects?.error}</p>}
    </section>
  );
}
