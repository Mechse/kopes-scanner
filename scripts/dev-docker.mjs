import { spawnSync } from 'node:child_process';
import { delimiter } from 'node:path';

// Honor the installation's overlays so a routine rebuild cannot disable source scans.
const separator = process.env.COMPOSE_PATH_SEPARATOR || delimiter;
const files = (process.env.COMPOSE_FILE || [
  'compose.yaml', 'compose.local.yaml', 'compose.desktop.yaml', 'compose.dev.yaml',
].join(separator)).split(separator).filter(Boolean);
const result = spawnSync('docker', ['compose', ...files.flatMap(file => ['-f', file]), 'up', '-d', '--build'], {
  stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
