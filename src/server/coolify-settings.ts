import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Config } from './config';
import type { Store } from './store';
import { requireSameOrigin } from './auth';
import { coolifyOrigin, createCoolifyLookup, testCoolifyConnection } from './coolify';

const key = 'connection.coolify';
type Connection = { url: string; token: string; source: 'settings' | 'environment' | 'none' };
type Options = Pick<Config, 'secret' | 'origin' | 'coolifyOrigin' | 'coolifyToken'>;
const encryptionKey = (secret: string) => createHash('sha256').update(`kopes.coolify.token\0${secret}`).digest();

function encrypt(token: string, secret: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}
function decrypt(value: string, secret: string) {
  const data = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}
export function readCoolifyConnection(store: Store, config: Options): Connection {
  const saved = store.getMeta(key);
  if (saved !== undefined) {
    const data = JSON.parse(saved) as { url: string; token: string };
    return { url: data.url, token: data.token ? decrypt(data.token, config.secret) : '', source: 'settings' };
  }
  return { url: config.coolifyOrigin, token: config.coolifyToken, source: config.coolifyOrigin ? 'environment' : 'none' };
}
function publicConnection(connection: Connection) {
  return { url: connection.url, hasToken: !!connection.token, source: connection.source, enabled: !!(connection.url && connection.token) };
}

export async function handleCoolifySettings(request: Request, isAdmin: boolean, store: Store, config: Options, fetcher: typeof fetch = fetch) {
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (!isAdmin) return json({ error: 'Administrator access required.' }, 403);
  if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (request.method === 'POST') requireSameOrigin(request, config.origin);
  // Disconnect and replacement must remain possible if the encryption key changed.
  let current: Connection;
  try { current = readCoolifyConnection(store, config); }
  catch { current = { url: '', token: '', source: 'settings' }; }
  if (request.method === 'GET') return json(publicConnection(current));
  const body = await request.json().catch(() => null);
  if (!body || !['save', 'test', 'disconnect'].includes(body.action)) return json({ error: 'Invalid connection action.' }, 400);
  if (body.action === 'disconnect') {
    store.setMeta(key, JSON.stringify({ url: '', token: '' }));
    return json(publicConnection({ url: '', token: '', source: 'settings' }));
  }
  if (typeof body.url !== 'string' || body.url.length > 2048 || (body.token !== undefined && (typeof body.token !== 'string' || body.token.length > 8192))) return json({ error: 'Enter a Coolify URL and API token.' }, 400);
  let url: string;
  try { url = coolifyOrigin(body.url.trim()); } catch (error) { return json({ error: (error as Error).message }, 400); }
  // Never forward an existing credential to a different destination.
  const token = body.token?.trim() || (url === current.url ? current.token : '');
  if (!token || /[\r\n]/.test(token)) return json({ error: url !== current.url && current.token ? 'Enter a new token when changing the Coolify URL.' : 'Enter a read-only Coolify API token.' }, 400);
  if (body.action === 'test') {
    try { return json({ ok: true, counts: await testCoolifyConnection(url, token, fetcher) }); }
    catch (error) { return json({ error: (error as Error).message }, 502); }
  }
  store.setMeta(key, JSON.stringify({ url, token: encrypt(token, config.secret) }));
  return json(publicConnection({ url, token, source: 'settings' }));
}

export function savedCoolifyLookup(store: Store, config: Options) {
  let previous = '', lookup: ReturnType<typeof createCoolifyLookup> | undefined;
  return async () => {
    let connection: Connection;
    try { connection = readCoolifyConnection(store, config); }
    catch { console.warn('Unable to decrypt Coolify connection. Re-enter it in Settings.'); return () => undefined; }
    const identity = JSON.stringify([connection.url, connection.token]);
    if (identity !== previous) {
      previous = identity;
      lookup = connection.url && connection.token ? createCoolifyLookup(connection.url, connection.token) : undefined;
    }
    return lookup ? lookup() : () => undefined;
  };
}
