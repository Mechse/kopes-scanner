import { betterAuth, APIError } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import nodemailer from 'nodemailer';
import { configuredProviders, isGithubUsername, type Config } from './config';
import type { Store } from './store';

export function isAllowed(login: unknown, config: Config, store: Store, githubId?: string) {
  return isGithubUsername(login) && (login.toLowerCase() === config.admin || store.hasUser(login.toLowerCase(), githubId));
}
export function createAuth(config: Config, store: Store) {
  const providers = configuredProviders(config);
  const mail = providers.includes('microsoft') ? nodemailer.createTransport(config.smtpUrl) : null;
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
    trustedOrigins: [config.origin],
    // Startup runs migrations before serving requests; avoid caching a pre-migration schema failure.
    advanced: { database: { validateSchema: false } },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: false,
      async sendVerificationEmail({ user, url }) {
        if (!mail) throw new APIError('SERVICE_UNAVAILABLE', { message: 'Email verification is not configured.' });
        await mail.sendMail({ from: config.mailFrom, to: user.email, subject: 'Verify your kopes.dev sign-in',
          text: `Verify your email to finish signing in to kopes.dev:\n\n${url}\n\nAfter verification, sign in with Microsoft again. If you did not request this, ignore this email.` });
      },
    },
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
        requireEmailVerification: true, disableProfilePhoto: true,
        mapProfileToUser(profile) {
          // Entra emails are tenant-controlled: always require local mailbox verification.
          return { ...mapEmailProfile('microsoft', profile.oid, profile.email), emailVerified: false };
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
      if (user.accessId) {
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
  if (!session || !(session.user.accessId
    ? session.user.emailVerified && (session.user.accessLogin === config.adminEmail || store.hasUser(session.user.accessLogin ?? '', session.user.accessId))
    : isAllowed(session.user.githubLogin, config, store, session.user.githubId ?? undefined))) throw new Response('Sign in with an allowed account.', { status: 401 });
  return session;
}
export function requireSameOrigin(request: Request, origin: string) {
  if (request.headers.get('origin') !== origin) throw new Response('Origin not allowed.', { status: 403 });
}

export function isAdministrator(user: { githubLogin?: string | null; accessLogin?: string | null; emailVerified: boolean }, config: Config) {
  return Boolean(config.admin && user.githubLogin?.toLowerCase() === config.admin || config.adminEmail && user.emailVerified && user.accessLogin === config.adminEmail);
}
