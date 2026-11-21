import { pythonDependencyInput, sourcePackageType } from '../../lib/source-inputs';
/** Runs only in the isolated source worker. Never install packages or invoke repository tools. */
import { readCvss } from '../../lib/cvss';
import type { Finding } from '../../lib/model';
import { parseDocument } from 'yaml';
import { satisfies, valid, validRange } from 'semver';
import { posix } from 'node:path';
import type { Bundle } from './provider';
import { analyzeBun } from './bun-cargo';
export type Scope = 'runtime' | 'development' | 'optional' | 'peer' | 'unknown';
export type Node = { id: string; name: string; version: string; file: string; location: string; dev: boolean; source?: string; raw?: unknown };
export type Edge = { from: string; to: string; scope: Scope; requestedName?: string; specifier?: string };
export type Root = { id: string; workspace: string; manifest: string; name: string; declarations?: Record<string, unknown> };
export type SourceFinding = { cvss?: Finding['cvss']; advisory: string; aliases: string[]; node: string; package: string; version: string; fixed: string; severity: string; title: string; file: string };
export type Analysis = { nodes: Node[]; edges: Edge[]; roots: Root[]; findings: SourceFinding[]; warnings: string[];
  coverage: { inputs: 'complete' | 'partial'; inventory: 'complete' | 'unknown'; graph: 'complete' | 'partial'; runtime: 'unknown' };
  analyzerPackages: unknown[]; manager: 'npm' | 'pnpm' | 'bun' | 'cargo' | 'python' | 'mixed' | 'unknown'; folder: string };
const groups = { dependencies: 'runtime', devDependencies: 'development', optionalDependencies: 'optional', peerDependencies: 'peer' } as const;
function object(value: any): Record<string, any> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected dependency object.'); return value; }
function yaml(raw: string) { const doc = parseDocument(raw, { uniqueKeys: true }); if (doc.errors.length) throw new Error('Malformed YAML input.'); return object(doc.toJS({ maxAliasCount: 0 })); }
function versionRange(range: string) { return range.startsWith('npm:') ? range.slice(range.lastIndexOf('@') + 1) : range; }
function pnpmPackage(key: string) {
  if (key.startsWith('/')) key = key.slice(1);
  const split = key.lastIndexOf('@', key.indexOf('(') < 0 ? key.length : key.indexOf('('));
  return { name: key.slice(0, split), version: key.slice(split + 1).split('(')[0] };
}
export function analyzeBundle(bundle: Bundle, report: any, folder = ''): Analysis {
  const result: Analysis = { nodes: [], edges: [], roots: [], findings: [], warnings: [], coverage: { inputs: 'complete', inventory: 'complete', graph: 'complete', runtime: 'unknown' }, analyzerPackages: [], manager: 'unknown', folder };
  const warn = (message: string) => { if (!result.warnings.includes(message)) result.warnings.push(message); result.coverage.inputs = 'partial'; result.coverage.graph = 'partial'; };
  const addEdge = (from: string, to: string, scope: Scope, requestedName: string, specifier: string) => { if (result.edges.length >= 200_000) throw new Error('Dependency edge limit exceeded.'); result.edges.push({ from, to, scope, requestedName, specifier }); };
  const files = Object.entries(bundle.files);
  const locks = files.filter(([p]) => p.endsWith('package-lock.json') || p.endsWith('pnpm-lock.yaml'));
  const bunFiles = files.filter(([p]) => posix.basename(p) === 'bun.lock');
  const binaryBun = files.filter(([p]) => posix.basename(p) === 'bun.lockb');
  for (const [file] of binaryBun) {
    result.coverage.inventory = 'unknown';
    warn(`Unsupported binary Bun lockfile: ${file}. Commit a text bun.lock and remove the legacy bun.lockb.`);
  }
  const pythonFiles = files.filter(([p]) => pythonDependencyInput(p));
  if (!locks.length && !bunFiles.length && !binaryBun.length && !pythonFiles.length) warn(files.some(([p]) => p.endsWith('yarn.lock')) ? 'Yarn compatibility is not yet validated.' : 'No supported lockfile found.');
  for (const [file, raw] of locks) {
    const directory = posix.dirname(file) === '.' ? '' : posix.dirname(file) + '/';
    try {
      const npm = file.endsWith('package-lock.json');
      const lock = npm ? object(JSON.parse(raw)) : yaml(raw);
      const pnpm6 = !npm && ['6','6.0'].includes(String(lock.lockfileVersion));
      if (npm ? ![2,3].includes(lock.lockfileVersion) : !pnpm6 && !['9','9.0'].includes(String(lock.lockfileVersion))) { warn(`Unsupported lockfile version: ${file}`); continue; }
      if (result.manager !== 'unknown' && result.manager !== (npm ? 'npm' : 'pnpm')) warn('Multiple package managers require separate interpretation.');
      result.manager = npm ? 'npm' : 'pnpm';
      const records = object(npm || pnpm6 ? lock.packages : lock.snapshots);
      const nodes = new Map<string, Node>();
      for (const [location, pkgValue] of Object.entries(records)) {
        const pkg = object(pkgValue);
        if (npm && (!location.includes('node_modules/') || pkg.link)) continue;
        const identity = npm ? { name: pkg.name || location.split('node_modules/').at(-1), version: pkg.version } : pnpmPackage(location);
        if (typeof identity.name !== 'string' || typeof identity.version !== 'string' || !valid(identity.version)) { warn(`Unresolved/local package in ${file}: ${location}`); continue; }
        const node: Node = { id: `${file}#${location}`, name: identity.name, version: identity.version, file, location, dev: pkg.dev === true, raw: npm ? pkg : { snapshot: pkg, package: pnpm6 ? pkg : lock.packages?.[identity.name+'@'+identity.version] } };
        if (result.nodes.length >= 50_000) throw new Error('Dependency node limit exceeded.');
        nodes.set(location, node); result.nodes.push(node);
      }
      // v6 keeps a single project's importer at the root and installed package
      // records (including peer variants) in packages; v9 separates snapshots.
      const importers = npm ? Object.fromEntries(Object.entries(records).filter(([p]) => !p.includes('node_modules/'))) : object(lock.importers ?? (pnpm6 ? { '.': lock } : undefined));
      const workspaceTargets = new Map<string, { id: string; version: string }>();
      for (const [workspace] of Object.entries(importers)) {
        const location = workspace === '.' ? '' : workspace;
        const manifest = directory + (location ? location + '/' : '') + 'package.json';
        if (!bundle.files[manifest]) continue;
        const declared = object(JSON.parse(bundle.files[manifest]));
        workspaceTargets.set(location, { id: `${file}#workspace:${location}`, version: String(declared.version ?? '') });
        result.roots.push({ id: `${file}#workspace:${location}`, workspace: directory + location, manifest, name: String(declared.name ?? (location || '.')),
          declarations: Object.fromEntries([...Object.keys(groups),'peerDependenciesMeta','overrides','resolutions','pnpm'].filter(k=>declared[k]!==undefined).map(k=>[k,declared[k]])) });
      }
      function resolve(from: string, name: string, value: any): { id: string; version: string } | undefined {
        if (npm) {
          let path = from;
          for (;;) {
            const key = (path ? path + '/' : '') + 'node_modules/' + name;
            const node = nodes.get(key);
            if (node) return node;
            const link = records[key];
            if (link?.link === true && typeof link.resolved === 'string') return workspaceTargets.get(posix.normalize(link.resolved));
            if (!path) break;
            const parent = posix.dirname(path); path = parent === '.' ? '' : parent;
          }
        } else {
          const version = typeof value === 'string' ? value : value?.version;
          if (typeof version !== 'string') return;
          if (version.startsWith('link:')) return workspaceTargets.get(posix.normalize(posix.join(from, version.slice(5))));
          return nodes.get(`${pnpm6 ? '/' : ''}${name}@${version}`) ?? nodes.get(version) ?? (pnpm6 ? nodes.get('/'+version) : undefined);
        }
      }
      const linkDependencies = (from: string, location: string, declared: Record<string, any>) => {
        for (const [group, scope] of Object.entries(groups)) for (const [name, value] of Object.entries(declared[group] ?? {})) {
          // v6 records include peer *constraints*. Actual installed peers are
          // resolved in dependencies and labelled using the package metadata.
          if (!npm && nodes.has(location) && group === 'peerDependencies') continue;
          const target = resolve(location, name, value);
          if (!target && group === 'peerDependencies' && declared.peerDependenciesMeta?.[name]?.optional === true) {
            result.warnings.push(`Optional peer is not installed: ${name} in ${file}:${location || '.'}`); continue;
          }
          if (!target) { warn(`Unresolved ${scope} dependency ${name} in ${file}:${location || '.'}`); continue; }
          const metadata = !npm && nodes.has(location) ? pnpm6 ? records[location] : lock.packages?.[nodes.get(location)!.name+'@'+nodes.get(location)!.version] : undefined;
          addEdge(from, target.id, metadata?.peerDependencies?.[name] ? 'peer' : scope, name, String(typeof value === 'string' ? value : (value as any)?.specifier ?? (value as any)?.version ?? 'unknown'));
          if (npm && typeof value === 'string' && !value.startsWith('file:') && !value.startsWith('workspace:')) {
            const range = versionRange(value);
            if (validRange(range) === null) {
              // Tags and remote sources are not semver ranges. The locked package
              // and its dependency edge are known, but its declaration is unverified.
              const warning = `Dependency declaration not verified: ${name} in ${file}:${location || '.'}. Tags and remote sources cannot be checked as version ranges; the resolved package was retained for assessment.`;
              if (!result.warnings.includes(warning)) result.warnings.push(warning);
              result.coverage.inputs = 'partial';
            } else if (!satisfies(target.version, range, { includePrerelease: true })) warn(`Dependency range not satisfied: ${name} in ${file}:${location || '.'}`);
          }
        }
      };
      for (const [location, node] of nodes) linkDependencies(node.id, location, records[location]);
      for (const [workspace, value] of Object.entries(importers)) {
        const location = workspace === '.' ? '' : workspace;
        const manifest = directory + (location ? location + '/' : '') + 'package.json';
        const data = bundle.files[manifest];
        if (!data) { warn(`Workspace manifest missing: ${manifest}`); continue; }
        const declared = object(JSON.parse(data)), importer = object(value);
        const root = workspaceTargets.get(location)!;
        linkDependencies(root.id, location, npm ? declared : importer);
        for (const group of Object.keys(groups)) {
          const expected = declared[group] ?? {}, captured = importer[group] ?? {};
          if (!npm && group === 'peerDependencies') {
            if (Object.keys(expected).length) warn(`Peer constraints are declared by ${manifest}; consumer installation context is unknown.`);
            continue;
          }
          for (const [name, specifier] of Object.entries(expected)) {
            const actual = npm ? captured[name] : captured[name]?.specifier;
            if (actual !== specifier) warn(`Manifest/lockfile mismatch: ${manifest} ${group}.${name}`);
          }
          for (const name of Object.keys(captured)) if (!(name in expected)) warn(`Stale lock dependency: ${manifest} ${group}.${name}`);
        }
        if (declared.overrides || declared.resolutions || declared.pnpm?.overrides) warn(`Overrides require review: ${manifest}`);
      }
    } catch { warn(`Unable to interpret ${file}; dependency coverage is unknown.`); }
  }
  for (const [file] of bunFiles) {
    try { analyzeBun(bundle, file, result, warn); }
    catch { result.coverage.inventory = 'unknown'; warn(`Unable to interpret ${file}. Regenerate and commit a Bun text lockfile (version 0 or 1).`); }
  }
  // Use Trivy's statically parsed Python inventory. No installation, resolution, or
  // repository code execution, and no invented direct/transitive relationships.
  for (const [file] of pythonFiles) {
    result.manager = result.manager === 'unknown' || result.manager === 'python' ? 'python' : 'mixed';
    const targets = Array.isArray(report?.Results) ? report.Results.filter((t: any) => t.Target === file || String(t.Target).endsWith('/' + file)) : [];
    const packages = targets.flatMap((t: any) => Array.isArray(t.Packages) ? t.Packages : []);
    if (!packages.length) { result.coverage.inventory = 'unknown'; warn(`No resolved Python packages recognized in ${file}. Use pinned requirements or a supported Python lockfile.`); }
    const workspace = posix.dirname(file) === '.' ? '' : posix.dirname(file);
    result.roots.push({ id: `${file}#root`, workspace, manifest: file, name: file });
    for (const pkg of packages) {
      if (typeof pkg.Name !== 'string' || typeof pkg.Version !== 'string' || !pkg.Version) continue;
      const id = `${file}#${pkg.Name}@${pkg.Version}`;
      if (result.nodes.some(n => n.id === id)) continue;
      if (result.nodes.length >= 50_000) throw new Error('Dependency node limit exceeded.');
      result.nodes.push({ id, name: pkg.Name, version: pkg.Version, file, location: String(pkg.ID ?? pkg.Name), dev: pkg.Dev === true });
    }
    result.coverage.graph = 'partial';
    warn(`Python dependency paths and production/development scope are not established for ${file}.`);
    // Requirements may omit transitive dependencies, ranges, includes, or local packages.
    // Even lockfiles can contain local packages not represented by the analyzer.
    result.coverage.inventory = 'unknown';
    warn(`Python coverage is limited to resolved packages reported by the analyzer in ${file}; unpinned, local, and omitted dependencies are not assessed.`);
  }
  for (const [path] of files) if (path.endsWith('package.json') && (!folder || path.startsWith(folder + '/')) && !result.roots.some(r => r.manifest === path)) warn(`Manifest has no recognized lockfile workspace: ${path}`);
  if (files.some(([path]) => path.endsWith('yarn.lock'))) warn('Yarn compatibility is not yet validated.');
  if (folder && !result.roots.some(r => r.workspace === folder || r.workspace.startsWith(folder + '/'))) warn('Selected folder has no recognized workspace root.');
  if (!report || report.SchemaVersion !== 2 || !Array.isArray(report.Results)) { result.coverage.inventory = 'unknown'; warn('Analyzer output is missing or unsupported.'); return result; }
  for (const target of report.Results) {
    if (Array.isArray(target.Packages)) result.analyzerPackages.push(...target.Packages.map((p: any) => ({ target: target.Target, ...p })));
    for (const vulnerability of target.Vulnerabilities ?? []) {
      const matches = result.nodes.filter(n => n.name === vulnerability.PkgName && n.version === vulnerability.InstalledVersion && (n.file === target.Target || posix.basename(n.file) !== 'bun.lock' && String(target.Target).endsWith('/' + n.file)));
      if (!matches.length) { warn('Analyzer finding could not be attributed to a package instance.'); continue; }
      const cvss = readCvss(vulnerability);
      for (const node of matches) result.findings.push({ ...(cvss && { cvss }), advisory: String(vulnerability.VulnerabilityID), aliases: Array.isArray(vulnerability.Aliases) ? vulnerability.Aliases.filter((a: unknown) => typeof a === 'string') : [], node: node.id, package: node.name, version: node.version, fixed: String(vulnerability.FixedVersion ?? ''), severity: String(vulnerability.Severity ?? 'UNKNOWN'), title: String(vulnerability.Title ?? ''), file: node.file });
    }
  }
  if (result.nodes.length && !result.analyzerPackages.length || (!locks.length && !bunFiles.length && !pythonFiles.length) || !result.roots.length) result.coverage.inventory = 'unknown';
  for (const node of result.nodes) if (!result.analyzerPackages.some((p: any) => p.Name === node.name && p.Version === node.version && (posix.basename(node.file) !== 'bun.lock' || p.target === node.file))) { result.coverage.inventory = 'unknown'; warn('Analyzer inventory does not cover every resolved package.'); break; }
  result.findings = [...new Map(result.findings.map(f => [JSON.stringify([f.advisory, f.node]), f])).values()];
  return scopeFindings(result);
}

export function introductionPaths(analysis: Analysis, node: string, limit = 100) {
  const paths: string[][] = []; let truncated = false, steps = 0;
  const children = new Map<string, string[]>();
  for (const edge of analysis.edges) children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  const stack = analysis.roots.filter(r => !analysis.folder || r.workspace === analysis.folder || r.workspace.startsWith(analysis.folder + '/')).map(r => [r.id]);
  while (stack.length) {
    const path = stack.pop()!;
    if (++steps > 20_000 || paths.length >= limit) { truncated = true; break; }
    if (path.at(-1) === node) { paths.push(path); continue; }
    if (path.length >= 80) { truncated = true; continue; }
    for (const next of children.get(path.at(-1)!) ?? []) if (!path.includes(next)) {
      if (stack.length >= 20_000) { truncated = true; break; }
      stack.push([...path, next]);
    }
  }
  return { paths, truncated, relationship: paths.length ? 'known' : 'unknown' };
}

function scopeFindings(result: Analysis) {
  if (result.folder) result = { ...result, findings: result.findings.filter(f => sourcePackageType(f.file) !== 'python-pkg' || f.file.startsWith(result.folder + '/')) };
  if (!result.folder || result.coverage.graph !== 'complete') return result;
  const reached = new Set(result.roots.filter(r=>r.workspace===result.folder||r.workspace.startsWith(result.folder+'/')).map(r=>r.id));
  const edges = new Map<string,string[]>();
  for(const edge of result.edges)edges.set(edge.from,[...(edges.get(edge.from)??[]),edge.to]);
  const queue=[...reached];
  for(let i=0;i<queue.length;i++)for(const next of edges.get(queue[i])??[])if(!reached.has(next)){reached.add(next);queue.push(next);}
  return {...result,findings:result.findings.filter(f=>reached.has(f.node))};
}

/** SBOM matching updates vulnerabilities only; the saved filesystem graph/scope stays authoritative. */
export function rematchInventory(inventory: Analysis, report: any): Analysis {
  const result: Analysis = { ...inventory, findings: [], warnings: [...inventory.warnings], coverage: { ...inventory.coverage } };
  if (!report || report.SchemaVersion !== 2 || !Array.isArray(report.Results)) {
    result.coverage.inventory = 'unknown'; result.warnings.push('Rematching output is unavailable.'); return result;
  }
  const packages = report.Results.flatMap((r: any) => Array.isArray(r.Packages) ? r.Packages : []);
  if (result.nodes.some(n => !packages.some((p: any) => p.Name === n.name && p.Version === n.version))) {
    result.coverage.inventory = 'unknown'; result.warnings.push('Rematching inventory does not cover every saved package instance.');
  }
  for (const target of report.Results) for (const vulnerability of target.Vulnerabilities ?? []) {
    const nodes = result.nodes.filter(n => n.name === vulnerability.PkgName && n.version === vulnerability.InstalledVersion && (sourcePackageType(n.file) === 'python-pkg' ? ['python-pkg', 'pip', 'pipenv', 'poetry', 'uv', 'pylock'].includes(target.Type) : !['python-pkg', 'pip', 'pipenv', 'poetry', 'uv', 'pylock'].includes(target.Type)));
    if (!nodes.length) { result.coverage.inventory = 'unknown'; result.warnings.push('Rematched finding has no saved package identity.'); }
    const cvss = readCvss(vulnerability);
    for (const n of nodes) result.findings.push({ ...(cvss && { cvss }), advisory:String(vulnerability.VulnerabilityID),aliases:Array.isArray(vulnerability.Aliases)?vulnerability.Aliases.filter((s:unknown)=>typeof s==='string'):[],node:n.id,package:n.name,version:n.version,fixed:String(vulnerability.FixedVersion??''),severity:String(vulnerability.Severity??'UNKNOWN'),title:String(vulnerability.Title??''),file:n.file });
  }
  result.findings = [...new Map(result.findings.map(f => [JSON.stringify([f.advisory, f.node]), f])).values()];
  return scopeFindings(result);
}
