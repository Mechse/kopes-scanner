"""Assert observed contracts, including known limitations, and save compact evidence."""
import hashlib,json
from pathlib import Path
base=Path('/tmp/kopes-phase0/results'); root=Path(__file__).resolve().parent
checks=[]
def check(name,condition):
    assert condition,name
    checks.append(name)
def load(case,mode): return json.loads((base/f'{case}-{mode}.json').read_text())
def packages(data): return [p for r in data.get('Results',[]) for p in r.get('Packages',[])]
for case in ['npm-v2','npm-v3','pnpm-v9','pnpm-workspace','yarn-classic','yarn-berry']:
    direct=load(case,'dev'); p=packages(direct)
    for parent in ['parent-a','parent-b']:
        check(f'{case}: {parent} introduces lodash', any(x['Name']==parent and 'lodash@4.17.20' in x.get('DependsOn',[]) for x in p))
    check(f'{case}: known advisory found',any(v['VulnerabilityID']=='CVE-2021-23337' for r in direct.get('Results',[]) for v in r.get('Vulnerabilities',[])))
    check(f'{case}: dev dependency included',any(x['Name']=='left-pad' and x.get('Dev') for x in p))
    check(f'{case}: dev excluded by default',all(x['Name']!='left-pad' for x in packages(load(case,'default'))))
    check(f'{case}: SBOM roundtrip loses Dev flags',not any(x.get('Dev') for x in packages(load(case,'roundtrip'))))
for case in ['npm-workspace','pnpm-workspace']:
    check(f'{case}: distinct lodash versions preserved', {p['Version'] for p in packages(load(case,'dev')) if p['Name']=='lodash'}=={'4.17.20','4.17.21'})
for case in ['missing-lock','malformed-lock']:
    check(f'{case}: no inventory despite successful process',not load(case,'dev').get('Results'))
check('stale manifest does not invalidate Trivy lockfile result',any(p['Name']=='parent-a' and p['Version']=='1.0.0' for p in packages(load('stale-lock','dev'))))
check('pnpm workspace roots absent from analyzer graph',all(p.get('Relationship')!='workspace' for p in packages(load('pnpm-workspace','dev'))))
check('real pnpm inventory includes dev packages',any(p.get('Dev') for p in packages(load('kopes-pnpm','dev'))))
evidence={'trivy':'0.76.1','database':json.loads(Path('/tmp/kopes-phase0/db/metadata.json').read_text()),'cases':json.loads((base/'summary.json').read_text()),'checks':checks,'inputs':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((root/'fixtures').rglob('*')) if p.is_file()},'graphSamples':{case:[{k:p[k] for k in ['ID','Name','Version','Dev','Relationship','DependsOn','Locations'] if k in p} for p in packages(load(case,'dev'))] for case in ['npm-v3','npm-workspace','pnpm-workspace','yarn-classic','yarn-berry']}}
(root/'evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
print(f'{len(checks)} contract assertions passed; 44 scan invocations summarized.')
