import { z } from 'zod';
import type { Store } from '../store';
import type { Config } from '../config';
import {
  callbacks,
  connectStart,
  finish,
  gitlabApp,
  pause,
  personal,
  personalReader,
  pauseInTransaction,
  saveApp,
  connection,
} from './gitlab';
import { providerReader, sourcePolicy } from './provider';
import { boundedBody } from './body';

const settings = z
  .object({
    origin: z.string().max(2048),
    clientId: z.string().trim().min(1).max(1024),
    password: z.string().max(8192),
    login: z.boolean(),
  })
  .strict();
export async function handleGitlab(
  request: Request,
  store: Store,
  config: Config,
  ctx: { user: string; session: string; admin: boolean; recovery: boolean; recheck: () => Promise<void> },
  read = providerReader(sourcePolicy()),
) {
  const url = new URL(request.url),
    action = url.pathname.replace('/api/data/gitlab', ''),
    app = gitlabApp(store),
    session = JSON.stringify([ctx.user, ctx.session]);
  const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
    json = (value: unknown, status = 200) => Response.json(value, { status, headers });
  try {
    if (request.method === 'POST' && request.headers.get('origin') !== config.origin)
      return json({ error: 'Same origin required.' }, 403);
    if (action === '/settings' || action === '/reset') {
      if (!ctx.admin) return json({ error: 'Administrator required.' }, 403);
      if (request.method === 'GET' && action === '/settings')
        return json({
          origin: app?.origin ?? 'https://gitlab.com',
          clientId: app?.clientId ?? '',
          login: app?.login ?? false,
          callbacks: callbacks(config.origin),
        });
      if (request.method !== 'POST' || !ctx.recovery)
        return json({ error: 'Use the independent administrator login.' }, 403);
      if (action === '/reset') {
        await ctx.recheck();
        store.transaction(() => {
          for (const c of store.db
            .prepare("SELECT id FROM source_connections WHERE auth_kind='gitlab_oauth' AND disconnected=0")
            .all())
            pauseInTransaction(store, String(c.id), true);
          store.db.prepare("DELETE FROM metadata WHERE key='settings.gitlab'").run();
          store.db.exec('DELETE FROM gitlab_attempts');
        });
        return json({ ok: true });
      }
      const b = settings.parse(JSON.parse(await boundedBody(request, 16000)));
      await ctx.recheck();
      if (app && (app.origin !== new URL(b.origin).origin || app.clientId !== b.clientId))
        return json({ error: 'Disconnect the deployment before switching applications.' }, 409);
      saveApp(store, config.secret, b.origin, b.clientId, b.password, b.login);
      return json({ ok: true });
    }
    const grant = personal(store, ctx.user);
    if (action === '' && request.method === 'GET') return json({ configured: !!app, grant });
    if (!app) return json({ error: 'GitLab is not configured.' }, 409);
    if (request.method === 'POST' && action === '/connect')
      return json({ url: connectStart(store, app, config.origin, session).href });
    if (request.method === 'GET' && action === '/callback') {
      await finish(
        store,
        app,
        config.origin,
        config.secret,
        ctx.user,
        session,
        url.searchParams.get('state') ?? '',
        url.searchParams.get('code') ?? '',
        ctx.recheck,
        read,
      );
      return new Response(null, {
        status: 303,
        headers: { ...headers, Location: config.origin + '/repositories/new' },
      });
    }
    if (!grant || grant.origin !== app.origin || url.searchParams.get('connectionId') !== grant.id)
      return json({ error: 'Personal connection unavailable.' }, 404);
    if (request.method === 'POST' && action === '/disconnect') {
      pause(store, String(grant.id), true);
      return json({ ok: true });
    }
    if (request.method === 'GET' && action === '/projects') {
      const page = z.coerce
          .number()
          .int()
          .positive()
          .max(100000)
          .parse(url.searchParams.get('page') ?? 1),
        search = z
          .string()
          .max(300)
          .parse(url.searchParams.get('q') ?? '');
      const reader = personalReader(store, String(grant.id), ctx.user, config.secret, read, () => {});
      const result = await reader(
        connection(app.origin),
        '/api/v4/projects?' +
          new URLSearchParams({ page: String(page), per_page: '30', search, order_by: 'id', sort: 'asc' }),
      );
      const projects = z
        .array(z.object({ id: z.number().int().positive().safe(), path_with_namespace: z.string().min(1) }))
        .max(30)
        .parse(result);
      await ctx.recheck();
      return json({ projects, more: projects.length === 30 });
    }
    return json({ error: 'Not found.' }, 404);
  } catch {
    return json(
      { error: 'GitLab request failed. Check the application, personal consent and approved origin.' },
      400,
    );
  }
}
