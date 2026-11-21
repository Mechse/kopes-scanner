import { z } from 'zod';
import { requireSameOrigin } from './auth';
import type { Config } from './config';
import type { Store } from './store';
import { seal } from './source/credentials';
import { sendTelegram, telegramKey, type TelegramConnection } from './telegram';

const form = z.discriminatedUnion('action', [
  z.object({ action: z.literal('connect'), chat: z.string().trim().regex(/^-?[1-9]\d{0,19}$/), token: z.string().trim().regex(/^\d{1,20}:[A-Za-z0-9_-]{20,128}$/) }).strict(),
  z.object({ action: z.literal('disconnect') }).strict(),
]);
export async function telegramSettings(request: Request, admin: boolean, store: Store, config: Config, http = fetch) {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (!admin) return json({ error: 'Administrator access required.' }, 403);
  const previous = store.getMeta(telegramKey);
  const saved: TelegramConnection | null = previous ? JSON.parse(previous) : null;
  if (request.method === 'GET') return json({ chat: saved?.chat ?? '' });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  requireSameOrigin(request, config.origin);
  const input = form.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: 'Enter a valid bot token and numeric chat ID.' }, 400);
  let next = '';
  if (input.data.action === 'connect') {
    const { token, chat } = input.data;
    try { await sendTelegram(token, chat, 'Telegram test from kopes.dev. This chat will receive workspace CVE alerts.', http); }
    catch { return json({ error: 'Test message failed. Check the token, chat ID, and bot permissions.' }, 400); }
    next = JSON.stringify({ chat, token: seal(token, config.secret, telegramKey) });
  }
  if (store.getMeta(telegramKey) !== previous) return json({ error: 'Settings changed. Reload and try again.' }, 409);
  store.transaction(() => {
    store.setMeta(telegramKey, next);
    store.db.exec('DELETE FROM telegram_outbox');
  });
  return json({ chat: input.data.action === 'connect' ? input.data.chat : '' });
}
