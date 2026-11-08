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
  const admin = required('GITHUB_ADMIN_USER').toLowerCase();
  if (!isGithubUsername(admin)) throw new Error('GITHUB_ADMIN_USER must be one GitHub username (not an email address).');
  const docker = new URL(env.DOCKER_HOST ?? 'http://socket-proxy:2375');
  if (docker.protocol !== 'http:' || docker.username || docker.password || docker.pathname !== '/' || docker.search || docker.hash) throw new Error('DOCKER_HOST must be an HTTP socket-proxy origin.');
  return {
    origin: origin.origin, secret, admin,
    githubId: required('GITHUB_CLIENT_ID'), githubSecret: required('GITHUB_CLIENT_SECRET'),
    dataDir: resolve(env.DATA_DIR ?? './data'), hostRoot: resolve(env.HOST_ROOT ?? '/host'),
    docker: docker.origin, trivy: env.TRIVY_BIN ?? 'trivy',
  };
}
export type Config = ReturnType<typeof readConfig>;
