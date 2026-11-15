import { createFileRoute } from '@tanstack/react-router';
import { runtime } from '../server/runtime';
import { githubContext } from '../server/source/github-auth';
import { setupCallback, setupHeaders } from '../server/source/github-setup';
import { githubWebhook } from '../server/source/github-webhook';
async function handle({request}:{request:Request}) {
  const {store,config} = await runtime();
  const path = new URL(request.url).pathname;
  if (request.method==='POST' && /^\/api\/github\/webhooks\/[a-f0-9-]{36}$/.test(path)) return githubWebhook(request,store,config.secret,path.split('/').pop()!);
  if (request.method==='GET' && /^\/api\/github\/(manifest|install|authorize)\/callback$/.test(path)) {
    try { return await setupCallback(request,store,await githubContext(request),config); }
    catch { return new Response(null,{status:303,headers:{...setupHeaders,Location:`${config.origin}/settings`}}); }
  }
  return new Response('Not found.',{status:404,headers:setupHeaders});
}
export const Route = createFileRoute('/api/github/$')({server:{handlers:{GET:handle,POST:handle}}});
