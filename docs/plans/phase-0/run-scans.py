"""Offline, disposable Trivy 0.76.1 experiments; outputs stay outside the repository."""
import json, subprocess, sys
from pathlib import Path
root = Path(__file__).resolve().parent
output = Path('/tmp/kopes-phase0/results'); output.mkdir(parents=True, exist_ok=True)
base = ['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:mode=1777','--tmpfs','/cache:mode=1777','--mount','type=bind,src=/tmp/kopes-phase0/db,dst=/cache/db,readonly','--mount',f'type=bind,src={root / "fixtures"},dst=/fixtures,readonly','--mount',f'type=bind,src={output},dst=/results,readonly','--env','TMPDIR=/tmp','--entrypoint','trivy','kopes-scanner']
flags = ['--cache-dir','/cache','--offline-scan','--skip-db-update','--skip-java-db-update','--disable-telemetry','--skip-version-check','--config=','--ignorefile=','--timeout','60s','--quiet']
results=[]
for case in sorted(p.name for p in (root/'fixtures').iterdir() if p.is_dir() and (len(sys.argv)==1 or p.name in sys.argv[1:])):
    for mode in ['default','dev','sbom','roundtrip']:
        dest = output/f'{case}-{mode}.json'
        if mode == 'roundtrip':
            args = ['sbom','--scanners','vuln','--format','json',f'/results/{case}-sbom.json']
        else:
            args = ['fs','--format','cyclonedx' if mode == 'sbom' else 'json']
            if mode != 'sbom': args += ['--scanners','vuln']
            if mode != 'default': args += ['--include-dev-deps']
            args += [f'/fixtures/{case}']
        p = subprocess.run(base+args+flags,capture_output=True,text=True,timeout=90)
        dest.write_text(p.stdout)
        (output/f'{case}-{mode}.stderr').write_text(p.stderr)
        try: data=json.loads(p.stdout)
        except ValueError: data={}
        pkgs=[pkg for r in data.get('Results',[]) for pkg in r.get('Packages',[])]
        row={'case':case,'mode':mode,'exit':p.returncode,'packages':len(pkgs),'results':len(data.get('Results',[])),'edges':sum(len(p.get('DependsOn',[])) for p in pkgs),'devPackages':sum(bool(p.get('Dev')) for p in pkgs),'vulns':sum(len(r.get('Vulnerabilities',[])) for r in data.get('Results',[])),'components':len(data.get('components',[])),'bomEdges':sum(len(d.get('dependsOn',[])) for d in data.get('dependencies',[]))}
        results.append(row); print(json.dumps(row),flush=True)
(output/'summary.json').write_text(json.dumps(results,indent=2)+'\n')
