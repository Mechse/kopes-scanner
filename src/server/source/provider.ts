import { sourceInput } from '../../lib/source-inputs';
import { SourceError } from './errors';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';

export type Provider = 'github' | 'gitlab';
export type Connection = { provider: Provider; origin: string; token: string };
export type NetworkPolicy = { gitlabOrigins: string[]; privateOrigins?: string[]; ca?: string };
export type Repository = { providerId: string; name: string; branch: string };
export type Bundle = { favicon?: string; commit: string; files: Record<string, string>; hash: string; collectedAt: number };
export class ProviderError extends Error {
  constructor(public status: number) { super(status === 401 || status === 403 ? 'Repository access denied or expired.' : status === 404 ? 'Repository, branch or input no longer available.' : status === 429 ? 'Provider rate limit reached.' : 'Provider request failed.'); }
}
export function validateOrigin(connection: Connection, policy: NetworkPolicy) {
  const url = new URL(connection.origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use an HTTPS provider origin.');
  if (connection.provider === 'github' ? url.origin !== 'https://api.github.com' : !['https://gitlab.com', ...policy.gitlabOrigins].includes(url.origin)) throw new Error('Provider origin is not approved.');
  return url.origin;
}
export function blockedAddress(address: string, allowPrivate: boolean) {
  const a = address.toLowerCase();
  if (!isIP(a) || a === '::' || a === '::1' || a.startsWith('::ffff:') || /^fe[89ab]/.test(a) || a.startsWith('ff') || a.startsWith('2001:db8:')) return true;
  if (isIP(a) === 6) return !allowPrivate && (a.startsWith('fc') || a.startsWith('fd'));
  const [x,y] = a.split('.').map(Number);
  if (x === 0 || x === 127 || x === 169 && y === 254 || x >= 224) return true;
  return !allowPrivate && (x === 10 || x === 172 && y >= 16 && y <= 31 || x === 192 && y === 168 || x === 100 && y >= 64 && y <= 127);
}
export type ReadJson = (connection: Connection, path: string) => Promise<any>;
export function providerReader(policy: NetworkPolicy): ReadJson {
  return async (connection, path) => {
    const origin = validateOrigin(connection, policy);
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid provider path.');
    const url = new URL(origin + path);
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(a => blockedAddress(a.address, policy.privateOrigins?.includes(origin) ?? false))) throw new Error('Provider address is not permitted.');
    // Resolve each request and pin the validated address at connection time. Redirects are never followed.
    return new Promise((resolve, reject) => {
      const chosen = addresses[0];
      const req = https.request(url, { method: 'GET', family: chosen.family, ca: policy.ca, signal: AbortSignal.timeout(30_000),
        lookup: (_hostname, _options, callback) => callback(null, chosen.address, chosen.family),
        headers: { 'User-Agent': 'kopes-source', Accept: 'application/json', ...(connection.provider==='github'?{'X-GitHub-Api-Version':'2026-03-10'}:{}), ...(connection.token ? connection.provider === 'github' ? { Authorization: `Bearer ${connection.token}` } : { 'PRIVATE-TOKEN': connection.token } : {}) },
      }, res => {
        if (res.statusCode !== 200) { res.resume(); reject(new ProviderError(res.statusCode ?? 0)); return; }
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) req.destroy(new Error('Provider response exceeds size limit.')); else chunks.push(chunk); });
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Invalid provider JSON.')); } });
        res.on('error', () => reject(new Error('Provider response interrupted.')));
      });
      req.setTimeout(20_000, () => req.destroy(new Error('Provider timeout.')));
      req.on('error', () => reject(new Error('Provider connection failed.'))); req.end();
    });
  };
}
const segment = (value: string) => encodeURIComponent(value);
const fullSha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40,64}$/.test(value);
export function safeInputPath(path: string) {
  return path.length <= 1024 && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') && path.split('/').every(p => p && p !== '.' && p !== '..') && path.split('/').length <= 20;
}
const inputName = sourceInput;
export class GitProvider {
  constructor(private connection: Connection, private read: ReadJson) {}
  async repository(locator: string): Promise<Repository> {
    let repo = await this.read(this.connection, this.connection.provider === 'github'
      ? /^\d+$/.test(locator) ? `/repositories/${locator}` : `/repos/${locator.split('/').map(segment).join('/')}`
      : `/api/v4/projects/${segment(locator)}`);
    if (this.connection.provider === 'github') {
      const validate = (value: any) => {
        if (!value || !/^[1-9][0-9]{0,19}$/.test(String(value.id)) || typeof value.id === 'number' && !Number.isSafeInteger(value.id)) throw new SourceError('repository-identity');
        if (typeof value.full_name !== 'string' || !/^[a-z\d-]+\/[a-z\d_.-]+$/i.test(value.full_name) || ['.','..'].includes(value.full_name.split('/')[1])) throw new SourceError('repository-response');
      };
      validate(repo);
      if (/^\d+$/.test(locator)) {
        if (String(repo.id) !== locator) throw new SourceError('repository-identity');
        // If ID lookup omits the branch, read full details through the canonical
        // endpoint using the same credentials, then recheck the ID.
        if (typeof repo.default_branch !== 'string' || !repo.default_branch) {
          repo = await this.read(this.connection, `/repos/${repo.full_name.split('/').map(segment).join('/')}`);
          validate(repo);
          if (String(repo.id) !== locator) throw new SourceError('repository-identity');
        }
      }
    }
    if (!repo?.id || typeof (repo.full_name ?? repo.path_with_namespace) !== 'string') throw new SourceError('repository-response');
    if (typeof repo.default_branch !== 'string' || !repo.default_branch) throw new SourceError('default-branch');
    return { providerId: String(repo.id), name: repo.full_name ?? repo.path_with_namespace, branch: repo.default_branch };
  }
  private root(repo: Repository) { return this.connection.provider === 'github' ? `/repos/${repo.name.split('/').map(segment).join('/')}` : `/api/v4/projects/${segment(repo.providerId)}`; }
  async head(repo: Repository, branch: string) {
    const result = await this.read(this.connection, `${this.root(repo)}${this.connection.provider === 'github' ? '/branches/' : '/repository/branches/'}${segment(branch)}`);
    const sha = result?.commit?.sha ?? result?.commit?.id;
    if (!fullSha(sha)) throw new SourceError('branch-head');
    return sha;
  }
  async history(repo: Repository, commit: string) {
    if (!fullSha(commit)) throw new Error('Immutable history commit required.');
    const root = this.root(repo), github = this.connection.provider === 'github';
    const metadata = await this.read(this.connection, `${root}${github ? '/commits/' : '/repository/commits/'}${commit}`);
    const requests = await this.read(this.connection, `${root}${github ? '/commits/' : '/repository/commits/'}${commit}${github ? '/pulls' : '/merge_requests'}?per_page=20`);
    if (!Array.isArray(requests)) throw new Error('History request list unavailable.');
    const actor = (value: any) => value && (typeof value.id === 'number' || typeof value.id === 'string') ? { providerId: String(value.id), name: String(value.login ?? value.username ?? '').slice(0,200), type: value.type === 'Bot' || value.bot === true ? 'bot' : 'provider-account' } : null;
    const changes = [];
    for (const item of requests.slice(0,5)) {
      const number = github ? item.number : item.iid;
      if (!Number.isSafeInteger(number) || number <= 0) continue;
      const detail = await this.read(this.connection, `${root}/${github ? 'pulls' : 'merge_requests'}/${number}`);
      const merged = github ? detail.merged === true : detail.state === 'merged';
      let reviews: unknown[] = [];
      if (github) {
        const result = await this.read(this.connection, `${root}/pulls/${number}/reviews?per_page=100`);
        if (Array.isArray(result)) reviews = result.filter(r=>typeof r.state==='string'&&typeof r.submitted_at==='string').map(r=>({actor:actor(r.user),state:r.state,time:r.submitted_at}));
      }
      changes.push({ providerId: String(detail.id), number, title: String(detail.title ?? '').slice(0,1000), author: actor(github ? detail.user : detail.author), merger: actor(detail.merged_by ?? detail.merge_user), merged,
        mergeCommit: fullSha(detail.merge_commit_sha) ? detail.merge_commit_sha : null, mergedAt: typeof detail.merged_at==='string'?detail.merged_at:null,
        targetBranch: String(github ? detail.base?.ref ?? '' : detail.target_branch ?? ''), reviews, reviewCoverage: github && reviews.length < 100 ? 'bounded-provider-read' : 'unknown' });
    }
    return { commit, authorText: String(github ? metadata.commit?.author?.name ?? '' : metadata.author_name ?? '').slice(0,500), committerText: String(github ? metadata.commit?.committer?.name ?? '' : metadata.committer_name ?? '').slice(0,500), authenticatedFixer: null,
      associatedRequests: changes, requestHistoryTruncated: requests.length > 5 };
  }
  async bundle(repo: Repository, commit: string): Promise<Bundle> {
    if (!fullSha(commit)) throw new Error('An immutable commit is required.');
    const deadline = Date.now() + 120_000;
    const checkDeadline = () => { if (Date.now() > deadline) throw new Error('Repository collection deadline exceeded.'); };
    const root = this.root(repo); const entries: { path: string; type: string; mode?: string; size?: number }[] = [];
    if (this.connection.provider === 'github') {
      const tree = await this.read(this.connection, `${root}/git/trees/${commit}?recursive=1`);
      if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Repository tree coverage is incomplete.');
      entries.push(...tree.tree);
    } else {
      for (let page = 1; ; page++) {
        checkDeadline();
        const batch = await this.read(this.connection, `${root}/repository/tree?ref=${commit}&recursive=true&per_page=100&page=${page}`);
        if (!Array.isArray(batch)) throw new Error('Invalid repository tree.');
        entries.push(...batch);
        if (batch.length < 100) break;
        if (page >= 100) throw new Error('Repository tree exceeds traversal limit.');
      }
    }
    const files: Record<string, string> = Object.create(null); let size = 0;
    const selected = entries.filter(e => typeof e.path === 'string' && inputName(e.path));
    if (selected.length > 200) throw new Error('Too many dependency inputs.');
    for (const entry of selected) {
      checkDeadline();
      if (!safeInputPath(entry.path) || entry.type !== 'blob' || !['100644','100755'].includes(entry.mode ?? '')) throw new Error('Unsafe or unsupported dependency input.');
      const file = await this.read(this.connection, this.connection.provider === 'github'
        ? `${root}/contents/${entry.path.split('/').map(segment).join('/')}?ref=${commit}`
        : `${root}/repository/files/${segment(entry.path)}?ref=${commit}`);
      if (file.encoding !== 'base64' || typeof file.content !== 'string' || file.type === 'symlink') throw new Error('Dependency input is not a regular file.');
      const bytes = Buffer.from(file.content, 'base64'); size += bytes.length;
      if (bytes.length > 2 * 1024 * 1024 || size > 8 * 1024 * 1024) throw new Error('Dependency input size limit exceeded.');
      // Binary Bun locks are evidence of an unsupported input, never worker text.
      files[entry.path] = entry.path.split('/').at(-1) === 'bun.lockb' ? `sha256:${createHash('sha256').update(bytes).digest('hex')}` : bytes.toString('utf8');
    }
    const hash = createHash('sha256').update(JSON.stringify(Object.entries(files).sort(([a],[b]) => a.localeCompare(b)))).digest('hex');
    const icon = entries.filter(e => e.type === 'blob' && ['100644','100755'].includes(e.mode ?? '') && (e.size ?? 0) <= 32768 && /^(?:(?:public|static|app|src\/app)\/)?(?:favicon|icon)\.(?:ico|svg|png)$/.test(e.path)).sort((a,b) => a.path.length - b.path.length)[0];
    let favicon: string | undefined;
    if (icon) {
      try {
        const file = await this.read(this.connection, this.connection.provider === 'github' ? `${root}/contents/${icon.path}?ref=${commit}` : `${root}/repository/files/${segment(icon.path)}?ref=${commit}`);
        if (file.encoding === 'base64' && typeof file.content === 'string' && file.content.length <= 46000 && file.type !== 'symlink') {
          const bytes = Buffer.from(file.content, 'base64');
          const mime = icon.path.endsWith('.svg') ? 'image/svg+xml' : icon.path.endsWith('.png') ? 'image/png' : 'image/x-icon';
          if (bytes.length && bytes.length <= 32768) favicon = `data:${mime};base64,${bytes.toString('base64')}`;
        }
      } catch { /* Optional artwork must not fail a dependency scan. */ }
    }
    return { commit, files, hash, collectedAt: Date.now(), favicon };
  }
}
