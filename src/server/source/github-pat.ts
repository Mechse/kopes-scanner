import { GitProvider, ProviderError } from './provider';
import { githubHttp, githubId, type GithubHttp } from './github-http';
import { githubRepository } from './repositories';
export async function validatePat(token: string, repository: string, owner: string, history: boolean, http: GithubHttp = githubHttp) {
  if (!token || /[\r\n]/.test(token) || token.length>20000) throw new Error('Enter a valid fine-grained token.');
  const name = githubRepository(repository), connection = {provider:'github' as const,origin:'https://api.github.com',token};
  const metadata = await http({path:`/repos/${name}`,token});
  if (metadata.owner?.login?.toLowerCase() !== owner.toLowerCase() || typeof metadata.private !== 'boolean') throw new Error('Repository owner does not match the selected resource owner.');
  const id = githubId(metadata.id), provider = new GitProvider(connection,(_c,path)=>http({path,token}));
  let readiness = 'ready', inputCount = 0, historyAvailable = false;
  const repo = {providerId:id,name:String(metadata.full_name),branch:String(metadata.default_branch ?? '')};
  try {
    const commit = await provider.head(repo,repo.branch);
    const bundle = await provider.bundle(repo,commit); inputCount = Object.keys(bundle.files).length;
    if (!inputCount) readiness = 'no-supported-dependency-inputs';
  } catch (e) {
    // A GitHub 409 is the explicit empty-repository response. Other failures cannot pass validation.
    if (e instanceof ProviderError && e.status===409) readiness = 'empty-repository'; else throw e;
  }
  if (history) {
    try { const pulls = await http({path:`/repos/${name}/pulls?state=all&per_page=1`,token}); historyAvailable = Array.isArray(pulls);
      if (historyAvailable && pulls.length) { const reviews = await http({path:`/repos/${name}/pulls/${pulls[0].number}/reviews?per_page=1`,token}); historyAvailable = Array.isArray(reviews); }
    } catch { historyAvailable = false; }
  }
  return { repository:repo, privateVerified:metadata.private === true && readiness !== 'empty-repository', readiness,inputCount,historyAvailable, warning:metadata.private ? null : 'Public reads do not verify private access. Supply a private repository before saving.' };
}
