import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { blockedAddress, ProviderError } from './provider';

export const githubApiVersion = '2026-03-10';
type GithubDiagnostic = 'dns' | 'connection' | 'timeout' | 'response-size' | 'redirect';
export class GithubError extends ProviderError {
  constructor(status: number, public reason: 'access' | 'unavailable' | 'rate-limit' | 'temporary' | 'invalid', public retryAt = 0, public diagnostic?: GithubDiagnostic) { super(status); }
}
export type GithubRequest = { path: string; method?: 'GET' | 'POST'; token?: string; body?: Record<string, unknown>; oauth?: boolean };
export type GithubHttp = (request: GithubRequest) => Promise<any>;
/** Fixed hosts, no redirects, pinned public DNS, bounded time/body. Errors never include provider bodies. */
export function createGithubHttp(dependencies: { lookup?: typeof lookup; request?: typeof https.request; wait?: (ms: number) => Promise<void> } = {}): GithubHttp {
const send: GithubHttp = async ({ path, method = 'GET', token, body, oauth = false }) => {
  if (!path.startsWith('/') || path.startsWith('//') || /[\r\n\\#]/.test(path) || oauth && (path !== '/login/oauth/access_token' || token || method !== 'POST')) throw new GithubError(0, 'invalid');
  const url = new URL((oauth ? 'https://github.com' : 'https://api.github.com') + path);
  const addresses = await (dependencies.lookup ?? lookup)(url.hostname, { all: true }).catch(() => { throw new GithubError(0, 'temporary', 0, 'dns'); });
  if (!addresses.length || addresses.some(a => blockedAddress(a.address, false))) throw new GithubError(0, 'invalid');
  const data = body ? JSON.stringify(body) : undefined, chosen = addresses[0];
  return new Promise((resolve, reject) => {
    const req = (dependencies.request ?? https.request)(url, { method, family: chosen.family, signal: AbortSignal.timeout(30_000),
      lookup: (_host, _options, callback) => callback(null, chosen.address, chosen.family),
      headers: { 'User-Agent': 'kopes-source', Accept: 'application/json', 'X-GitHub-Api-Version': githubApiVersion,
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, res => {
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        res.resume();
        const limited = status === 429 || status === 403 && (res.headers['x-ratelimit-remaining'] === '0' || !!res.headers['retry-after']);
        const retry = Number(res.headers['retry-after']), reset = Number(res.headers['x-ratelimit-reset']) * 1000;
        const after = Number.isFinite(retry) ? Date.now() + retry * 1000 : Date.parse(String(res.headers['retry-after']));
        reject(new GithubError(status, limited ? 'rate-limit' : [401,403].includes(status) ? 'access' : status === 404 ? 'unavailable' : status === 408 || status >= 500 ? 'temporary' : 'invalid', limited ? Math.min(Date.now()+3600_000, Math.max(Date.now()+60_000, after || reset || 0)) : 0, status >= 300 && status < 400 ? 'redirect' : undefined)); return;
      }
      let size = 0; const chunks: Buffer[] = [];
      res.on('data', chunk => { size += chunk.length; if (size > 8*1024*1024) { reject(new GithubError(0, 'invalid', 0, 'response-size')); req.destroy(); } else chunks.push(chunk); });
      res.on('end', () => { try { const result = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (result.error) throw new Error(); resolve(result); } catch { reject(new GithubError(0, 'invalid')); } });
      res.on('error', () => reject(new GithubError(0, 'temporary', 0, 'connection')));
    });
    req.on('error', (error: NodeJS.ErrnoException) => reject(new GithubError(0, 'temporary', 0, ['ABORT_ERR','ETIMEDOUT'].includes(error.code ?? '') ? 'timeout' : 'connection'))); req.end(data);
  });
};
return async request => {
  for (let attempt = 0; ; attempt++) {
    try { return await send(request); }
    catch (error) {
      // Only repeat idempotent reads. Token/manifest/OAuth exchanges, rate
      // limits, rejected access and malformed responses keep their own handling.
      if (attempt >= 2 || request.method && request.method !== 'GET' || !(error instanceof GithubError) || error.reason !== 'temporary' || ![0,408,500,502,503,504].includes(error.status)) throw error;
      await (dependencies.wait ?? delay)(250 * 2 ** attempt);
    }
  }
};
}
export const githubHttp = createGithubHttp();
export function githubId(value: unknown): string {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) throw new Error('Invalid GitHub identity.');
  if (!/^[1-9][0-9]{0,19}$/.test(String(value))) throw new Error('Invalid GitHub identity.');
  return String(value);
}
export async function githubPages(http: GithubHttp, path: string, token: string, field: string) {
  const all: any[] = [];
  let expected: number | undefined;
  for (let page = 1; page <= 100; page++) {
    const result = await http({ path: `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, token });
    const rows = result[field];
    if (!Array.isArray(rows) || rows.length > 100) throw new Error('Incomplete GitHub listing.');
    if (result.total_count !== undefined) {
      if (!Number.isSafeInteger(result.total_count) || result.total_count<0 || expected!==undefined && expected!==result.total_count) throw new Error('Inconsistent GitHub listing.');
      expected=result.total_count;
    }
    all.push(...rows);
    if (rows.length < 100) {
      if (expected!==undefined && all.length!==expected) throw new Error('Incomplete GitHub listing.');
      return all;
    }
  }
  throw new Error('GitHub listing exceeds traversal limit.');
}

export function githubErrorMessage(error: GithubError) {
  const diagnostic = error.diagnostic === 'dns' ? 'GitHub DNS lookup failed. Check DNS in the scanner container.'
    : error.diagnostic === 'connection' ? 'The HTTPS connection to GitHub failed or was interrupted. Check outbound connectivity from the scanner container.'
    : error.diagnostic === 'timeout' ? 'The GitHub request timed out. Check outbound connectivity from the scanner container.'
    : error.diagnostic === 'response-size' ? 'The GitHub response exceeds the supported size limit.'
    : error.diagnostic === 'redirect' ? 'GitHub redirected the request. Refresh repository access; redirects are not followed with credentials.'
    : error.reason==='rate-limit' ? 'GitHub rate limit reached. Access is retained; retry after the provider backoff.'
    : error.reason==='access' ? 'GitHub denied access. Check credentials, permissions and organization approval; server clock skew can also prevent App authentication.'
    : error.reason==='unavailable' ? 'Repository or installation unavailable. It may have been removed or access may have changed.'
    : error.reason==='temporary' ? 'GitHub is temporarily unavailable. Retry after checking outbound HTTPS and DNS.'
    : 'GitHub returned an invalid authentication or repository response. Resume setup or check configuration.';
  return `${diagnostic}${Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? ` [HTTP ${error.status}]` : ''}`;
}
