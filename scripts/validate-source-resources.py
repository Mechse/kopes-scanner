"""Disposable packaged-worker soak. Uses saved immutable public dependency inputs, never repository code execution."""
import json, os, shutil, subprocess, tempfile, time, uuid
from datetime import datetime, timezone
from pathlib import Path
root=Path(__file__).resolve().parents[1]
image=os.environ.get('KOPES_SOURCE_TEST_IMAGE','kopes-source-worker:validation')
cycles=int(os.environ.get('KOPES_RESOURCE_CYCLES','60'))
bundles={k:json.loads(Path('/tmp/kopes-public-'+k+'.json').read_text()) for k in ['npm','pnpm']}
work=Path(tempfile.mkdtemp(prefix='kopes-source-resources-'))
for name in ['in','out']:(work/name).mkdir(mode=0o777);(work/name).chmod(0o777)
containers=[];started=time.monotonic()
def docker(*args):return subprocess.run(['docker',*args],capture_output=True,text=True,check=True).stdout
def node(name,script):return docker('exec',name,'node','-e',script)
def start(pressure=False):
    name='kopes-source-resources-'+uuid.uuid4().hex[:8]
    args=['run','-d','--rm','--init','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','65532:65532','--memory','1g','--cpus','1','--pids-limit','64','--tmpfs','/tmp:rw,size=256m,mode=1777','--mount',f'type=bind,src={work/"in"},dst=/spool/in,readonly','--mount','type=bind,src=/tmp/kopes-phase0/db,dst=/db/db,readonly']
    args+=['--tmpfs','/spool/out:rw,size=64m,mode=1777'] if pressure else ['--mount',f'type=bind,src={work/"out"},dst=/spool/out']
    docker(*args,image);containers.append(name);return name
def submit(bundle=None,rematch=None):
    job=str(uuid.uuid4());envelope={'bundle':bundle or {'commit':'a'*40,'files':{},'hash':rematch['bundleHash'],'collectedAt':1},'folder':''}
    if rematch:envelope['rematch']={'inventory':rematch['analysis'],'sbom':rematch['sbom']}
    path=work/'in'/(job+'.json');tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(envelope));tmp.chmod(0o644);tmp.rename(path);return job
def wait_file(job,extension='.json',timeout=30):
    path=work/'out'/(job+extension);deadline=time.monotonic()+timeout
    while not path.exists():
        if time.monotonic()>deadline:raise RuntimeError('Worker deadline exceeded: '+extension)
        time.sleep(.01)
    return path
def clean(job):
    (work/'in'/(job+'.json')).unlink(missing_ok=True)
    (work/'out'/(job+'.json')).unlink(missing_ok=True)
def metrics(name):
    return json.loads(node(name,"const f=require('fs');const kv=p=>Object.fromEntries(f.readFileSync(p,'utf8').trim().split('\\n').map(l=>l.split(' ')).map(([k,v])=>[k,Number(v)]));console.log(JSON.stringify({stat:kv('/sys/fs/cgroup/memory.stat'),events:kv('/sys/fs/cgroup/memory.events'),current:Number(f.readFileSync('/sys/fs/cgroup/memory.current')),peak:Number(f.readFileSync('/sys/fs/cgroup/memory.peak'))}));"))
try:
    name=start();original={};samples=[];durations=[]
    for manager,bundle in bundles.items():
        job=submit(bundle);original[manager]=json.loads(wait_file(job).read_text());assert original[manager]['ok'];clean(job)
    baseline=metrics(name)
    for i in range(cycles):
        manager=['npm','pnpm'][i%2];begin=time.monotonic()
        job=submit(bundles[manager] if i%3==0 else None,None if i%3==0 else original[manager]);result=json.loads(wait_file(job).read_text());assert result['ok'],result
        for field in ['nodes','edges','roots']:assert result['analysis'][field]==original[manager]['analysis'][field],field
        assert result['analysis']['coverage']==original[manager]['analysis']['coverage']
        assert len(result['analysis']['findings'])==len(original[manager]['analysis']['findings'])
        clean(job);durations.append(round(time.monotonic()-begin,3))
        if i%10==9:samples.append({'afterJobs':i+1,**metrics(name)});print(json.dumps({'completed':i+1,'of':cycles}),flush=True)
    cancellations=[]
    for i in range(20):
        job=submit(rematch=original['pnpm']);claim=wait_file(job,'.active');(work/'in'/(job+'.json')).unlink();begin=time.monotonic()
        while claim.exists():
            assert time.monotonic()-begin<5,'Cancellation held claim';time.sleep(.01)
        time.sleep(.05);assert not (work/'out'/(job+'.json')).exists();cancellations.append(round(time.monotonic()-begin,3))
    restart=[]
    for i in range(10):
        job=submit(rematch=original['pnpm']);wait_file(job,'.active');docker('kill','--signal=KILL',name)
        # --rm removes a killed container; start the same packaged worker with the same spool.
        containers.remove(name);name=start();result=json.loads(wait_file(job,timeout=45).read_text());assert result['ok'];assert result['analysis']['edges']==original['pnpm']['analysis']['edges'];clean(job);restart.append(True)
    final=metrics(name);assert final['events']['oom_kill']==0
    assert len(list((work/'in').iterdir()))==0 and len(list((work/'out').iterdir()))==0
    scratch=json.loads(node(name,"console.log(JSON.stringify(require('fs').readdirSync('/tmp').filter(n=>n.startsWith('source-'))))"));assert scratch==[],scratch
    docker('stop',name);containers.remove(name)
    pressure=start(True)
    # Fill only an isolated 64 MiB tmpfs. Host disks are never filled.
    node(pressure,"require('fs').writeFileSync('/spool/out/pressure',Buffer.alloc(32*1024*1024))")
    job=submit(bundles['npm']);time.sleep(3)
    listing=json.loads(node(pressure,"console.log(JSON.stringify(require('fs').readdirSync('/spool/out')))"));assert listing==['pressure'],listing
    node(pressure,"require('fs').unlinkSync('/spool/out/pressure')")
    def pressure_result(job):
        deadline=time.monotonic()+45
        while time.monotonic()<deadline:
            raw=node(pressure,"const f=require('fs');const p='/spool/out/"+job+".json';console.log(f.existsSync(p)?f.readFileSync(p,'utf8'):'null')")
            value=json.loads(raw)
            if value is not None:return value
            time.sleep(.2)
        raise RuntimeError('Pressure recovery timed out')
    assert pressure_result(job)['ok'];clean(job);node(pressure,"require('fs').unlinkSync('/spool/out/"+job+".json')")
    # Real ENOSPC during scratch extraction must be an unknown/failed result, then recover.
    node(pressure,"const f=require('fs');const fd=f.openSync('/tmp/pressure','w');try{for(;;)f.writeSync(fd,Buffer.alloc(1024*1024))}catch(e){if(e.code!=='ENOSPC')throw e}finally{f.closeSync(fd)}")
    job=submit(bundles['pnpm']);failed=pressure_result(job);assert failed['ok'] is False,failed;clean(job);node(pressure,"require('fs').unlinkSync('/spool/out/"+job+".json');require('fs').unlinkSync('/tmp/pressure')")
    job=submit(bundles['pnpm']);assert pressure_result(job)['ok'];clean(job);node(pressure,"require('fs').unlinkSync('/spool/out/"+job+".json')")
    pressure_metrics=metrics(pressure);assert pressure_metrics['events']['oom_kill']==0
    evidence={'observedAt':datetime.now(timezone.utc).isoformat(),'imageId':docker('image','inspect',image,'--format','{{.Id}}').strip(),'publicBundles':{k:{'commit':v['commit'],'hash':v['hash']} for k,v in bundles.items()},'completedSoakJobs':cycles,'initialPublicScans':2,'processCrashRecoveries':len(restart),'activeCancellations':len(cancellations),'maxCancellationSeconds':max(cancellations),'maxJobSeconds':max(durations),'durationSeconds':round(time.monotonic()-started,2),'baselineMemory':baseline,'memorySamples':samples,'afterRestartMemory':final,'pressureMemory':pressure_metrics,'zeroSpoolFilesAfterSoak':True,'zeroScratchDirectoriesAfterSoak':True,'lowOutputSpacePausesBeforeAnalysis':True,'outputSpaceRecovery':True,'scratchEnospcFailsUnknown':True,'scratchSpaceRecovery':True,'repositoryScriptsExecuted':False,'network':'none','limits':{'memoryMiB':1024,'cpus':1,'pids':64,'scratchMiB':256,'pressureOutputMiB':64}}
    (root/'docs/plans/phase-6/resource-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps({'passed':True,'jobs':cycles,'crashRecoveries':len(restart),'cancellations':len(cancellations)}))
finally:
    for name in containers:subprocess.run(['docker','stop',name],capture_output=True)
    shutil.rmtree(work)
