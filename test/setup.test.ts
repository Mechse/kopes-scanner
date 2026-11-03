import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

for (const terminal of [false, true]) test(`setup shows prompts, protects secrets and refuses overwrites (${terminal ? 'TTY' : 'pipe'})`, { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kopes-setup-test-'));
  try {
    await mkdir(join(directory, 'scripts'));
    await mkdir(join(directory, 'src/server'), { recursive: true });
    await cp('scripts/setup.mjs', join(directory, 'scripts/setup.mjs'));
    await cp('src/server/config.ts', join(directory, 'src/server/config.ts'));
    const args = terminal ? ['--input-type=module', '--eval', "Object.defineProperty(process.stdin, 'isTTY', { value: true }); await import('./scripts/setup.mjs');"] : ['scripts/setup.mjs'];
    const child = spawn(process.execPath, args, { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] });
    const steps = [
      ['Public HTTPS URL', 'https://security.example.test'],
      ['GitHub OAuth client ID:', 'client-id'],
      ['GitHub OAuth client secret (hidden):', 'secret-never-echoed'],
      ['Administrator GitHub username:', 'alice'],
    ];
    let output = '', index = 0;
    child.stderr.on('data', chunk => { output += chunk; });
    child.stdout.on('data', chunk => {
      output += chunk;
      if (index < steps.length && output.includes(steps[index][0])) child.stdin.write(steps[index++][1] + '\n');
    });
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, output);
    assert.ok(!output.includes('secret-never-echoed'));
    // Readline must redraw each prompt after clearing the terminal line, not erase it.
    if (terminal) for (const [label] of steps) assert.ok(output.includes(`\x1b[0J${label}`), `Prompt was not redrawn: ${label}`);
    const path = join(directory, '.env');
    const contents = await readFile(path, 'utf8');
    assert.match(contents, /BETTER_AUTH_SECRET='[a-f0-9]{64}'/);
    assert.match(contents, /GITHUB_CLIENT_SECRET='secret-never-echoed'/);
    assert.match(contents, /GITHUB_ADMIN_USER='alice'/);
    assert.match(output, /compose\.local\.yaml/);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const second = spawn(process.execPath, ['scripts/setup.mjs'], { cwd: directory, stdio: 'ignore' });
    assert.equal((await once(second, 'exit'))[0], 1);
    assert.equal(await readFile(path, 'utf8'), contents);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
