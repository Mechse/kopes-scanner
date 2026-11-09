import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { configuredProviders, isGithubUsername, type Config } from './config';
import { createAuth, requireSameOrigin } from './auth';
import type { Store } from './store';

const key = 'settings.authentication';
const providers = ['github', 'google', 'microsoft'] as const;
type Provider = typeof providers[number];
type Overrides = Partial<Pick<Config, 'githubId' | 'githubSecret' | 'googleId' | 'googleSecret' | 'microsoftId' | 'microsoftSecret' | 'admin' | 'adminEmail' | 'smtpUrl' | 'mailFrom'>>;
const encryptionKey = (secret: string) => createHash('sha256').update(`kopes.auth.settings\0${secret}`).digest();
function encode(value: Overrides, secret: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
function readOverrides(store: Store, config: Config): Overrides {
  const saved = store.getMeta(key);
  if (!saved) return {};
  const data = Buffer.from(saved, 'base64'), cipher = createDecipheriv('aes-256-gcm', encryptionKey(config.secret), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'));
}
export function readAuthConfig(store: Store, base: Config): Config { return { ...base, ...readOverrides(store, base) }; }
// Every request gets a matching config/auth snapshot, including after a settings update.
export function savedAuthRuntime(store: Store, base: Config) {
  let previous: string | undefined, snapshot: { config: Config; auth: ReturnType<typeof createAuth> } | undefined;
  return () => {
    const saved = store.getMeta(key);
    if (!snapshot || saved !== previous) {
      const config = readAuthConfig(store, base);
      snapshot = { config, auth: createAuth(config, store) };
      previous = saved;
    }
    return snapshot;
  };
}
const text = z.string().trim().max(8192);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), provider: z.enum(providers), clientId: text.min(1), clientSecret: text, administrator: text.min(1) }).strict(),
  z.object({ action: z.literal('disable'), provider: z.enum(providers) }).strict(),
  z.object({ action: z.literal('mail'), smtpUrl: text, mailFrom: z.email().max(320) }).strict(),
]);
export async function handleAuthSettings(request: Request, isAdmin: boolean, currentProvider: Provider, store: Store, base: Config) {
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (!isAdmin) return json({ error: 'Administrator access required.' }, 403);
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
  if (request.method === 'POST') requireSameOrigin(request, base.origin);
  const parsed = request.method === 'POST' ? schema.safeParse(await request.json().catch(() => null)) : undefined;
  if (parsed && !parsed.success) return json({ error: 'Enter valid sign-in settings.' }, 400);
  const overrides = readOverrides(store, base), config = { ...base, ...overrides };
  const publicState = (value: Config, saved: Overrides) => ({
    origin: value.origin, currentProvider,
    providers: providers.map(provider => ({ provider, clientId: value[`${provider}Id`], hasSecret: !!value[`${provider}Secret`],
      administrator: provider === 'github' ? value.admin : value.adminEmail,
      enabled: configuredProviders(value).includes(provider), source: `${provider}Id` in saved ? 'settings' : 'environment' })),
    mail: { configured: !!(value.smtpUrl && value.mailFrom), hasSmtpUrl: !!value.smtpUrl, mailFrom: value.mailFrom },
  });
  if (request.method === 'GET') return json(publicState(config, overrides));
  if (!parsed?.success) return json({ error: 'Enter valid sign-in settings.' }, 400);
  const body = parsed.data, next = { ...overrides };
  if (body.action === 'mail') {
    if (currentProvider === 'microsoft') return json({ error: 'Sign in with another method before changing Microsoft email delivery.' }, 400);
    const smtpUrl = body.smtpUrl || config.smtpUrl;
    try {
      const url = new URL(smtpUrl);
      if (!['smtp:', 'smtps:'].includes(url.protocol) || !url.hostname || url.search || url.hash) throw new Error();
    } catch { return json({ error: 'Enter a valid smtp:// or smtps:// mail server URL.' }, 400); }
    next.smtpUrl = smtpUrl; next.mailFrom = body.mailFrom;
  } else {
    if (body.provider === currentProvider) return json({ error: 'Sign in with another method before changing or disabling your current sign-in method.' }, 400);
    if (body.action === 'disable') {
      next[`${body.provider}Id`] = ''; next[`${body.provider}Secret`] = '';
    } else {
      const administrator = body.administrator.toLowerCase();
      if (body.provider === 'github' ? !isGithubUsername(administrator) : !z.email().safeParse(administrator).success) return json({ error: 'Enter a valid administrator username or email address.' }, 400);
      if (body.provider !== 'github' && config.adminEmail && administrator !== config.adminEmail && configuredProviders(config).some(p => p !== 'github')) return json({ error: 'Google and Microsoft share the existing administrator email address.' }, 400);
      const secret = body.clientSecret || (body.clientId === config[`${body.provider}Id`] ? config[`${body.provider}Secret`] : '');
      if (!secret) return json({ error: 'Enter a client secret. Changing the client ID requires a new secret.' }, 400);
      next[`${body.provider}Id`] = body.clientId; next[`${body.provider}Secret`] = secret;
      if (body.provider === 'github') next.admin = administrator; else next.adminEmail = administrator;
    }
  }
  const candidate = { ...base, ...next };
  if (!configuredProviders(candidate).includes(currentProvider)) return json({ error: 'Keep your current sign-in method enabled.' }, 400);
  if (body.action === 'save' && !configuredProviders(candidate).includes(body.provider)) return json({ error: 'Configure email delivery before enabling Microsoft sign-in.' }, 400);
  store.setMeta(key, encode(next, base.secret));
  return json(publicState(candidate, next));
}
