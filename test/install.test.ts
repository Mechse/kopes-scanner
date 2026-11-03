import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const cases = [
  { name: 'automatic HTTPS', mode: '1', url: 'https://security.example.test/', override: 'https', origin: 'https://security.example.test' },
  { name: 'existing proxy', mode: '2', url: 'https://security.example.test:8443', override: 'local', origin: 'https://security.example.test:8443' },
  { name: 'SSH tunnel', mode: '3', override: 'local', origin: 'http://localhost:3100' },
  { name: 'SSH setup in the installer Node container', mode: '3', override: 'local', origin: 'http://localhost:3100', container: true },
  { name: 'invalid mode', mode: '4', error: 'Choose access mode' },
  { name: 'invalid public URL', mode: '2', url: 'http://localhost:3100', error: 'Public access requires an HTTPS URL' },
  { name: 'invalid origin path', mode: '2', url: 'https://security.example.test/path', error: 'must be an HTTPS origin' },
  { name: 'IP instead of TLS hostname', mode: '1', url: 'https://203.0.113.10', error: 'public DNS hostname' },
  { name: 'custom automatic TLS port', mode: '1', url: 'https://security.example.test:8443', error: 'without a custom port' },
  { name: 'invalid admin', mode: '3', admin: 'alice@example.test', error: 'one GitHub username' },
];

for (const scenario of cases) test(`VPS setup: ${scenario.name}`, { timeout: 60_000, skip: scenario.container && !process.env.DOCKER_TEST }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kopes-vps-test-'));
  try {
    await mkdir(join(directory, 'scripts'));
    await mkdir(join(directory, 'src/server'), { recursive: true });
    await cp('scripts/setup.mjs', join(directory, 'scripts/setup.mjs'));
    await cp('src/server/config.ts', join(directory, 'src/server/config.ts'));
    const child = scenario.container
      ? spawn('docker', ['run', '--rm', '-i', '--user', `${process.getuid!()}:${process.getgid!()}`, '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--read-only',
        '--mount', `type=bind,src=${directory},dst=/repo`, '--workdir', '/repo', 'node:24.17.0-bookworm-slim', 'node', 'scripts/setup.mjs', '--vps'], { stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn(process.execPath, ['scripts/setup.mjs', '--vps'], { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] });
    const steps = [
      ['Access mode [1]:', scenario.mode],
      ...(scenario.url ? [['Public HTTPS URL', scenario.url]] : []),
      ['GitHub OAuth client ID:', 'client-id'],
      ['GitHub OAuth client secret (hidden):', 'secret-$not-interpolated#'],
      ['Administrator GitHub username:', scenario.admin ?? 'Alice'],
    ];
    let output = '', index = 0;
    child.stderr.on('data', chunk => { output += chunk; });
    child.stdout.on('data', chunk => {
      output += chunk;
      if (index < steps.length && output.includes(steps[index][0])) child.stdin.write(steps[index++][1] + '\n');
    });
    const [code] = await once(child, 'exit');
    assert.ok(!output.includes('secret-$not-interpolated#'));
    if (scenario.error) {
      assert.equal(code, 1, output);
      assert.ok(output.includes(scenario.error), output);
      await assert.rejects(stat(join(directory, '.env')), { code: 'ENOENT' });
    } else {
      assert.equal(code, 0, output);
      const contents = await readFile(join(directory, '.env'), 'utf8');
      assert.ok(contents.includes(`BETTER_AUTH_URL='${scenario.origin}'`));
      assert.ok(contents.includes(`COMPOSE_FILE='compose.yaml:compose.${scenario.override}.yaml'`));
      assert.match(contents, /BETTER_AUTH_SECRET='[a-f0-9]{64}'/);
      assert.ok(contents.includes("GITHUB_CLIENT_SECRET='secret-$not-interpolated#'"));
      assert.equal(contents.includes("CADDY_DOMAIN='security.example.test'"), scenario.mode === '1');
      assert.ok(output.includes(`${scenario.origin}/api/auth/callback/github`));
      assert.equal((await stat(join(directory, '.env'))).mode & 0o777, 0o600);
      const second = spawn(process.execPath, ['scripts/setup.mjs', '--vps'], { cwd: directory, stdio: 'ignore' });
      assert.equal((await once(second, 'exit'))[0], 1);
      assert.equal(await readFile(join(directory, '.env'), 'utf8'), contents);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const installer = resolve('scripts/install.sh');
function shell(script: string, cwd?: string) {
  return execFileSync('bash', ['-c', 'source "$1"; ' + script, 'test', installer], { cwd, encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] });
}

test('installer syntax and explicit consent', () => {
  execFileSync('bash', ['-n', installer]);
  assert.match(shell('exec 3<<< y; confirm "Install?"; echo accepted'), /accepted/);
  assert.throws(() => shell('exec 3<<< n; confirm "Install?"; echo unexpected'), /Cancelled/);
});

test('installer refuses conflicting runtime packages without changing them', () => {
  assert.throws(() => shell(`
    command() { return 1; }
    dpkg-query() { printf 'install ok installed'; }
    apt-get() { echo 'UNEXPECTED PACKAGE CHANGE'; exit 99; }
    install_dependencies
  `), /Existing docker.io package found/);
});

test('installer checks Compose support without altering an existing Docker installation', () => {
  const output = shell(`
    command() { return 0; }
    docker() { case "$*" in 'compose up --help') echo --wait-timeout ;; 'version --format'*) echo 29.0.0 ;; esac; }
    dpkg() { [[ "$*" == '--compare-versions 29.0.0 ge 28.0.0' ]]; }
    confirm() { :; }
    apt-get() { [[ "$*" != *docker* ]]; }
    install_dependencies
    echo ready
  `);
  assert.match(output, /ready/);
  assert.throws(() => shell(`
    command() { return 0; }
    docker() { [[ "$*" != 'compose version' ]]; }
    confirm() { :; }
    apt-get() { [[ "$*" != *docker* ]]; }
    install_dependencies
  `), /Install the Docker Compose v2 plugin/);
  assert.throws(() => shell(`
    command() { return 0; }
    docker() { if [[ "$*" == 'version --format'* ]]; then echo 27.5.1; fi; }
    dpkg() { return 1; }
    confirm() { :; }
    apt-get() { [[ "$*" != *docker* ]]; }
    install_dependencies
  `), /Docker Engine 28\+ is required/);
});

test('installer refuses to replace saved volumes even when the previous app is stopped', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kopes-preserve-test-'));
  try {
    assert.throws(() => shell(`
      INSTALL_DIR="$PWD/new-checkout"
      docker() { if [[ "$*" == 'volume ls'* ]]; then echo kopes_scanner-data; fi; }
      git() { echo 'UNEXPECTED CHECKOUT'; exit 99; }
      prepare_checkout
    `, directory), /saved volumes named kopes already exist/);
    await assert.rejects(stat(join(directory, 'new-checkout')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('port checks protect existing services and allow retrying our own deployment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kopes-ports-test-'));
  try {
    await writeFile(join(directory, '.env'), "COMPOSE_FILE='compose.yaml:compose.https.yaml'\n");
    assert.throws(() => shell('ss() { echo LISTEN; }; docker() { :; }; check_ports', directory), /required port is already in use/);
    assert.match(shell('ss() { echo LISTEN; }; docker() { echo our-container; }; check_ports; echo ready', directory), /ready/);
    assert.match(shell('ss() { [[ "$*" == *":80"* && "$*" == *":443"* ]]; }; docker() { :; }; check_ports; echo ready', directory), /ready/);
    await writeFile(join(directory, '.env'), "COMPOSE_FILE='compose.yaml:compose.local.yaml'\n");
    assert.match(shell('ss() { [[ "$*" == *":3100"* ]]; }; docker() { :; }; check_ports; echo ready', directory), /ready/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
