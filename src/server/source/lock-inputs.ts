import { parseJSONC, type JSONCParseError } from 'confbox/jsonc';
import { parseTOML } from 'confbox/toml';

export function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, any>;
}
export function bunLock(raw: string) {
  const errors: JSONCParseError[] = [];
  const lock = record(parseJSONC(raw, { errors, allowTrailingComma: true }));
  if (errors.length) throw new Error('Malformed JSONC; regenerate and commit bun.lock.');
  if (![0, 1].includes(lock.lockfileVersion)) throw new Error('Unsupported lockfile version; supported Bun text versions are 0 and 1.');
  record(lock.workspaces); record(lock.packages);
  for (const pkg of Object.values(lock.packages)) {
    if (!Array.isArray(pkg) || typeof pkg[0] !== 'string') throw new Error('Malformed Bun package record; regenerate bun.lock.');
  }
  return lock;
}
export function cargoManifest(raw: string) { return record(parseTOML(raw)); }
export function cargoLock(raw: string) {
  const lock = cargoManifest(raw);
  if (![3, 4].includes(lock.version)) throw new Error('Unsupported lockfile version; supported Cargo.lock versions are 3 and 4.');
  if (!Array.isArray(lock.package)) throw new Error('Malformed Cargo.lock package list; regenerate and commit the lockfile.');
  for (const value of lock.package) {
    const pkg = record(value);
    if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string' || (pkg.source !== undefined && typeof pkg.source !== 'string') ||
      (pkg.dependencies !== undefined && (!Array.isArray(pkg.dependencies) || pkg.dependencies.some((d: unknown) => typeof d !== 'string')))) throw new Error('Malformed Cargo.lock package identity or dependencies.');
  }
  return lock;
}
/** Preserve the original bundle for evidence. Trivy only reads validated lockfiles.
 * Cargo.toml is deliberately not staged: Trivy 0.76 removes dev dependencies when
 * it reads the adjacent manifest. Lock-only analysis retains all locked crates;
 * our adapter interprets collected manifests without invoking Cargo.
 */
export function stageSourceInput(path: string, raw: string) {
  const name = path.split('/').at(-1);
  if (name === 'Cargo.toml' || name === 'bun.lockb') return false;
  try {
    if (name === 'bun.lock') bunLock(raw);
    if (name === 'Cargo.lock') cargoLock(raw);
    return true;
  } catch { return false; } // analyzeBundle records an actionable per-file warning.
}
