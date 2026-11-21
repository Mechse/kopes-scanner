/** Browser contract deliberately excludes stored ciphertext and setup authorization material. */
export type GithubConnection = { id: string; auth_kind: 'pat' | 'github_app'; label: string; owner_login: string | null; health: string; disconnected: number; expires_at: number | null; validated_at: number | null; history: number; validation_repository: string | null; installation_id: string | null; app_id: string | null; repository_count: number; manageUrl: string };
export type GithubAppView = { id: string; github_id: string | null; client_id: string | null; slug: string | null; owner_login: string; owner_type: 'User' | 'Organization'; origin: string; status: string; setup_status: string | null; history: number; webhook_mode: 'webhook' | 'polling'; repository_count: number; last_webhook_at: number | null; originChanged: boolean; urls: Record<string,string>; manageUrl: string };
export type GithubSettingsData = { connections: GithubConnection[]; apps: GithubAppView[] };

export function githubConnectionGroups(data: GithubSettingsData, query: string) {
  const search = query.trim().toLowerCase();
  const matches = (c: GithubConnection) => `${c.label} ${c.owner_login ?? ''}`.toLowerCase().includes(search);
  const apps = data.apps.map(app => ({ app, installations: data.connections.filter(c => c.app_id === app.id) }))
    .filter(({app, installations}) => `${app.slug ?? ''} ${app.owner_login}`.toLowerCase().includes(search) || installations.some(matches));
  const standalone = data.connections.filter(c => !data.apps.some(app => app.id === c.app_id) && matches(c));
  return { apps, standalone };
}

// Fixed callback notices only. Never copy provider errors, codes or state into a redirect.
export const githubSetupNotices = {
  session: 'GitHub setup could not verify your administrator session. Sign in again, then resume or import the App from Settings.',
  state: 'GitHub setup expired, was already used, or belongs to another browser session. Resume the saved App, or import it if no credentials were saved.',
  exchange: 'GitHub App credential exchange failed. If the App was created on GitHub, import it using Reconnect an existing App. Do not reuse the callback URL.',
  credentials: 'GitHub App credentials could not be saved or were incomplete. Import the existing App; do not reuse the callback URL.',
  verification: 'App credentials were saved, but verification failed. Use Resume / verify installation for the specific error, or replace the App credentials.',
  installation: 'GitHub installation verification did not complete. Resume installation and check organization approval and repository access.',
} as const;
export type GithubSetupNotice = keyof typeof githubSetupNotices;
export function githubSetupNotice(value: unknown): GithubSetupNotice | undefined {
  return typeof value === 'string' && Object.hasOwn(githubSetupNotices,value) ? value as GithubSetupNotice : undefined;
}
