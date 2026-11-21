import { posix } from 'node:path';
import { matchesGlob } from 'node:path';
import { valid, validRange, satisfies } from 'semver';
import type { Analysis, Node, Scope } from './analysis';
import type { Bundle } from './provider';
import { safeInputPath } from './provider';
import { bunLock, cargoLock, cargoManifest, record } from './lock-inputs';

type Warn = (message: string) => void;
const groups = { dependencies: 'runtime', devDependencies: 'development', optionalDependencies: 'optional', peerDependencies: 'peer' } as const;
const dir = (file: string) => posix.dirname(file) === '.' ? '' : posix.dirname(file);
const at = (base: string, path: string) => posix.join(base, path);
function manager(result: Analysis, name: 'bun' | 'cargo') { result.manager = result.manager === 'unknown' || result.manager === name ? name : 'mixed'; }
function node(result: Analysis, value: Node) {
  if (result.nodes.length >= 50_000) throw new Error('Dependency node limit exceeded.');
  result.nodes.push(value); return value;
}
function edge(result: Analysis, from: string, to: string, scope: Scope, requestedName: string, specifier: string) {
  if (result.edges.length >= 200_000) throw new Error('Dependency edge limit exceeded.');
  result.edges.push({ from, to, scope, requestedName, specifier });
}
function incomplete(result: Analysis, warn: Warn, message: string) { result.coverage.inventory = 'unknown'; warn(message); }

export function analyzeBun(bundle: Bundle, file: string, result: Analysis, warn: Warn) {
  manager(result, 'bun');
  const lock = bunLock(bundle.files[file]), base = dir(file);
  const packages = new Map<string, Node>(), workspaces = new Map<string, { id: string; version: string }>();
  for (const [location, value] of Object.entries(lock.workspaces)) {
    if (location && !safeInputPath(location)) throw new Error('Unsafe Bun workspace path.');
    const workspace = record(value), manifest = at(base, at(location, 'package.json'));
    const declared = bundle.files[manifest] ? record(JSON.parse(bundle.files[manifest])) : workspace;
    if (!bundle.files[manifest]) incomplete(result, warn, `Workspace manifest missing: ${manifest}. Commit it with bun.lock.`);
    const id = `${file}#workspace:${location}`;
    result.roots.push({ id, workspace: at(base, location) === '.' ? '' : at(base, location), manifest, name: String(workspace.name ?? declared.name ?? (location || '.')), declarations: Object.fromEntries(Object.keys(groups).filter(key => declared[key] !== undefined).map(key => [key, declared[key]])) });
    workspaces.set(location, { id, version: String(declared.version ?? workspace.version ?? '') });
    for (const group of Object.keys(groups)) {
      const expected = record(declared[group] ?? {}), captured = record(workspace[group] ?? {});
      for (const name of new Set([...Object.keys(expected), ...Object.keys(captured)])) if (expected[name] !== captured[name]) incomplete(result, warn, `Manifest/lockfile mismatch: ${manifest} ${group}.${name}. Regenerate bun.lock.`);
    }
  }
  const links = new Map<string, { id: string; version: string }>();
  for (const [location, value] of Object.entries(lock.packages)) {
    const pkg = value as any[], identity = /^(.*)@([^@]+)$/.exec(pkg[0]);
    // Scope slashes belong to package names; the final @ separates identity/version.
    if (!identity) { incomplete(result, warn, `Unsupported Bun package identity in ${file}:${location}.`); continue; }
    const [, name, version] = identity;
    if (version.startsWith('workspace:')) {
      const target = workspaces.get(version.slice(10));
      if (target) links.set(location, target);
      else incomplete(result, warn, `Unresolved Bun workspace ${location} in ${file}. Collect its package.json.`);
      continue;
    }
    if (!valid(version)) { incomplete(result, warn, `Unresolved Git/local/remote Bun package in ${file}:${location}; static registry assessment is unavailable.`); continue; }
    packages.set(location, node(result, { id: `${file}#${location}`, name, version, file, location, dev: false, raw: pkg }));
  }
  function resolve(location: string, name: string) {
    for (;;) {
      const key = location ? `${location}/${name}` : name;
      const target = packages.get(key) ?? links.get(key);
      if (target) return target;
      if (!location) return;
      // Bun encodes nested installations as parent/child, including scoped names.
      const parent = location.replace(/(?:^|\/)(?:@[^/]+\/)?[^/]+$/, '');
      if (parent === location) throw new Error('Malformed Bun package location.');
      location = parent;
    }
  }
  function dependencies(id: string, location: string, data: Record<string, any>) {
    for (const [group, scope] of Object.entries(groups)) for (const [name, specifier] of Object.entries(record(data[group] ?? {}))) {
      if (typeof specifier !== 'string') throw new Error('Unsupported Bun dependency declaration.');
      const target = resolve(location, name);
      if (!target) {
        if (group === 'peerDependencies' && data.peerDependenciesMeta?.[name]?.optional === true) continue;
        incomplete(result, warn, `Unresolved ${scope} dependency ${name} in ${file}:${location || '.'}. Regenerate bun.lock.`); continue;
      }
      edge(result, id, target.id, scope, name, specifier);
      const range = specifier.startsWith('npm:') ? specifier.slice(specifier.lastIndexOf('@') + 1) : specifier;
      if (validRange(range) && valid(target.version) && !satisfies(target.version, range, { includePrerelease: true })) incomplete(result, warn, `Dependency range not satisfied: ${name} in ${file}:${location || '.'}.`);
    }
  }
  for (const [location, pkg] of packages) {
    const tuple = lock.packages[location];
    dependencies(pkg.id, location, record(tuple[2] ?? {}));
  }
  for (const [location, target] of workspaces) dependencies(target.id, location ? String(lock.workspaces[location].name ?? location) : '', record(lock.workspaces[location]));
  if (lock.overrides || lock.patchedDependencies) warn(`Bun overrides or patches require review: ${file}; upstream version advisories do not verify patched code.`);
}

export function analyzeCargo(bundle: Bundle, file: string, result: Analysis, warn: Warn) {
  manager(result, 'cargo');
  const lock = cargoLock(bundle.files[file]), base = dir(file), manifest = at(base, 'Cargo.toml');
  const manifests = new Map<string, Record<string, any>>();
  // Parse manifests independently so one malformed member cannot hide resolved crates.
  for (const [path, raw] of Object.entries(bundle.files)) if (posix.basename(path) === 'Cargo.toml') {
    try { manifests.set(path, cargoManifest(raw)); } catch { incomplete(result, warn, `Malformed Cargo manifest: ${path}. Fix its TOML syntax and rescan.`); }
  }
  const root = manifests.get(manifest), workspace = root?.workspace;
  const packages = new Map<string, Node>();
  for (const pkg of lock.package) {
    if (!valid(pkg.version) || !/^[a-zA-Z0-9_-]+$/.test(pkg.name)) throw new Error('Malformed Cargo package identity.');
    const source = pkg.source ?? 'path';
    const location = `${pkg.name}@${pkg.version} (${source})`;
    if (packages.has(location)) throw new Error('Duplicate Cargo package identity.');
    packages.set(location, node(result, { id: `${file}#${location}`, name: pkg.name, version: pkg.version, file, location, source, dev: false, raw: pkg }));
    if (!['registry+https://github.com/rust-lang/crates.io-index', 'sparse+https://index.crates.io/'].includes(source)) {
      incomplete(result, warn, `Cargo ${source === 'path' ? 'local/path' : source.startsWith('git+') ? 'Git' : 'alternate registry'} package ${pkg.name}@${pkg.version} in ${file} is retained but not assessed against crates.io advisories.`);
    }
  }
  const byName = new Map<string, Node[]>();
  for (const pkg of packages.values()) byName.set(pkg.name, [...(byName.get(pkg.name) ?? []), pkg]);
  const children = new Map<string, Node[]>();
  for (const pkg of packages.values()) {
    const resolved: Node[] = [];
    for (const dependency of (pkg.raw as any).dependencies ?? []) {
      const match = /^([^ ]+)(?: ([^ ]+))?(?: \((.+)\))?$/.exec(dependency);
      const candidates = match ? (byName.get(match[1]) ?? []).filter(p => (!match[2] || p.version === match[2]) && (!match[3] || p.source === match[3])) : [];
      if (candidates.length !== 1) { incomplete(result, warn, `Ambiguous or missing Cargo dependency ${dependency} in ${file}. Regenerate Cargo.lock.`); continue; }
      resolved.push(candidates[0]);
    }
    children.set(pkg.id, resolved);
  }
  const members = new Map<string, { pkg: Node; data: Record<string, any> }>();
  // Nearest lockfile prevents an independent nested project from joining this graph.
  for (const [path, data] of manifests) {
    if (!data.package || !(path === manifest || workspace)) continue;
    const relative = posix.relative(base || '.', dir(path));
    const explicit = typeof data.package.workspace === 'string' && at(dir(path), at(data.package.workspace, 'Cargo.toml')) === manifest;
    const listed = (workspace?.members ?? []).some((pattern: string) => typeof pattern === 'string' && matchesGlob(relative, pattern));
    const excluded = (workspace?.exclude ?? []).some((pattern: string) => typeof pattern === 'string' && matchesGlob(relative, pattern));
    const nestedLock = Object.keys(bundle.files).some(p => posix.basename(p) === 'Cargo.lock' && p !== file && dir(path).startsWith(dir(p) + '/')) || (dir(path) !== base && bundle.files[at(dir(path), 'Cargo.lock')] !== undefined);
    // Path dependencies under a workspace are implicit members; the source-less
    // lock identity provides evidence that they belong to this resolution.
    if (path !== manifest && (excluded || nestedLock || (!explicit && !listed && (relative.startsWith('../') || data.workspace)))) continue;
    const version = data.package.version?.workspace === true ? workspace?.package?.version : data.package.version;
    const candidates = (byName.get(data.package.name) ?? []).filter(p => p.source === 'path' && p.version === version);
    if (candidates.length !== 1) { if (path === manifest || explicit || listed) incomplete(result, warn, `Cargo workspace package cannot be matched to ${file}: ${path}. Regenerate the lockfile.`); continue; }
    if ([...members.values()].some(m => m.pkg.id === candidates[0].id)) { incomplete(result, warn, `Ambiguous local Cargo package in ${path}; paths are unknown.`); continue; }
    members.set(path, { pkg: candidates[0], data });
    result.roots.push({ id: candidates[0].id, workspace: dir(path), manifest: path, name: data.package.name, declarations: data });
  }
  if (root?.workspace && !root.package) result.roots.push({ id: `${file}#workspace`, workspace: base, manifest, name: manifest });
  if (!root) incomplete(result, warn, `Cargo manifest missing or malformed: ${manifest}. Commit it and workspace member manifests to establish direct dependencies and scopes.`);
  const memberIds = new Set([...members.values()].map(m => m.pkg.id));
  for (const pkg of packages.values()) if (!memberIds.has(pkg.id)) for (const target of children.get(pkg.id) ?? []) edge(result, pkg.id, target.id, 'unknown', target.name, target.version);
  for (const [path, { pkg, data }] of members) {
    const linked = new Set<string>();
    const sections = [data, ...Object.values(data.target ?? {}).map(record)];
    for (const section of sections) for (const [group, scope] of [['dependencies', 'runtime'], ['dev-dependencies', 'development'], ['build-dependencies', 'unknown']] as const) {
      for (const [requested, value] of Object.entries(record(section[group] ?? {}))) {
        let declared = typeof value === 'string' ? { version: value } : record(value);
        const inherited = declared.workspace === true;
        if (inherited) {
          const common = workspace?.dependencies?.[requested];
          if (common === undefined) { incomplete(result, warn, `Missing workspace.dependencies.${requested} for ${path}.`); continue; }
          declared = { ...(typeof common === 'string' ? { version: common } : record(common)), ...declared };
        }
        const name = declared.package ?? requested;
        let candidates = (children.get(pkg.id) ?? []).filter(p => p.name === name);
        if (declared.path) {
          const targetPath = at(inherited ? base : dir(path), at(String(declared.path), 'Cargo.toml'));
          const local = members.get(targetPath);
          candidates = local ? candidates.filter(p => p.id === local.pkg.id) : [];
        } else if (declared.git) candidates = candidates.filter(p => p.source?.startsWith(`git+${declared.git}#`) || p.source?.startsWith(`git+${declared.git}?`));
        else if (!declared.registry) candidates = candidates.filter(p => p.source === 'registry+https://github.com/rust-lang/crates.io-index' || p.source === 'sparse+https://index.crates.io/');
        // Lock edges already establish resolution. Use ranges only to disambiguate;
        // Cargo prerelease/0.x semantics are not identical to npm's semver rules.
        if (candidates.length > 1 && typeof declared.version === 'string' && validRange(declared.version)) candidates = candidates.filter(p => satisfies(p.version, declared.version));
        if (candidates.length !== 1) { incomplete(result, warn, `Unresolved Cargo declaration ${requested} in ${path}; no unique locked identity. Regenerate Cargo.lock.`); continue; }
        const target = candidates[0]; linked.add(target.id);
        const kind = declared.optional ? 'optional' : scope;
        edge(result, pkg.id, target.id, kind, requested, String(declared.version ?? declared.path ?? declared.git ?? 'workspace'));
        if (scope === 'unknown' || section !== data || declared.optional) warn(`Cargo build, target, or feature activation is unknown for ${requested} in ${path}; all locked packages are assessed.`);
      }
    }
    for (const target of children.get(pkg.id) ?? []) if (!linked.has(target.id)) {
      edge(result, pkg.id, target.id, 'unknown', target.name, target.version);
      warn(`Cargo dependency scope is unknown for ${target.name} in ${path}. Review manifest/lockfile consistency.`);
    }
  }
  if (root?.patch || root?.replace) warn(`Cargo patch/replace declarations require review: ${manifest}; locked sources are retained without fetching code.`);
}
