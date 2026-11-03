import { randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../src/server/config.ts';

const destination = new URL('../.env', import.meta.url);
const vps = process.argv.includes('--vps');
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
    console.log('\nkopes.dev — single-host setup\n');
    let mode = 'local';
    if (vps) {
      console.log('1. Domain + automatic HTTPS (ports 80/443 must be free)\n2. Existing HTTPS reverse proxy (upstream: 127.0.0.1:3100)\n3. Private access through an SSH tunnel');
      const choice = (await ask('Access mode [1]: ')) || '1';
      if (!['1', '2', '3'].includes(choice)) throw new Error('Choose access mode 1, 2 or 3.');
      mode = { 1: 'https', 2: 'proxy', 3: 'ssh' }[choice];
    }
    const input = mode === 'ssh' ? 'http://localhost:3100'
      : (await ask(vps ? 'Public HTTPS URL (https://security.example.com): ' : 'Public HTTPS URL (or http://localhost:3100): ')) || (vps ? '' : 'http://localhost:3100');
    // Validate before displaying callback instructions or collecting credentials.
    const origin = readConfig({ BETTER_AUTH_URL: input, BETTER_AUTH_SECRET: 'x'.repeat(32), GITHUB_ADMIN_USER: 'check', GITHUB_CLIENT_ID: 'check', GITHUB_CLIENT_SECRET: 'check' }).origin;
    const url = new URL(origin);
    if (vps && mode !== 'ssh' && url.protocol !== 'https:') throw new Error('Public access requires an HTTPS URL.');
    if (mode === 'https' && (url.port || !/^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/.test(url.hostname))) {
      throw new Error('Automatic HTTPS needs a public DNS hostname without a custom port.');
    }
    if (mode === 'https') console.log(`\nPoint the DNS A/AAAA records for ${url.hostname} at this VPS and allow inbound TCP 80/443. Remove any incorrect AAAA record.\n`);
    console.log(`\nCreate a GitHub OAuth App: https://github.com/settings/developers\nHomepage URL: ${origin}\nAuthorization callback URL: ${origin}/api/auth/callback/github\nNo repository permissions are needed.\n`);
    const env = {
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
      GITHUB_CLIENT_ID: await ask('GitHub OAuth client ID: '),
      GITHUB_CLIENT_SECRET: await ask('GitHub OAuth client secret (hidden): ', true),
      GITHUB_ADMIN_USER: await ask('Administrator GitHub username: '),
      SCAN_INTERVAL_HOURS: '6',
    };
    readConfig(env);
    if (vps) {
      env.COMPOSE_FILE = `compose.yaml:compose.${mode === 'https' ? 'https' : 'local'}.yaml`;
      if (mode === 'https') env.CADDY_DOMAIN = url.hostname;
    }
    if (Object.values(env).some(value => /['\r\n]/.test(value))) throw new Error('Configuration values cannot contain quotes or newlines.');
    await writeFile(destination, Object.entries(env).map(([key, value]) => `${key}='${value}'`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
    if (vps) console.log('\nSaved .env with owner-only permissions. The installer will now build and start the app.\n');
    else console.log('\nSaved .env with owner-only permissions. From the scanner repository, run:\n  docker compose -f compose.yaml -f compose.local.yaml up -d --build\n\nFor HTTPS, route your existing reverse proxy to port 3100 on the host loopback interface.\n');
  } catch (error) {
    console.error(`Setup not completed: ${error.message}`);
    process.exitCode = 1;
  } finally { rl.close(); }
}
