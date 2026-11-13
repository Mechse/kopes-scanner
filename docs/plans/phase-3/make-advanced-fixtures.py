"""Authored contract fixtures: writes dependency metadata only, never installs or executes packages.
These exercise captured lockfile shapes; they are not a package-manager compatibility certification.
"""
import json
from pathlib import Path
root=Path(__file__).parent/'fixtures'
def save(case,path,value):
    destination=root/case/path;destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_text(json.dumps(value,indent=2)+'\n' if isinstance(value,dict) else value)
shared={'name':'shared','version':'1.0.0','dependencies':{'lodash':'4.17.20'},'devDependencies':{'left-pad':'1.3.0'}}
web={'name':'web','version':'1.0.0','dependencies':{'shared':'*'}}
manifest={'name':'advanced-fixture','version':'1.0.0','private':True,'workspaces':['apps/*','packages/*'],'dependencies':{'shared':'*','old-lodash':'npm:lodash@4.17.20'},'scripts':{'postinstall':'touch /tmp/SHOULD_NOT_EXIST'}}
packages={'':{k:v for k,v in manifest.items() if k!='scripts'},'apps/web':web,'packages/shared':shared,
 'node_modules/shared':{'resolved':'packages/shared','link':True},'node_modules/web':{'resolved':'apps/web','link':True},
 'node_modules/lodash':{'version':'4.17.20'},'node_modules/old-lodash':{'name':'lodash','version':'4.17.20'},
 'node_modules/left-pad':{'version':'1.3.0','dev':True}}
for path,value in [('package.json',manifest),('apps/web/package.json',web),('packages/shared/package.json',shared),('package-lock.json',{'name':manifest['name'],'lockfileVersion':3,'packages':packages})]:save('npm-links-aliases',path,value)
manifest={**manifest,'dependencies':{'shared':'workspace:*','old-lodash':'npm:lodash@4.17.20','peer-user':'1.0.0'}}
web={**web,'dependencies':{'shared':'workspace:*'}}
for path,value in [('package.json',manifest),('apps/web/package.json',web),('packages/shared/package.json',shared),('pnpm-workspace.yaml',"packages:\n  - apps/*\n  - packages/*\n")]:save('pnpm-links-peers-aliases',path,value)
save('pnpm-links-peers-aliases','pnpm-lock.yaml',"""lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      shared: {specifier: 'workspace:*', version: 'link:packages/shared'}
      old-lodash: {specifier: 'npm:lodash@4.17.20', version: 'lodash@4.17.20'}
      peer-user: {specifier: '1.0.0', version: '1.0.0(lodash@4.17.20)'}
  apps/web:
    dependencies:
      shared: {specifier: 'workspace:*', version: 'link:../../packages/shared'}
  packages/shared:
    dependencies:
      lodash: {specifier: '4.17.20', version: '4.17.20'}
    devDependencies:
      left-pad: {specifier: '1.3.0', version: '1.3.0'}
packages:
  lodash@4.17.20: {}
  left-pad@1.3.0: {}
  peer-user@1.0.0:
    peerDependencies: {lodash: '^4.17.0'}
snapshots:
  lodash@4.17.20: {}
  left-pad@1.3.0: {}
  peer-user@1.0.0(lodash@4.17.20):
    dependencies: {lodash: '4.17.20'}
""")
