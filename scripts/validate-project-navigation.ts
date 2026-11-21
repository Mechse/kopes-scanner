// Opt-in browser acceptance using a disposable database and copied production build.
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { readConfig } from '../src/server/config';
import { createAuth, migrateAuth } from '../src/server/auth';
const { chromium } = await import(pathToFileURL(resolve(process.env.KOPES_BROWSER_DRIVER ?? '/tmp/kopes-browser-tools/node_modules/playwright-core/index.mjs')).href);
const directory=await mkdtemp(join(tmpdir(),'kopes-project-browser-'));
const docker=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(req.url?.split('?')[0]==='/containers/json'?JSON.stringify([{Id:'a'.repeat(64),Names:['/Fixture API'],Image:'fixture:1',ImageID:'sha256:'+'b'.repeat(64),Labels:{'com.docker.compose.project':'Legacy group','com.docker.compose.service':'web'}}]):'');});
docker.listen(0,'127.0.0.1');await once(docker,'listening');
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
const origin=`http://localhost:${port}`;
const env={...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),BETTER_AUTH_URL:origin,BETTER_AUTH_SECRET:'browser-fixture-secret-with-at-least-32-characters',GITHUB_CLIENT_ID:'fixture',GITHUB_CLIENT_SECRET:'fixture',GITHUB_ADMIN_USER:'alice',DATA_DIR:join(directory,'data'),DOCKER_HOST:`http://127.0.0.1:${(docker.address() as {port:number}).port}`,HOST_ROOT:join(directory,'missing'),TRIVY_BIN:'/missing',KOPES_SOURCE_PILOT:'0',KOPES_SOURCE_SCAN_PILOT:'0',KOPES_PROVENANCE_PILOT:'1'};
let child: ReturnType<typeof spawn>|undefined, browser:any;
try {
  await cp(resolve('.output'),join(directory,'.output'),{recursive:true});
  const config=readConfig(env),store=new Store(config.dataDir),auth=createAuth(config,store);await migrateAuth(auth);
  const context=await auth.$context;
  const user=await context.internalAdapter.createUser({name:'Alice',email:'alice@example.test',githubLogin:'alice',emailVerified:true},{method:'oauth',oauth:{providerId:'github',profile:{login:'alice'}}});
  const session=await context.internalAdapter.createSession(user.id);
  const value=`${session.token}.${createHmac('sha256',config.secret).update(session.token).digest('base64')}`;
  store.db.close();
  child=spawn(process.execPath,['.output/server/index.mjs'],{cwd:directory,env,stdio:'ignore'});
  let ready=false;for(let n=0;n<80;n++){try{if((await fetch(origin+'/healthz')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready);
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const browserContext=await browser.newContext({viewport:{width:1440,height:1000}});
  await browserContext.addCookies([{name:context.authCookies.sessionToken.name,value:encodeURIComponent(value),url:origin,httpOnly:true,sameSite:'Lax'}]);
  const page=await browserContext.newPage();const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));

  await page.goto(origin+'/?view=apps');
  await page.getByRole('button',{name:'Add container',exact:true}).click();
  await page.getByRole('button',{name:'Add Fixture API',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const report = page.getByRole('link',{name:'Open report for Fixture API',exact:true});
  await report.waitFor();
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    for (const view of ['Grid','Line']) {
      await page.getByRole('button',{name:view,exact:true}).click();
      await report.waitFor();
      assert.equal(await page.getByRole('link',{name:'Legacy group',exact:true}).count(),0);
      assert.equal(await page.getByRole('region',{name:'Hosts',exact:true}).count(),0);
      assert.equal(await page.getByRole('link',{name:'Open report for Host OS',exact:true}).count(),0);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      await page.screenshot({path:`/tmp/kopes-project-${width}-${view}.png`,fullPage:true});
    }
  }
  await page.getByRole('button',{name:'Add Fixture API to favourites',exact:true}).click();
  await page.getByRole('region',{name:'Favourites',exact:true}).getByRole('link',{name:'Open report for Fixture API',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Open report for Fixture API',exact:true}).count(),1);
  await report.click();
  assert.equal(await page.getByRole('navigation',{name:'Breadcrumb'}).getByRole('link',{name:'Legacy group'}).count(),0);
  await page.getByRole('link',{name:'Activity',exact:true}).click();
  await page.getByRole('region',{name:'Activity',exact:true}).waitFor();
  await page.locator('main').getByRole('link',{name:'Containers',exact:true}).click();
  await page.getByRole('button',{name:'Untrack container',exact:true}).click();
  await page.getByRole('button',{name:'Untrack Fixture API',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await report.waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
  console.log('Passed: flat container inventory, add/untrack, desktop/mobile Grid/Line, favourites and report navigation.');
} finally {await browser?.close();child?.kill('SIGTERM');if(child&&child.exitCode===null)await once(child,'exit');await new Promise<void>(r=>docker.close(()=>r()));await rm(directory,{recursive:true,force:true});}
