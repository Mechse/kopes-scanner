import { randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../src/server/config.ts';

const destination = new URL('../.env', import.meta.url);
try {
  await access(destination);
  console.error(`${fileURLToPath(destination)} already exists. Edit it directly; setup will not overwrite credentials.`);
  process.exitCode = 1;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  let hidden = false;
  const output = new Writable({ write(chunk, encoding, done) { if (!hidden) process.stdout.write(chunk, encoding); done(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
  async function ask(label, secret = false) {
    const answer = rl.question(label);
    hidden = secret;
    try { return (await answer).trim(); }
    finally { hidden = false; if (secret) process.stdout.write('\n'); }
  }
  try {
    console.log('\nkopes.ai — single-host setup\n');
    const origin = (await ask('Public HTTPS URL (or http://localhost:3100): ')) || 'http://localhost:3100';
    console.log(`\nCreate a GitHub OAuth App: https://github.com/settings/developers\nHomepage URL: ${origin}\nAuthorization callback URL: ${origin.replace(/\/$/, '')}/api/auth/callback/github\nNo repository permissions are needed.\n`);
    const env = {
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
      GITHUB_CLIENT_ID: await ask('GitHub OAuth client ID: '),
      GITHUB_CLIENT_SECRET: await ask('GitHub OAuth client secret (hidden): ', true),
      GITHUB_ADMIN_USER: await ask('Administrator GitHub username: '),
      SCAN_INTERVAL_HOURS: '6',
    };
    readConfig(env);
    if (Object.values(env).some(value => /['\r\n]/.test(value))) throw new Error('Configuration values cannot contain quotes or newlines.');
    await writeFile(destination, Object.entries(env).map(([key, value]) => `${key}='${value}'`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
    console.log('\nSaved .env with owner-only permissions. From the scanner repository, run:\n  docker compose -f compose.yaml -f compose.local.yaml up -d --build\n\nFor HTTPS, route your existing reverse proxy to port 3100 on the host loopback interface.\n');
  } catch (error) {
    console.error(`Setup not completed: ${error.message}`);
    process.exitCode = 1;
  } finally { rl.close(); }
}
