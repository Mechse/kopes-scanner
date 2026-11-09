import { resolve } from 'node:path';

export function isGithubUsername(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(value);
}
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Set ${name} in your deployment environment, or run pnpm run setup for local installation.`);
    return value;
  };
  const origin = new URL(required('BETTER_AUTH_URL'));
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password ||
    !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) {
    throw new Error('BETTER_AUTH_URL must be an HTTPS origin (HTTP is allowed only on localhost).');
  }
  const secret = required('BETTER_AUTH_SECRET');
  if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 random characters.');
  const optional = (name: string) => env[name]?.trim() ?? '';
  // COOLIFY_URL is injected by Coolify as the application's own public URL.
  // Never use it as an API destination or infer an integration from its presence.
  const coolifyUrl = optional('KOPES_COOLIFY_URL');
  const coolifyToken = optional('COOLIFY_API_TOKEN');
  if (!!coolifyUrl !== !!coolifyToken) throw new Error('Set both KOPES_COOLIFY_URL and COOLIFY_API_TOKEN to enable automatic Coolify names.');
  let coolifyOrigin = '';
  if (coolifyUrl) {
    const url = new URL(coolifyUrl);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw new Error('KOPES_COOLIFY_URL must be an HTTPS origin, without /api/v1 (HTTP is allowed only on localhost).');
    }
    coolifyOrigin = url.origin;
  }
  const admin = optional('GITHUB_ADMIN_USER').toLowerCase();
  const adminEmail = optional('AUTH_ADMIN_EMAIL').toLowerCase();
  if (adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error('AUTH_ADMIN_EMAIL must be an email address.');
  if (admin && !isGithubUsername(admin)) throw new Error('GITHUB_ADMIN_USER must be one GitHub username (not an email address).');
  const docker = new URL(env.DOCKER_HOST ?? 'http://socket-proxy:2375');
  if (docker.protocol !== 'http:' || docker.username || docker.password || docker.pathname !== '/' || docker.search || docker.hash) throw new Error('DOCKER_HOST must be an HTTP socket-proxy origin.');
  return {
    origin: origin.origin, secret, admin, adminEmail,
    coolifyOrigin, coolifyToken,
    githubId: optional('GITHUB_CLIENT_ID'), githubSecret: optional('GITHUB_CLIENT_SECRET'),
    googleId: optional('GOOGLE_CLIENT_ID'), googleSecret: optional('GOOGLE_CLIENT_SECRET'),
    microsoftId: optional('MICROSOFT_CLIENT_ID'), microsoftSecret: optional('MICROSOFT_CLIENT_SECRET'),
    smtpUrl: optional('SMTP_URL'), mailFrom: optional('AUTH_EMAIL_FROM'),
    dataDir: resolve(env.DATA_DIR ?? './data'), hostRoot: resolve(env.HOST_ROOT ?? '/host'),
    docker: docker.origin, trivy: env.TRIVY_BIN ?? 'trivy',
  };
}
export type Config = ReturnType<typeof readConfig>;

export function configuredProviders(config: Config) {
  const providers: ('github' | 'google' | 'microsoft')[] = [];
  if (config.githubId && config.githubSecret && config.admin) providers.push('github');
  if (config.googleId && config.googleSecret && config.adminEmail) providers.push('google');
  if (config.microsoftId && config.microsoftSecret && config.adminEmail && config.smtpUrl && config.mailFrom) providers.push('microsoft');
  return providers;
}
