import { useState } from 'react';
import { useResource } from '../lib/use-resource';
import { post } from './repositories';
import { Button } from './ui/button';

export function GitlabSettings() {
  const [revision, refresh] = useState(0),
    [message, status] = useState('');
  const result = useResource<{
      origin: string;
      clientId: string;
      login: boolean;
      callbacks: Record<string, string>;
    }>('gitlab/settings', revision),
    app = result?.data;
  if (!app) return <p role="status">{result?.error || 'Loading GitLab settings…'}</p>;
  return (
    <form
      key={revision}
      className="grid max-w-xl gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        try {
          await post('gitlab/settings', { ...Object.fromEntries(data), login: data.has('login') });
          refresh(revision + 1);
          status('Application saved. No repository access granted.');
        } catch (err) {
          status((err as Error).message);
        }
      }}
    >
      <h2>GitLab application</h2>
      <p>
        Register one confidential OAuth application with both redirect URIs. Enable openid, email and
        read_api. Each user consents separately.
      </p>
      {Object.entries(app.callbacks).map(([label, url]) => (
        <div key={label}>
          <label>
            {label} redirect URI
            <input className="w-full" value={url} readOnly onFocus={(e) => e.target.select()} />
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                status('Callback copied.');
              } catch {
                status('Select the callback field and copy its value.');
              }
            }}
          >
            Copy {label} URI
          </Button>
        </div>
      ))}
      <label>
        Base URL (GitLab.com or self-managed)
        <input className="block" name="origin" type="url" defaultValue={app.origin} required />
      </label>
      <label>
        Application ID
        <input className="block" name="clientId" defaultValue={app.clientId} required />
      </label>
      <label>
        Client secret
        <input
          className="block"
          name="password"
          type="password"
          autoComplete="new-password"
          required={!app.clientId}
          placeholder={app.clientId ? 'Leave blank to keep existing secret' : ''}
        />
      </label>
      <label>
        <input name="login" type="checkbox" defaultChecked={app.login} /> Enable verified-email GitLab sign-in
      </label>
      <p className="text-sm">
        If your instance cannot confirm a verified email, leave sign-in off. Users can still connect
        repositories after signing in another way.
      </p>
      <Button>Save application</Button>
      {app.clientId && (
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            if (!window.confirm('Disconnect every personal GitLab grant and pause its scans?')) return;
            try {
              await post('gitlab/reset', {});
              refresh(revision + 1);
              status('Deployment disconnected.');
            } catch (err) {
              status((err as Error).message);
            }
          }}
        >
          Disconnect deployment
        </Button>
      )}
      <p role="status">{message}</p>
    </form>
  );
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
