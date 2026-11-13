"""Read-only GitHub contract probe. Persists only counts, booleans and content hashes."""
import base64,hashlib,json,subprocess,sys
from pathlib import Path
from urllib.parse import quote
repo=sys.argv[1]
assert len(repo.split('/'))==2 and all(x and all(c.isalnum() or c in '-_.' for c in x) for x in repo.split('/'))
steps=[]
def get(path):
    r=subprocess.run(['gh','api',path],capture_output=True,text=True,timeout=30)
    steps.append({'operation':path.split('?')[0].replace(repo,'{repo}'),'ok':r.returncode==0})
    if r.returncode: raise RuntimeError('GitHub request failed; raw response omitted')
    return json.loads(r.stdout)
m=get(f'repos/{repo}')
branch=get(f'repos/{repo}/branches/{quote(m["default_branch"],safe="")}')
sha=branch['commit']['sha']
commit=get(f'repos/{repo}/commits/{sha}')
tree=get(f'repos/{repo}/git/trees/{commit["commit"]["tree"]["sha"]}?recursive=1')
inputs=[x for x in tree.get('tree',[]) if x['type']=='blob' and x['path'].split('/')[-1] in ['package.json','pnpm-lock.yaml','package-lock.json','yarn.lock','pnpm-workspace.yaml']]
files=[]
for entry in inputs[:5]:
    f=get(f'repos/{repo}/contents/{quote(entry["path"],safe="/")}?ref={sha}')
    contents=base64.b64decode(f['content'])
    files.append({'kind':entry['path'].split('/')[-1],'bytes':len(contents),'shaMatchesTree':f['sha']==entry['sha'],'sha256':hashlib.sha256(contents).hexdigest()})
associated=get(f'repos/{repo}/commits/{sha}/pulls?per_page=5')
pulls=get(f'repos/{repo}/pulls?state=all&per_page=3')
pr=[]
for item in pulls:
    detail=get(f'repos/{repo}/pulls/{item["number"]}')
    reviews=get(f'repos/{repo}/pulls/{item["number"]}/reviews?per_page=100')
    pr.append({'merged':bool(detail.get('merged_at')),'hasMerger':bool(detail.get('merged_by')),'hasAuthor':bool(detail.get('user',{}).get('id')),'hasMergeSha':bool(detail.get('merge_commit_sha')),'reviewCount':len(reviews),'reviewActorsPresent':all(bool(x.get('user',{}).get('id')) for x in reviews) if reviews else None})
out={'repository':repo,'private':m['private'],'credentialNote':'Existing gh login has admin access; does NOT validate minimum GitHub App permissions.','headIsFullSha':len(sha)==40,'treeTruncated':tree.get('truncated'),'dependencyInputCount':len(inputs),'files':files,'associatedPullCount':len(associated),'samplePulls':pr,'operations':steps}
Path(__file__).with_name('github-evidence.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({k:v for k,v in out.items() if k!='operations'},indent=2))
