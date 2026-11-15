/** Explicitly opt-in live, read-only provider probe. Never use sign-in OAuth credentials as a PAT. */
import { validatePat } from '../src/server/source/github-pat';
import { GithubError } from '../src/server/source/github-http';
const token = process.env.KOPES_TEST_GITHUB_PAT;
const repository = process.env.KOPES_TEST_GITHUB_REPOSITORY;
const owner = process.env.KOPES_TEST_GITHUB_OWNER;
if (!token || !repository || !owner) {
  console.error('Set KOPES_TEST_GITHUB_PAT, KOPES_TEST_GITHUB_REPOSITORY and KOPES_TEST_GITHUB_OWNER to a disposable private repository and its fine-grained read-only token. No provider test was run.');
  process.exitCode = 2;
} else {
  try {
    const result = await validatePat(token,repository,owner,process.env.KOPES_TEST_GITHUB_HISTORY==='1');
    console.log(JSON.stringify({observedAt:new Date().toISOString(),provider:'live GitHub HTTPS',...result,scanWorkerValidated:false,appRegistrationValidated:false,tokenExpirySource:'not available; do not infer no expiry'},null,2));
    if (!result.privateVerified) process.exitCode=1;
  } catch(e) {
    console.error(JSON.stringify({observedAt:new Date().toISOString(),provider:'live GitHub HTTPS',privateVerified:false,error:e instanceof GithubError?e.reason:'Read validation failed; check credentials, network, owner and repository.'}));
    process.exitCode=1;
  }
}
