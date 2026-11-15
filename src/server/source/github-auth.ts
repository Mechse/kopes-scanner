import { runtime } from '../runtime';
import { isAdministrator, requireSession } from '../auth';
import type { GithubContext } from './github-setup';
/** Re-read runtime settings and the session after external awaits (including admin changes). */
export async function githubContext(request: Request): Promise<GithubContext> {
  const state = await runtime();
  const session = await requireSession(request,state.auth,state.config,state.store);
  if (!isAdministrator(session.user,state.config)) throw new Response('Administrator access required.',{status:403});
  return {userId:session.user.id,sessionId:session.session.id,recheck:async()=>{
    const fresh = await runtime();
    const current = await requireSession(request,fresh.auth,fresh.config,fresh.store);
    if (current.user.id!==session.user.id || current.session.id!==session.session.id || !isAdministrator(current.user,fresh.config)) throw new Response('Administrator session required.',{status:403});
  }};
}
