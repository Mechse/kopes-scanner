import { betterAuth, APIError } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { gitlabLogin } from './gitlab-login';
import { gitlabApp } from './source/gitlab';
import { microsoftIdentity } from '../lib/microsoft-identity';
import { configuredProviders, isGithubUsername, type Config } from './config';
import type { Store } from './store';

function microsoftAccount(profile: object) {
  const { tid, oid } = profile as { tid?: string; oid?: string };
  const id = `microsoft:${tid}:${oid}`.toLowerCase();
  if (!microsoftIdentity.test(id)) throw new APIError('FORBIDDEN', { message: 'Missing Microsoft identity.' });
  return id;
}
function microsoftAllowed(id: string, config: Config, store: Store) {
  return configuredProviders(config).includes('microsoft') && microsoftIdentity.test(id) && (id === config.microsoftAdmin || store.hasUser(id, id));
}
export function isAllowed(login: unknown, config: Config, store: Store, githubId?: string) {
  return isGithubUsername(login) && (login.toLowerCase() === config.admin || store.hasUser(login.toLowerCase(), githubId));
}
export function createAuth(config: Config, store: Store, gitlabRead?: Parameters<typeof gitlabLogin>[2]) {
  const providers = configuredProviders(config);
  const mapEmailProfile = (provider: string, id: string, email: unknown) => {
    const login = typeof email === 'string' ? email.toLowerCase() : '';
    if (!id || !login.includes('@') || !(login === config.adminEmail || store.hasUser(login, `${provider}:${id}`))) {
      throw new APIError('FORBIDDEN', { message: 'This account does not have access. Ask your administrator to add your email address.' });
    }
    return { accessLogin: login, accessId: `${provider}:${id}` };
  };
  return betterAuth({
    appName: 'kopes.dev', baseURL: config.origin, secret: config.secret,
    database: store.db,
    plugins: [...gitlabLogin(store,config,gitlabRead), { id: 'tenant-scoped-microsoft', init(ctx) {
      const ms = ctx.socialProviders.find(provider => provider.id === 'microsoft');
      if (ms) ms.accountSubject = ({ profile }) => microsoftAccount(profile);
    } }],
    trustedOrigins: [config.origin],
    // Startup runs migrations before serving requests; avoid caching a pre-migration schema failure.
    advanced: { database: { validateSchema: false } },
    socialProviders: {
      ...(providers.includes('google') ? { google: {
        clientId: config.googleId, clientSecret: config.googleSecret,
        requireEmailVerification: true,
        mapProfileToUser(profile) {
          if (!profile.email_verified) throw new APIError('FORBIDDEN', { message: 'Verify your Google email before signing in.' });
          return mapEmailProfile('google', profile.sub, profile.email);
        },
      } } : {}),
      ...(providers.includes('microsoft') ? { microsoft: {
        clientId: config.microsoftId, clientSecret: config.microsoftSecret, tenantId: 'common',
        disableProfilePhoto: true,
        mapProfileToUser(profile) {
          const id = microsoftAccount(profile);
          store.db.prepare('INSERT INTO microsoft_requests VALUES (?,?) ON CONFLICT(identifier) DO UPDATE SET email=excluded.email').run(id, typeof profile.email === 'string' ? profile.email.slice(0, 320) : '');
          if (!microsoftAllowed(id, config, store)) throw new APIError('FORBIDDEN', { message: 'Ask your administrator to approve your Microsoft account, then sign in again.' });
          // Better Auth requires a unique email. Never use the tenant-supplied label for account lookup.
          return { email: `${profile.oid}@${profile.tid}.microsoft.invalid`.toLowerCase(), emailVerified: false, accessLogin: id, accessId: id };
        },
      } } : {}),
      ...(providers.includes('github') ? { github: {
      clientId: config.githubId, clientSecret: config.githubSecret,
      scope: ['read:user', 'user:email'],
      // Refresh missing or renamed GitHub usernames on existing accounts after allowlist validation.
      overrideUserInfoOnSignIn: true,
      async getUserInfo(token) {
        if (!token.accessToken) return null;
        const headers = { Authorization: `Bearer ${token.accessToken}`, 'User-Agent': 'kopes-scanner', Accept: 'application/vnd.github+json' };
        const read = async (url: string) => {
          const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(10_000) });
          if (!response.ok) throw new APIError('BAD_GATEWAY', { message: 'Unable to verify your GitHub account. Please try again.' });
          return response.json();
        };
        const profile = await read('https://api.github.com/user');
        if (!isGithubUsername(profile.login) || !Number.isSafeInteger(profile.id) || profile.id <= 0) return null;
        const emails: { email: string; verified: boolean; primary: boolean }[] = [];
        for (let page = 1; ; page++) {
          const batch = await read(`https://api.github.com/user/emails?per_page=100&page=${page}`);
          if (!Array.isArray(batch)) return null;
          emails.push(...batch);
          if (batch.length < 100) break;
          if (page >= 10) return null;
        }
        const verified = emails.filter(item => item.verified === true && typeof item.email === 'string');
        const email = (verified.find(item => item.primary) ?? verified[0])?.email ?? null;
        if (!email) throw new APIError('FORBIDDEN', { message: 'Verify an email address on GitHub before signing in.' });
        const login = profile.login.toLowerCase();
        if (!store.matchGithubProfile({ id: String(profile.id), login, name: profile.name ?? login,
          email, image: profile.avatar_url ?? null }, verified.map(item => item.email.toLowerCase()), config.admin)) {
          throw new APIError('FORBIDDEN', { message: 'This GitHub account does not have access. Ask the administrator to add your handle or a verified GitHub email.' });
        }
        return { user: { name: profile.name || login, email, image: profile.avatar_url, emailVerified: true,
          githubLogin: login, githubId: String(profile.id) }, data: profile };
      },
      mapProfileToUser(profile) {
        if (!isAllowed(profile.login, config, store)) throw new APIError('FORBIDDEN', { message: 'This GitHub account is not on the installation allowlist.' });
        return { githubLogin: profile.login.toLowerCase() };
      },
    } } : {}),
    },
    databaseHooks: { session: { create: { before: async session => {
      const user = store.db.prepare('SELECT * FROM user WHERE id=?').get(session.userId);
      if (!user) return false;
      if (String(user.accessId).startsWith('microsoft:')) {
        const id = String(user.accessId);
        if (!microsoftAllowed(id, config, store) || !store.matchGithubProfile({ id, login: id, name: String(user.name), email: null, image: null }, [], config.microsoftAdmin)) return false;
      } else if (user.accessId) {
        if (!user.emailVerified || !store.matchGithubProfile({ id: String(user.accessId), login: String(user.accessLogin),
          name: String(user.name), email: String(user.email), image: user.image ? String(user.image) : null },
          [String(user.email).toLowerCase()], config.adminEmail)) return false;
      } else if (!isAllowed(user.githubLogin, config, store, user.githubId ? String(user.githubId) : undefined)) return false;
      return { data: session };
    }, after: async session => {
      const user = store.db.prepare('SELECT githubLogin, accessLogin FROM user WHERE id=?').get(session.userId);
      if (user?.githubLogin || user?.accessLogin) store.db.prepare('UPDATE access_profiles SET last_sign_in=? WHERE login=?').run(Date.now(), user.githubLogin ?? user.accessLogin);
    } } } },
    // Provider mapping needs input enabled; block client profile edits so usernames cannot be forged.
    disabledPaths: ['/update-user'],
    user: { additionalFields: { accessLogin: { type: 'string', required: false, input: true }, accessId: { type: 'string', required: false, input: true }, githubLogin: { type: 'string', required: false, input: true }, githubId: { type: 'string', required: false, input: true } } },
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
  if (session?.user.accessId?.startsWith('gitlab:')) {
    const app=gitlabApp(store);
    if (!app?.login || JSON.parse(session.user.accessId.slice(7))[0]!==app.origin) throw new Response('GitLab sign-in unavailable.',{status:401});
  }
  if (session?.user.accessId?.startsWith('microsoft:')) {
    const id = session.user.accessId;
    if (!microsoftAllowed(id, config, store)) throw new Response('Microsoft account not approved.', { status: 401 });
    return session;
  }
  if (!session || !(session.user.accessId
    ? session.user.emailVerified && (session.user.accessLogin === config.adminEmail || store.hasUser(session.user.accessLogin ?? '', session.user.accessId))
    : isAllowed(session.user.githubLogin, config, store, session.user.githubId ?? undefined))) throw new Response('Sign in with an allowed account.', { status: 401 });
  return session;
}
export function requireSameOrigin(request: Request, origin: string) {
  if (request.headers.get('origin') !== origin) throw new Response('Origin not allowed.', { status: 403 });
}

export function isAdministrator(user: { accessId?: string | null; githubLogin?: string | null; accessLogin?: string | null; emailVerified: boolean }, config: Config) {
  if (user.accessId?.startsWith('microsoft:')) return configuredProviders(config).includes('microsoft') && microsoftIdentity.test(user.accessId) && user.accessId === config.microsoftAdmin;
  return Boolean(config.admin && user.githubLogin?.toLowerCase() === config.admin || config.adminEmail && user.emailVerified && user.accessLogin === config.adminEmail);
}
