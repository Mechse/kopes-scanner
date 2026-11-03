import { betterAuth, APIError } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { isGithubUsername, type Config } from './config';
import type { Store } from './store';

export function isAllowed(login: unknown, config: Config, store: Store) {
  return isGithubUsername(login) && (login.toLowerCase() === config.admin || store.hasUser(login.toLowerCase()));
}
export function createAuth(config: Config, store: Store) {
  return betterAuth({
    appName: 'kopes.dev', baseURL: config.origin, secret: config.secret,
    database: store.db,
    trustedOrigins: [config.origin],
    // Startup runs migrations before serving requests; avoid caching a pre-migration schema failure.
    advanced: { database: { validateSchema: false } },
    socialProviders: { github: {
      clientId: config.githubId, clientSecret: config.githubSecret,
      scope: ['read:user', 'user:email'],
      // Refresh missing or renamed GitHub usernames on existing accounts after allowlist validation.
      overrideUserInfoOnSignIn: true,
      mapProfileToUser(profile) {
        if (!isAllowed(profile.login, config, store)) throw new APIError('FORBIDDEN', { message: 'This GitHub account is not on the installation allowlist.' });
        return { githubLogin: profile.login.toLowerCase() };
      },
    } },
    // Provider mapping needs input enabled; block client profile edits so usernames cannot be forged.
    disabledPaths: ['/update-user'],
    user: { additionalFields: { githubLogin: { type: 'string', required: false, input: true } } },
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60 },
  });
}
export async function migrateAuth(auth: ReturnType<typeof createAuth>) {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
export async function requireSession(request: Request, auth: ReturnType<typeof createAuth>, config: Config, store: Store) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || !isAllowed(session.user.githubLogin, config, store)) throw new Response('Sign in with an allowed GitHub account.', { status: 401 });
  return session;
}
export function requireSameOrigin(request: Request, origin: string) {
  if (request.headers.get('origin') !== origin) throw new Response('Origin not allowed.', { status: 403 });
}
