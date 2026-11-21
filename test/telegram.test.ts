import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { deliverTelegram, telegramKey } from '../src/server/telegram';
import { telegramSettings } from '../src/server/telegram-settings';
import { readConfig } from '../src/server/config';
import type { Finding } from '../src/lib/model';

const config = readConfig({ BETTER_AUTH_URL: 'http://localhost:3100', BETTER_AUTH_SECRET: 'persistent-secret-with-more-than-32-characters', GITHUB_CLIENT_ID: 'github', GITHUB_CLIENT_SECRET: 'secret', GITHUB_ADMIN_USER: 'admin' });
const token = '1234:ABCDEFGHIJKLMNOPQRSTUVWXYZ';
test('tested admin connection receives only new container CVEs and retries failed sends', async () => {
  const s = new Store(':memory:');
  const request = (body: unknown) => new Request(config.origin, { method: 'POST', headers: { origin: config.origin }, body: JSON.stringify(body) });
  const connect = { action: 'connect', token, chat: '-1234' };
  const sent: string[] = [];
  const http = async (_url: unknown, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body)).text); return Response.json({ ok: true }); };
  try {
    assert.equal((await telegramSettings(request(connect), false, s, config, http)).status, 403);
    const result = await telegramSettings(request(connect), true, s, config, http);
    assert.deepEqual(await result.json(), { chat: '-1234' });
    assert.ok(!s.getMeta(telegramKey)!.includes(token));
    s.syncInventory([{ id: 'container', target_id: 'image:test', name: 'Web', image: 'test', project: 'Website', service: '', manager: '' }]);
    const scan = (...ids: string[]) => s.complete('image:test', { packages: [], os: '', eol: false, findings: ids.map((id): Finding => ({ id, package: 'a', installed: '1', fixed: '', severity: 'HIGH', title: '', type: 'os', path: '' })) }, '', null, [], '');
    scan('CVE-2026-1234', 'CVE-2026-1234', 'GHSA-example'); scan('CVE-2026-1234'); scan('CVE-2026-1234', 'CVE-2026-2345');
    await assert.rejects(deliverTelegram(s, config.secret, async () => new Response(null, { status: 503 })));
    while (await deliverTelegram(s, config.secret, http)) { /* drain */ }
    assert.deepEqual(sent.slice(1), ['Container Website/Web: 1 new CVE\nCVE-2026-1234', 'Container Website/Web: 1 new CVE\nCVE-2026-2345']);
    scan('CVE-2026-3456');
    await telegramSettings(request({ action: 'disconnect' }), true, s, config, http);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM telegram_outbox').get()!.n, 0);
  } finally { s.db.close(); }
});
