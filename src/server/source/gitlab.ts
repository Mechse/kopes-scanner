import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Store } from '../store';
import { seal, unseal } from './credentials';
import { providerReader, ProviderError, sourcePolicy, validateOrigin, type ReadJson } from './provider';

const key = 'settings.gitlab';
export type App = { origin: string; clientId: string; secret: string; login: boolean; revision: string };
export const callbacks = (origin: string) => ({
  login: origin + '/api/auth/callback/gitlab',
  connect: origin + '/api/data/gitlab/callback',
});
export const hash = (s: string) => createHash('sha256').update(s).digest('base64url');
const random = () => randomBytes(32).toString('base64url');
export function gitlabApp(store: Store): App | undefined {
  const s = store.getMeta(key);
  return s ? JSON.parse(s) : undefined;
}
export function saveApp(
  store: Store,
  secret: string,
  origin: string,
  clientId: string,
  password: string,
  login: boolean,
) {
  origin = validateOrigin({ provider: 'gitlab', origin, token: '' }, sourcePolicy());
  store.transaction(() => {
    const old = gitlabApp(store),
      same = old?.origin === origin && old.clientId === clientId;
    if (
      !same &&
      (old ||
        store.db
          .prepare("SELECT 1 FROM source_connections WHERE auth_kind='gitlab_oauth' AND disconnected=0")
          .get())
    )
      throw new Error('Disconnect the deployment first.');
    const ciphertext = password
      ? seal(password, secret, JSON.stringify([origin, clientId]))
      : same && old.secret;
    if (!ciphertext || !clientId) throw new Error('Application credentials required.');
    store.setMeta(
      key,
      JSON.stringify({ origin, clientId, secret: ciphertext, login, revision: randomUUID() }),
    );
  });
}
export function attempt(
  store: Store,
  app: App,
  purpose: 'login' | 'connect',
  session: string,
  verifier: string,
) {
  const state = random();
  store.db.prepare('DELETE FROM gitlab_attempts WHERE expires<=?').run(Date.now());
  store.db
    .prepare('INSERT INTO gitlab_attempts VALUES (?,?,?,?,?,?)')
    .run(hash(state), app.revision, purpose, session, verifier, Date.now() + 600000);
  return state;
}
export function claim(store: Store, app: App, state: string, purpose: string, session: string) {
  const row = store.db
    .prepare(
      'DELETE FROM gitlab_attempts WHERE hash=? AND purpose=? AND session=? AND revision=? AND expires>? RETURNING verifier',
    )
    .get(hash(state), purpose, session, app.revision, Date.now());
  if (!row) throw new Error('Consent expired or mismatched.');
  return String(row.verifier);
}
export function authorize(
  app: App,
  redirect: string,
  scope: 'openid email' | 'read_api',
  state: string,
  verifier: string,
) {
  const url = new URL('/oauth/authorize', app.origin);
  url.search = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope,
    state,
    code_challenge_method: 'S256',
    code_challenge: hash(verifier),
  }).toString();
  return url;
}
export const connection = (origin: string, token = '') => ({
  provider: 'gitlab' as const,
  origin,
  token,
  bearer: true,
});
export async function exchange(
  app: App,
  secret: string,
  fields: Record<string, string>,
  scope: string,
  read = providerReader(sourcePolicy()),
) {
  const value = await read(
    connection(app.origin),
    '/oauth/token',
    new URLSearchParams({
      ...fields,
      client_id: app.clientId,
      client_secret: unseal(app.secret, secret, JSON.stringify([app.origin, app.clientId])),
    }),
  );
  if (
    typeof value.access_token !== 'string' ||
    !value.access_token ||
    /\s/.test(value.access_token) ||
    typeof value.scope !== 'string' ||
    value.scope.split(' ').sort().join(' ') !== scope.split(' ').sort().join(' ')
  )
    throw new Error('Unexpected GitLab token.');
  return value;
}
export const connectStart = (store: Store, app: App, origin: string, session: string) => {
  const verifier = random();
  return authorize(
    app,
    callbacks(origin).connect,
    'read_api',
    attempt(store, app, 'connect', session, verifier),
    verifier,
  );
};
type Tokens = { access: string; refresh: string; expires: number };
function encryptTokens(value: any, secret: string, aad: string) {
  if (
    typeof value.refresh_token !== 'string' ||
    !value.refresh_token ||
    !Number.isSafeInteger(value.expires_in) ||
    value.expires_in <= 0
  )
    throw new Error('Invalid GitLab grant.');
  return seal(
    JSON.stringify({
      access: value.access_token,
      refresh: value.refresh_token,
      expires: Date.now() + 1000 * value.expires_in,
    }),
    secret,
    aad,
  );
}
export function personal(store: Store, user: string) {
  return store.db
    .prepare(
      `SELECT c.id,c.origin,c.owner_login,c.health,c.credential_version,g.subject FROM source_connections c JOIN gitlab_grants g ON g.connection_id=c.id WHERE g.user_id=? AND c.disconnected=0`,
    )
    .get(user);
}
export function pause(store: Store, id: string, disconnect = false, project?: string) {
  store.transaction(() => pauseInTransaction(store, id, disconnect, project));
}
export function pauseInTransaction(store: Store, id: string, disconnect = false, project?: string) {
  if (!project) {
    if (disconnect)
      store.db
        .prepare(
          `DELETE FROM gitlab_attempts WHERE purpose='connect' AND json_valid(session) AND json_extract(session,'$[0]')=(SELECT user_id FROM gitlab_grants WHERE connection_id=?)`,
        )
        .run(id);
    store.db.prepare("UPDATE gitlab_grants SET tokens='' WHERE connection_id=?").run(id);
    store.db
      .prepare(
        "UPDATE source_connections SET health='Reauthorization required',credential_version=credential_version+1,disconnected=MAX(disconnected,?) WHERE id=? AND auth_kind='gitlab_oauth'",
      )
      .run(Number(disconnect), id);
  }
  store.db
    .prepare(
      `UPDATE source_bindings SET access_status='blocked',error='Reauthorization required',access_revision=access_revision+1 WHERE connection_id=? AND (? IS NULL OR repository_id IN (SELECT id FROM source_repositories WHERE provider_id=?))`,
    )
    .run(id, project ?? null, project ?? null);
  store.db
    .prepare(
      "UPDATE source_jobs SET state='cancelled' WHERE state IN ('queued','running') AND binding_id IN (SELECT id FROM source_bindings WHERE connection_id=? AND access_status='blocked')",
    )
    .run(id);
}
export async function finish(
  store: Store,
  app: App,
  origin: string,
  secret: string,
  user: string,
  session: string,
  state: string,
  code: string,
  recheck: () => Promise<void>,
  read = providerReader(sourcePolicy()),
) {
  const verifier = claim(store, app, state, 'connect', session),
    before = personal(store, user);
  const value = await exchange(
    app,
    secret,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbacks(origin).connect,
      code_verifier: verifier,
    },
    'read_api',
    read,
  );
  const profile = await read(connection(app.origin, value.access_token), '/api/v4/user');
  if (
    !Number.isSafeInteger(profile.id) ||
    profile.id < 1 ||
    typeof profile.username !== 'string' ||
    !profile.username
  )
    throw new Error('Invalid GitLab identity.');
  await recheck();
  store.transaction(() => {
    const existing = personal(store, user);
    if (
      gitlabApp(store)?.revision !== app.revision ||
      existing?.id !== before?.id ||
      existing?.credential_version !== before?.credential_version ||
      (existing && (existing.origin !== app.origin || existing.subject !== String(profile.id)))
    )
      throw new Error('Disconnect first.');
    const previous = store.db
      .prepare(
        'SELECT c.id FROM source_connections c JOIN gitlab_grants g ON g.connection_id=c.id WHERE c.origin=? AND g.user_id=? AND g.subject=?',
      )
      .get(app.origin, user, String(profile.id));
    const id = String(previous?.id ?? randomUUID());
    store.db
      .prepare(
        `INSERT INTO source_connections(id,provider,origin,credential,auth_kind,owner_login,health) VALUES (?,'gitlab',?,'','gitlab_oauth',?,'connected') ON CONFLICT(id) DO UPDATE SET owner_login=excluded.owner_login,disconnected=0,health='connected',credential_version=credential_version+1`,
      )
      .run(id, app.origin, profile.username);
    store.db
      .prepare(
        'INSERT INTO gitlab_grants(connection_id,user_id,subject,tokens) VALUES (?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET tokens=excluded.tokens,refresh_until=0',
      )
      .run(
        id,
        user,
        String(profile.id),
        encryptTokens(value, secret, JSON.stringify([id, app.origin, user])),
      );
  });
}
const pending = new WeakMap<Store, Map<string, Promise<string>>>();
export function personalReader(
  store: Store,
  id: string,
  user: string,
  secret: string,
  read: ReadJson,
  check: () => void,
  project?: string,
): ReadJson {
  function grant() {
    check();
    const row = store.db
      .prepare(
        `SELECT g.tokens,c.origin,c.credential_version FROM gitlab_grants g JOIN source_connections c ON c.id=g.connection_id WHERE c.id=? AND g.user_id=? AND c.disconnected=0 AND c.health='connected'`,
      )
      .get(id, user);
    if (!row || gitlabApp(store)?.origin !== row.origin) throw new Error('Reauthorization required');
    return row;
  }
  const revision = grant().credential_version;
  function current() {
    const r = grant();
    if (r.credential_version !== revision) throw new Error('Connection changed.');
    return r;
  }
  return async (_, path) => {
    const row = current(),
      origin = String(row.origin),
      aad = JSON.stringify([id, origin, user]);
    const tokens: Tokens = JSON.parse(unseal(String(row.tokens), secret, aad));
    let token = tokens.access;
    if (tokens.expires <= Date.now() + 60000) {
      let map = pending.get(store);
      if (!map) {
        map = new Map();
        pending.set(store, map);
      }
      const k = id + ':' + revision;
      let work = map.get(k);
      if (!work) {
        work = (async () => {
          const deadline = Date.now() + 35000;
          let lease: number;
          while (
            !store.db
              .prepare(
                'UPDATE gitlab_grants SET refresh_until=? WHERE connection_id=? AND tokens=? AND refresh_until<=?',
              )
              .run((lease = Date.now() + 60000), id, row.tokens, Date.now()).changes
          ) {
            const latest = current();
            if (latest.tokens !== row.tokens)
              return (JSON.parse(unseal(String(latest.tokens), secret, aad)) as Tokens).access;
            if (Date.now() >= deadline) throw new Error('GitLab refresh busy.');
            await new Promise((r) => setTimeout(r, 100));
          }
          try {
            const app = gitlabApp(store);
            if (app?.origin !== origin) throw new Error('Connection changed.');
            const fresh = await exchange(
              app,
              secret,
              { grant_type: 'refresh_token', refresh_token: tokens.refresh },
              'read_api',
              read,
            );
            current();
            const encrypted = encryptTokens(fresh, secret, aad);
            if (
              !store.db
                .prepare('UPDATE gitlab_grants SET tokens=? WHERE connection_id=? AND tokens=?')
                .run(encrypted, id, row.tokens).changes
            )
              throw new Error('Connection changed.');
            return fresh.access_token as string;
          } catch (e) {
            if (
              current().tokens === row.tokens &&
              e instanceof ProviderError &&
              [400, 401].includes(e.status)
            )
              pause(store, id);
            throw e;
          } finally {
            store.db
              .prepare('UPDATE gitlab_grants SET refresh_until=0 WHERE connection_id=? AND refresh_until=?')
              .run(id, lease);
          }
        })().finally(() => map!.delete(k));
        map.set(k, work);
      }
      token = await work;
    }
    current();
    try {
      const result = await read(connection(origin, token), path);
      current();
      return result;
    } catch (e) {
      current();
      if (e instanceof ProviderError) {
        if (
          e.status === 401 &&
          (JSON.parse(unseal(String(current().tokens), secret, aad)) as Tokens).access === token
        )
          pause(store, id);
        else if (
          project &&
          [403, 404].includes(e.status) &&
          (path === `/api/v4/projects/${project}` ||
            path.startsWith(`/api/v4/projects/${project}/repository/branches/`) ||
            (e.status === 403 && path.startsWith(`/api/v4/projects/${project}/repository/`)))
        )
          pause(store, id, false, project);
      }
      throw e;
    }
  };
}
