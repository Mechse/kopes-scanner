import { resolve } from 'node:path';

export function allowedUsers(value: string) {
  return new Set(value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
}
export function isAllowed(login: unknown, users: Set<string>) {
  return typeof login === 'string' && users.has(login.toLowerCase());
}
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Set ${name}. Run pnpm run setup in the scanner repository for guided setup.`);
    return value;
  };
  const origin = new URL(required('BETTER_AUTH_URL'));
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password ||
    !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) {
    throw new Error('BETTER_AUTH_URL must be an HTTPS origin (HTTP is allowed only on localhost).');
  }
  const secret = required('BETTER_AUTH_SECRET');
  if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 random characters.');
  const users = allowedUsers(required('GITHUB_ALLOWED_USERS'));
  if (!users.size || [...users].some(u => !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/.test(u))) throw new Error('GITHUB_ALLOWED_USERS must contain GitHub usernames, separated by commas.');
  const intervalHours = Number(env.SCAN_INTERVAL_HOURS ?? 6);
  if (!Number.isFinite(intervalHours) || intervalHours < 1 || intervalHours > 168) throw new Error('SCAN_INTERVAL_HOURS must be between 1 and 168.');
  const docker = new URL(env.DOCKER_HOST ?? 'http://socket-proxy:2375');
  if (docker.protocol !== 'http:' || docker.username || docker.password || docker.pathname !== '/' || docker.search || docker.hash) throw new Error('DOCKER_HOST must be an HTTP socket-proxy origin.');
  return {
    origin: origin.origin, secret, users, intervalHours,
    githubId: required('GITHUB_CLIENT_ID'), githubSecret: required('GITHUB_CLIENT_SECRET'),
    dataDir: resolve(env.DATA_DIR ?? './data'), hostRoot: resolve(env.HOST_ROOT ?? '/host'),
    docker: docker.origin, trivy: env.TRIVY_BIN ?? 'trivy',
  };
}
export type Config = ReturnType<typeof readConfig>;
