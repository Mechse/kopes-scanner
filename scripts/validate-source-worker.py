"""Opt-in disposable worker acceptance; never mounts source credentials, host root, or Docker."""
import hashlib, json, os, shutil, subprocess, tempfile, time, uuid
from datetime import datetime, timezone
from pathlib import Path
root = Path(__file__).resolve().parents[1]
work = Path(tempfile.mkdtemp(prefix='kopes-source-acceptance-'))
for part in ['in','out']:
    (work/part).mkdir(mode=0o777); (work/part).chmod(0o777)
fixtures = root/'docs/plans/phase-0/fixtures'
cases = ['empty-input','npm-v2','npm-v3','npm-workspace','pnpm-v9','pnpm-workspace','missing-lock','malformed-lock','stale-lock','yarn-classic','npm-links-aliases','pnpm-links-peers-aliases']
ids = {}
for case in cases:
    case_root=fixtures/case if (fixtures/case).exists() else root/'docs/plans/phase-3/fixtures'/case
    files = {} if case == 'empty-input' else {str(p.relative_to(case_root)):p.read_text() for p in sorted(case_root.rglob('*')) if p.is_file()}
    encoded = json.dumps(sorted(files.items()),separators=(',',':'),ensure_ascii=False)
    bundle = {'commit':'a'*40,'files':files,'hash':hashlib.sha256(encoded.encode()).hexdigest(),'collectedAt':int(time.time()*1000)}
    job = str(uuid.uuid4()); ids[case]=job
    (work/'in'/f'{job}.json').write_text(json.dumps({'bundle':bundle,'folder':''})); (work/'in'/f'{job}.json').chmod(0o644)
for case in ['public-npm','public-pnpm']:
    source=Path('/tmp/kopes-'+case+'.json')
    if source.exists():
        bundle=json.loads(source.read_text());job=str(uuid.uuid4());ids[case]=job
        (work/'in'/f'{job}.json').write_text(json.dumps({'bundle':bundle,'folder':''}));(work/'in'/f'{job}.json').chmod(0o644)
name = 'kopes-source-acceptance-'+uuid.uuid4().hex[:8]
subprocess.run(['node','scripts/build-source-worker.mjs'],cwd=root,check=True)
image=os.environ.get('KOPES_SOURCE_TEST_IMAGE','kopes-source-worker:validation')
command = ['docker','run','-d','--rm','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','65532:65532','--memory','1g','--cpus','1','--pids-limit','64','--tmpfs','/tmp:rw,size=256m,mode=1777',
 '--mount',f'type=bind,src={work / "in"},dst=/spool/in,readonly','--mount',f'type=bind,src={work / "out"},dst=/spool/out',
 '--mount','type=bind,src=/tmp/kopes-phase0/db,dst=/db/db,readonly','--entrypoint','node',image,'--max-old-space-size=512','/app/worker.mjs']
subprocess.run(command,check=True,capture_output=True)
started=time.monotonic(); rows=[]
try:
    for case,job in ids.items():
        path=work/'out'/f'{job}.json'
        while not path.exists():
            if time.monotonic()-started>240: raise RuntimeError('Worker acceptance timed out')
            time.sleep(1)
        result=json.loads(path.read_text()); analysis=result.get('analysis',{})
        row={'case':case,'ok':result['ok'],'coverage':analysis.get('coverage'),'nodes':len(analysis.get('nodes',[])),'edges':len(analysis.get('edges',[])),'findings':len(analysis.get('findings',[])),'warnings':analysis.get('warnings',[])}
        if case == 'empty-input':
            assert result['ok'],row
            assert analysis['coverage']['inventory']=='unknown',row
            assert analysis['coverage']['inputs']=='partial',row
            assert 'No supported lockfile found.' in analysis['warnings'],row
        elif case in ['npm-v2','npm-v3','npm-workspace','pnpm-v9','pnpm-workspace']:
            assert result['ok'],row
            vulnerable=[f for f in analysis['findings'] if f['package']=='lodash' and f['version']=='4.17.20']
            assert vulnerable,row
            assert len(result['paths'][vulnerable[0]['node']]['paths'])==2,row
        elif case in ['npm-links-aliases','pnpm-links-peers-aliases']:
            assert result['ok'],row
            vulnerable=[f for f in analysis['findings'] if f['package']=='lodash' and f['version']=='4.17.20']
            assert vulnerable,row
            assert any('#workspace:packages/shared' in n for f in vulnerable for p in result['paths'][f['node']]['paths'] for n in p),row
            assert any(e.get('requestedName')=='old-lodash' for e in analysis['edges']),row
            if case.startswith('pnpm'): assert any(e['scope']=='peer' for e in analysis['edges']),row
        elif case.startswith('public-'):
            assert result['ok'],row
        else:
            assert not result['ok'] or analysis['coverage']['inputs']!='complete' or analysis['coverage']['inventory']!='complete',row
        rows.append(row)
    original=json.loads((work/'out'/f'{ids["npm-v3"]}.json').read_text())
    rematch_id=str(uuid.uuid4())
    envelope={'bundle':{'commit':'a'*40,'files':{},'hash':original['bundleHash'],'collectedAt':int(time.time()*1000)},'folder':'','rematch':{'inventory':original['analysis'],'sbom':original['sbom']}}
    rematch_input=work/'in'/f'{rematch_id}.json'
    rematch_input.write_text(json.dumps(envelope));rematch_input.chmod(0o644)
    rematch_output=work/'out'/f'{rematch_id}.json'
    while not rematch_output.exists():
        if time.monotonic()-started>240: raise RuntimeError('Rematch timed out')
        time.sleep(1)
    rematched=json.loads(rematch_output.read_text())
    assert rematched['ok'],rematched
    for field in ['nodes','edges','roots']:
        assert rematched['analysis'][field]==original['analysis'][field],field
    assert len(rematched['analysis']['findings'])==len(original['analysis']['findings'])
    assert rematched['analysis']['coverage']['inventory']=='complete'
    cancelled_id=str(uuid.uuid4());cancelled_input=work/'in'/f'{cancelled_id}.json'
    cancelled_input.write_text(json.dumps(envelope));cancelled_input.chmod(0o644)
    claim=work/'out'/f'{cancelled_id}.active';cancelled_output=work/'out'/f'{cancelled_id}.json'
    while not claim.exists():
        if time.monotonic()-started>240: raise RuntimeError('Cancellation claim timed out')
        assert not cancelled_output.exists(),'Fixture completed before cancellation could be observed'
        time.sleep(.005)
    cancelled_input.unlink();cancel_started=time.monotonic()
    while claim.exists():
        if time.monotonic()-cancel_started>5: raise RuntimeError('Cancellation did not release worker promptly')
        time.sleep(.01)
    time.sleep(.1);assert not cancelled_output.exists(),'Cancelled result was published'
    cancellation_seconds=round(time.monotonic()-cancel_started,2)
    marker=subprocess.run(['docker','exec',name,'test','-e','/tmp/SHOULD_NOT_EXIST'],capture_output=True)
    assert marker.returncode==1,'Repository lifecycle script marker exists'
    peak=subprocess.run(['docker','exec',name,'cat','/sys/fs/cgroup/memory.peak'],capture_output=True,text=True,check=True)
    peak_bytes=int(peak.stdout.strip());assert peak_bytes<=1024*1024*1024
    events=subprocess.run(['docker','exec',name,'cat','/sys/fs/cgroup/memory.events'],capture_output=True,text=True,check=True)
    memory_events={line.split()[0]:int(line.split()[1]) for line in events.stdout.splitlines()}
    assert memory_events.get('oom_kill',0)==0,memory_events
    memory_stat_result=subprocess.run(['docker','exec',name,'cat','/sys/fs/cgroup/memory.stat'],capture_output=True,text=True,check=True)
    memory_stat={line.split()[0]:int(line.split()[1]) for line in memory_stat_result.stdout.splitlines() if line.split()[0] in ['anon','file','kernel','file_mapped']}
    inspected=json.loads(subprocess.run(['docker','inspect',name],capture_output=True,text=True,check=True).stdout)[0]
    assert inspected['HostConfig']['NetworkMode']=='none'
    assert inspected['HostConfig']['ReadonlyRootfs'] and inspected['Config']['User']=='65532:65532'
    assert all('docker.sock' not in m['Source'] for m in inspected['Mounts'])
    restart_id=str(uuid.uuid4());restart_input=work/'in'/f'{restart_id}.json'
    restart_input.write_text(json.dumps(envelope));restart_input.chmod(0o644)
    subprocess.run(['docker','restart',name],capture_output=True,check=True)
    restart_output=work/'out'/f'{restart_id}.json'
    while not restart_output.exists():
        if time.monotonic()-started>240: raise RuntimeError('Restart recovery timed out')
        time.sleep(1)
    recovered=json.loads(restart_output.read_text());assert recovered['ok']
    assert recovered['analysis']['edges']==original['analysis']['edges']
    image_id=subprocess.run(['docker','image','inspect',image,'--format','{{.Id}}'],capture_output=True,text=True,check=True).stdout.strip()
    evidence={'observedAt':datetime.now(timezone.utc).isoformat(),'memoryStatAfterCases':memory_stat,'image':image+' (Trivy 0.76.1)','imageId':image_id,'packagedWorker':True,'cases':rows,'rematchPreservesGraphAndScope':True,'workerRestartRetainsPendingInput':True,'activeCancellationSeconds':cancellation_seconds,'cancelledResultNotPublished':True,'peakMemoryBytes':peak_bytes,'memoryEvents':memory_events,'databaseSha256':original['database']['sha256'],'lifecycleMarkerAbsent':True,'network':'none','hostMount':False,'dockerMount':False,'databaseMount':'read-only','credentialMount':False,'durationSeconds':round(time.monotonic()-started,2),'limits':{'memoryMiB':1024,'cpus':1,'pids':64,'scratchMiB':256}}
    output=root/'docs/plans/phase-3/worker-evidence.json';output.write_text(json.dumps(evidence,indent=2)+'\n')
    print(json.dumps({'casesPassed':len(rows),'lifecycleMarkerAbsent':True,'durationSeconds':evidence['durationSeconds']}))
finally:
    subprocess.run(['docker','stop',name],capture_output=True)
    shutil.rmtree(work)
