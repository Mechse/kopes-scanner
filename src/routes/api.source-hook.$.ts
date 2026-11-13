import { createFileRoute } from '@tanstack/react-router';
import { runtime } from '../server/runtime';
import { handleSourceHook } from '../server/source/webhook';
export const Route=createFileRoute('/api/source-hook/$')({server:{handlers:{POST:async({request})=>{
  const {store,config}=await runtime();
  const id=new URL(request.url).pathname.slice('/api/source-hook/'.length);
  if(!/^[a-f0-9-]{36}$/.test(id))return new Response('Not found.',{status:404});
  return handleSourceHook(request,store,config.secret,id);
}}}});
