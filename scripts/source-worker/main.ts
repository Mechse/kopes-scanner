import { stageSourceInput } from '../../src/server/source/lock-inputs';
import { sourceAnalyzerVersion } from '../../src/server/source/version';
import { sourceInput, pythonFilePattern } from '../../src/lib/source-inputs';
import { createReadStream } from 'node:fs';
import { readdir, readFile, writeFile, mkdir, rename, stat, statfs, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { analyzeBundle, introductionPaths, rematchInventory, type Analysis } from '../../src/server/source/analysis';
import { safeInputPath, type Bundle } from '../../src/server/source/provider';
const exec = promisify(execFile);
const input = '/spool/in', output = '/spool/out';
process.umask(0o077);
// A single worker owns this spool. Clear claims left by a terminated process before accepting work.
for (const name of await readdir(output)) if (/^[a-f0-9-]{36}\.active$/.test(name)) await rm(join(output,name),{force:true});
// Scratch is never retained evidence. A restarted process must not reuse partial extraction files.
for(const name of await readdir('/tmp')) if(/^source-[a-f0-9-]{36}$/.test(name)) await rm(join('/tmp',name),{recursive:true,force:true});
const databaseFile = '/db/db/trivy.db';
const databaseStat = await stat(databaseFile);
const digest = createHash('sha256');
for await (const chunk of createReadStream(databaseFile)) digest.update(chunk);
const databaseSha256 = digest.digest('hex');
async function checkDatabase() { const current = await stat(databaseFile); if (current.size !== databaseStat.size || current.mtimeMs !== databaseStat.mtimeMs) throw new Error('Database snapshot changed during worker lifetime.'); }
for (;;) {
  for (const name of await readdir(input)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try { await stat(join(output, name)); continue; } catch { /* no result yet */ }
    const scratch = '/tmp/source-' + name.slice(0,-5);
    let response: unknown;
    const claim=join(output,name.replace('.json','.active'));
    // Do not begin expensive analysis when an atomic result cannot fit.
    try { const disk=await statfs(output);if(Number(disk.bavail)*Number(disk.bsize)<40*1024*1024)continue;await writeFile(claim,'active',{mode:0o600}); } catch { continue; }
    const controller=new AbortController();
    const watcher=setInterval(()=>{void stat(join(input,name)).catch(()=>controller.abort());},100);
    try {
      if ((await stat(join(input, name))).size > 12 * 1024 * 1024) throw new Error('Input limit exceeded.');
      await checkDatabase();
      const job = JSON.parse(await readFile(join(input, name), 'utf8')) as { bundle: Bundle; folder: string; rematch?: { analyzer: string; inventory: Analysis; sbom: string } };
      if (job.rematch && job.rematch.analyzer !== sourceAnalyzerVersion) throw new Error('Saved inventory analyzer is incompatible; recollect inputs.');
      if (!job.bundle || !/^[a-f0-9]{40,64}$/.test(job.bundle.commit) || typeof job.folder !== 'string' || !job.bundle.files || typeof job.bundle.files !== 'object') throw new Error('Invalid job envelope.');
      const files = Object.entries(job.bundle.files); if (files.length > 200) throw new Error('Input count exceeded.');
      const hash = createHash('sha256').update(JSON.stringify(files.sort(([a],[b]) => a.localeCompare(b)))).digest('hex');
      if (!job.rematch && hash !== job.bundle.hash) throw new Error('Input digest mismatch.');
      // Empty collections still need a scan directory so unsupported repositories
      // produce an explicit coverage result instead of a filesystem failure.
      await mkdir(join(scratch, 'inputs'), { recursive: true }); let size = 0;
      for (const [path, content] of files) {
        if (!safeInputPath(path) || !sourceInput(path) || typeof content !== 'string') throw new Error('Unsafe input path.');
        size += Buffer.byteLength(content); if (Buffer.byteLength(content) > 2 * 1024 * 1024 || size > 8 * 1024 * 1024) throw new Error('Input size exceeded.');
        if (/^(bun\.lockb?)$/.test(path.split('/').at(-1)!) && !stageSourceInput(path, content)) continue;
        const destination = join(scratch, 'inputs', path); await mkdir(join(destination, '..'), { recursive: true }); await writeFile(destination, content, { flag: 'wx' });
      }
      const reportPath = join(scratch, 'report.json');
      if (job.rematch) await writeFile(join(scratch, 'inventory.cdx.json'), job.rematch.sbom, { flag: 'wx' });
      await exec('trivy', [job.rematch ? 'sbom' : 'fs', '--format','json','--output',reportPath,'--scanners','vuln',...(job.rematch ? [] : ['--include-dev-deps', '--file-patterns', pythonFilePattern]),'--list-all-pkgs',
        '--cache-dir','/db','--offline-scan','--skip-db-update','--skip-java-db-update','--disable-telemetry','--skip-version-check',
        '--config=','--ignorefile=','--timeout','120s','--quiet',job.rematch ? join(scratch,'inventory.cdx.json') : join(scratch,'inputs')],
        { signal: controller.signal, killSignal: 'SIGKILL', timeout: 130_000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, HOME: '/tmp', TMPDIR: '/tmp', TRIVY_CACHE_BACKEND: 'memory' } });
      if ((await stat(reportPath)).size > 32 * 1024 * 1024) throw new Error('Output limit exceeded.');
      const report = JSON.parse(await readFile(reportPath, 'utf8'));
      const analysis = job.rematch ? rematchInventory(job.rematch.inventory, report) : analyzeBundle(job.bundle, report, job.folder);
      let sbom = job.rematch?.sbom ?? '';
      if (!job.rematch && analysis.nodes.length) {
        const sbomPath = join(scratch,'inventory.cdx.json');
        await exec('trivy',['fs','--format','cyclonedx','--output',sbomPath,'--include-dev-deps','--file-patterns',pythonFilePattern,'--cache-dir','/db','--offline-scan','--skip-db-update','--skip-java-db-update','--disable-telemetry','--skip-version-check','--config=','--ignorefile=','--timeout','60s','--quiet',join(scratch,'inputs')], {signal:controller.signal,killSignal:'SIGKILL',timeout:70_000,maxBuffer:1024*1024,env:{PATH:process.env.PATH,HOME:'/tmp',TMPDIR:'/tmp',TRIVY_CACHE_BACKEND:'memory'}});
        if ((await stat(sbomPath)).size > 8*1024*1024) throw new Error('SBOM limit exceeded.');
        sbom = await readFile(sbomPath,'utf8');
      }
      const paths = Object.fromEntries([...new Set(analysis.findings.map(f => f.node))].map((node, index) => [node, index < 1000 ? introductionPaths(analysis, node) : { paths: [], truncated: true, relationship: 'unknown' }]));
      const database = JSON.parse(await readFile('/db/db/metadata.json', 'utf8'));
      await checkDatabase();
      database.sha256 = databaseSha256;
      response = { ok: true, bundleHash: job.bundle.hash, sbom, analyzer: sourceAnalyzerVersion, database, analysis, paths };
    } catch { response = { ok: false, error: 'Static analysis failed or exceeded limits. Coverage is unknown.' }; }
    finally { clearInterval(watcher); await rm(scratch, { recursive: true, force: true }); await rm(claim,{force:true}); }
    try { await stat(join(input, name)); } catch { continue; }
    const serialized = JSON.stringify(response);
    try {
      await writeFile(join(output, name + '.tmp'), Buffer.byteLength(serialized) <= 32 * 1024 * 1024 ? serialized : JSON.stringify({ ok: false, error: 'Result limit exceeded.' }), { mode: 0o600 });
      await rename(join(output, name + '.tmp'), join(output, name));
    } catch { await rm(join(output,name+'.tmp'),{force:true}).catch(()=>{}); /* Retry when output space is restored. */ }
  }
  await delay(1000);
}
