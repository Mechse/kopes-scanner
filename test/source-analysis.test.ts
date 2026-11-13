import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { analyzeBundle, introductionPaths } from '../src/server/source/analysis';
import { enqueueSource } from '../src/server/source/service';
import { resultSchema } from '../src/server/source/jobs';
function fixture(name: string) {
  const root = join('docs/plans/phase-0/fixtures',name), files: Record<string,string> = {};
  function walk(dir: string) { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir,e.name); if (e.isDirectory()) walk(p); else files[relative(root,p)] = readFileSync(p,'utf8'); } } walk(root);
  return { commit: 'a'.repeat(40), files, hash: 'b'.repeat(64), collectedAt: 1 };
}
function report(file: string) { return { SchemaVersion: 2, Results: [{ Target: file, Packages: [{ Name: 'parent-a', Version:'1.0.0' },{ Name:'parent-b',Version:'1.0.0' },{ Name:'lodash',Version:'4.17.20' },{ Name:'left-pad',Version:'1.3.0',Dev:true }], Vulnerabilities: [{ VulnerabilityID:'CVE-fixture',PkgName:'lodash',InstalledVersion:'4.17.20',FixedVersion:'4.17.21',Severity:'HIGH' }] }] }; }
for (const [name, file] of [['npm-v2','package-lock.json'],['npm-v3','package-lock.json'],['pnpm-v9','pnpm-lock.yaml'],['pnpm-workspace','pnpm-lock.yaml']]) test(`${name}: preserves multiple paths and dev context without scripts`, () => {
  const result = analyzeBundle(fixture(name), report(file));
  const lodash = result.nodes.find(n => n.name === 'lodash' && n.version === '4.17.20')!;
  const paths = introductionPaths(result, lodash.id);
  assert.equal(paths.paths.length, 2); assert.equal(paths.truncated, false);
  assert.ok(result.edges.some(e => e.scope === 'development'));
  assert.equal(result.findings[0].node, lodash.id);
  assert.equal(result.coverage.runtime, 'unknown');
});
for (const name of ['missing-lock','malformed-lock','stale-lock','yarn-classic']) test(`${name}: incomplete input never clean`, () => {
  const result = analyzeBundle(fixture(name), { SchemaVersion:2, Results:[] });
  assert.equal(result.coverage.inputs, 'partial');
  assert.ok(result.warnings.length);
});
test('unknown analyzer coverage and bounded path traversal remain explicit', () => {
  const result = analyzeBundle(fixture('npm-v3'), { SchemaVersion:2, Results:[] });
  assert.equal(result.coverage.inventory, 'unknown');
  assert.equal(introductionPaths(result, result.nodes.find(n=>n.name==='lodash')!.id, 1).truncated, true);
  assert.equal(resultSchema.safeParse({ ok: true, analysis: {} }).success, false);
});

test('a newly disclosed advisory appears on rematching without replacing dev/workspace context', async () => {
  const {rematchInventory}=await import('../src/server/source/analysis');
  const initial=analyzeBundle(fixture('npm-v3'),{SchemaVersion:2,Results:[{Target:'package-lock.json',Packages:report('package-lock.json').Results[0].Packages,Vulnerabilities:[]}]});
  const rematched=rematchInventory(initial,report('inventory.cdx.json'));
  assert.equal(initial.findings.length,0);assert.equal(rematched.findings.length,1);
  assert.deepEqual(rematched.edges,initial.edges);assert.deepEqual(rematched.nodes,initial.nodes);assert.deepEqual(rematched.roots,initial.roots);
});

test('complete workspace coverage scopes occurrences to selected roots while retaining the full graph',()=>{
  const r=report('pnpm-lock.yaml');r.Results[0].Packages.push({Name:'lodash',Version:'4.17.21'});
  r.Results[0].Vulnerabilities.push({...r.Results[0].Vulnerabilities[0],VulnerabilityID:'CVE-other-workspace',InstalledVersion:'4.17.21'});
  const result=analyzeBundle(fixture('pnpm-workspace'),r,'apps/web');
  assert.ok(result.nodes.some(n=>n.version==='4.17.21'));
  assert.ok(!result.findings.some(f=>f.advisory==='CVE-other-workspace'));
  assert.equal(result.findings.length,1);
});

for(const [name,file] of [['npm-links-aliases','package-lock.json'],['pnpm-links-peers-aliases','pnpm-lock.yaml']]) test(`${name}: linked workspace graph retains aliases, development and peer context`,()=>{
  const root=join('docs/plans/phase-3/fixtures',name),files:Record<string,string>={};
  for(const path of readdirSync(root,{recursive:true,withFileTypes:true}))if(path.isFile()){const full=join(path.parentPath,path.name);files[relative(root,full)]=readFileSync(full,'utf8');}
  const r=report(file);r.Results[0].Packages.push({Name:'peer-user',Version:'1.0.0'});
  const analysis=analyzeBundle({files,commit:'a'.repeat(40),hash:'b'.repeat(64),collectedAt:1},r,'apps/web');
  assert.equal(analysis.coverage.graph,'complete',analysis.warnings.join('\n'));
  const finding=analysis.findings.find(f=>f.package==='lodash')!;assert.ok(finding);
  const paths=introductionPaths(analysis,finding.node).paths;
  assert.ok(paths.some(p=>p.includes(file+'#workspace:packages/shared')));
  assert.ok(analysis.edges.some(e=>e.requestedName==='old-lodash'));
  assert.ok(analysis.edges.some(e=>e.scope==='development'));
  if(name.startsWith('pnpm'))assert.ok(analysis.edges.some(e=>e.scope==='peer'));
});

test('SBOM targets sharing a package do not multiply occurrence counts',async()=>{
  const {rematchInventory}=await import('../src/server/source/analysis');
  const initial=analyzeBundle(fixture('npm-v3'),report('package-lock.json'));
  const r=report('sbom');r.Results.push({...r.Results[0],Target:'second-target'});
  const rematched=rematchInventory(initial,r);
  assert.equal(rematched.findings.length,1);
});

for (const [name, file] of [['npm-v3', 'package-lock.json'], ['pnpm-v9', 'pnpm-lock.yaml']]) {
  test(`${name}: CVSS survives scan, rematch, worker validation and display conversion`, async () => {
    const { rematchInventory } = await import('../src/server/source/analysis');
    const { sourceFinding } = await import('../src/server/source/finding-evidence');
    const cases = [
      { ratings: { vendor: { V3Score: 7.5, V3Vector: 'CVSS:3.1/AV:N' }, nvd: { V3Score: 9.8 } }, expected: { score: 7.5, version: 3, source: 'vendor', vector: 'CVSS:3.1/AV:N' } },
      { ratings: { nvd: { V40Score: 9.3, V40Vector: 'CVSS:4.0/AV:N', V3Score: 9.8 } }, expected: { score: 9.3, version: 4, source: 'nvd', vector: 'CVSS:4.0/AV:N' } },
      { ratings: { nvd: { V2Score: 0 } }, expected: { score: 0, version: 2, source: 'nvd' } },
      { ratings: { nvd: { V3Score: 11, V2Score: '7.5' } }, expected: undefined },
      { ratings: undefined, expected: undefined },
    ];
    for (const { ratings, expected } of cases) {
      const input = report(file);
      Object.assign(input.Results[0].Vulnerabilities[0], { CVSS: ratings, SeveritySource: 'vendor' });
      const initial = analyzeBundle(fixture(name), input);
      for (const analysis of [initial, rematchInventory(initial, input)]) {
        const validated = resultSchema.parse(JSON.parse(JSON.stringify({
          ok: true, bundleHash: 'b'.repeat(64), sbom: '', analyzer: 'trivy',
          database: { Version: 2, UpdatedAt: '2026-11-11' }, analysis, paths: {},
        })));
        assert.ok(validated.analysis.findings.length);
        for (const finding of validated.analysis.findings) {
          assert.deepEqual(finding.cvss, expected);
          assert.deepEqual(sourceFinding(finding).cvss, expected);
        }
      }
    }
  });
}

test('worker findings reject malformed CVSS and accept older findings without scores', () => {
  const schema = resultSchema.shape.analysis.shape.findings;
  const findings = analyzeBundle(fixture('npm-v3'), report('package-lock.json')).findings;
  assert.equal(schema.safeParse(findings).success, true);
  for (const cvss of [
    { score: -1, version: 3, source: 'nvd' },
    { score: 11, version: 3, source: 'nvd' },
    { score: '7.5', version: 3, source: 'nvd' },
    { score: 7.5, version: 5, source: 'nvd' },
  ]) assert.equal(schema.safeParse([{ ...findings[0], cvss }]).success, false);
});

for (const declaration of ['latest', 'https://github.com/binarymist/grunt-if/tarball/master', 'git+https://github.com/example/tool.git', 'npm:tool@latest', '^2.0.0', '^1.0.0', 'npm:tool@^1.0.0']) test(`npm declaration ${declaration} preserves inventory and distinguishes unverified constraints`, () => {
  const root = { name: 'app', dependencies: { tool: declaration } };
  const bundle = { commit: 'a'.repeat(40), hash: 'b'.repeat(64), collectedAt: 1, files: {
    'package.json': JSON.stringify(root),
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': root, 'node_modules/tool': { version: '1.0.0' } } }),
  } };
  const result = analyzeBundle(bundle, { SchemaVersion: 2, Results: [{ Target: 'package-lock.json', Packages: [{ Name: 'tool', Version: '1.0.0' }], Vulnerabilities: [{ VulnerabilityID: 'CVE-test', PkgName: 'tool', InstalledVersion: '1.0.0', Severity: 'HIGH' }] }] });
  assert.equal(result.coverage.inventory, 'complete');
  assert.equal(result.nodes.length, 1);
  assert.equal(result.findings.length, 1);
  assert.equal(result.edges.length, 1);
  if (declaration === '^2.0.0') {
    assert.match(result.warnings[0], /Dependency range not satisfied/);
    assert.equal(result.coverage.graph, 'partial');
  } else if (declaration.includes('^1.0.0')) {
    assert.deepEqual(result.warnings, []);
    assert.equal(result.coverage.inputs, 'complete');
  } else {
    assert.equal(result.coverage.inputs, 'partial');
    assert.equal(result.coverage.graph, 'complete');
    assert.match(result.warnings[0], /Dependency declaration not verified/);
    assert.ok(!result.warnings.some(w => w.includes('range not satisfied')));
  }
});
