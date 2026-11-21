import type { Store } from './store';
import { isCve } from '../lib/advisory';
import { unseal } from './source/credentials';

export const telegramKey = 'settings.telegram';
export type TelegramConnection = { chat: string; token: string };

export function enqueueTelegram(store: Store, resource: string, current: string[], previous: string[]) {
  const known = new Set(previous.map(id => id.toUpperCase()));
  const fresh = [...new Set(current.map(id => id.toUpperCase()))].filter(id => isCve(id) && !known.has(id)).sort();
  if (!fresh.length) return;
  const shown = fresh.slice(0, 80);
  const text = `${resource.slice(0, 256)}: ${fresh.length} new CVE${fresh.length === 1 ? '' : 's'}\n${shown.join('\n')}${fresh.length > shown.length ? `\n…and ${fresh.length - shown.length} more` : ''}`;
  store.db.prepare('INSERT INTO telegram_outbox(message) VALUES (?)').run(text);
}

export async function sendTelegram(token: string, chat: string, text: string, http = fetch) {
  const response = await http(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, link_preview_options: { is_disabled: true } }), signal: AbortSignal.timeout(8000) });
  if (!response.ok || !(await response.json()).ok) throw new Error('Telegram did not accept the message.');
}

export async function deliverTelegram(store: Store, secret: string, http = fetch) {
  const saved = store.getMeta(telegramKey);
  if (!saved) return false;
  const row = store.db.prepare('SELECT id,message FROM telegram_outbox ORDER BY id LIMIT 1').get();
  if (!row) return false;
  const { chat, token }: TelegramConnection = JSON.parse(saved);
  await sendTelegram(unseal(token, secret, telegramKey), chat, String(row.message), http);
  store.db.prepare('DELETE FROM telegram_outbox WHERE id=?').run(row.id);
  return true;
}
