import { createFileRoute } from '@tanstack/react-router';
import { createAuthClient } from 'better-auth/react';
import { useEffect, useState } from 'react';
import { IconBrandGithub, IconCube, IconDownload, IconLogout, IconMoon, IconRefresh, IconServer, IconSun } from '@tabler/icons-react';
import { Logo } from '../components/logo';
import { UserAccess } from '../components/user-access';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { severities, type Dashboard, type Report, type Severity, type Target } from '../lib/model';

export const Route = createFileRoute('/')({ component: App });
const auth = createAuthClient();
const date = (value: number | null) => value ? new Date(value).toLocaleString() : 'Not scanned yet';
async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/data/${path}`, { signal });
  if (!response.ok) throw new Error(response.status === 401 ? 'Your session is no longer authorized. Sign out and sign in again.' : 'Unable to load scan data. Check the server and try again.');
  return response.json();
}
function ThemeButton() {
  const [dark, setDark] = useState(true);
  useEffect(() => { setDark(document.documentElement.dataset.theme !== 'light'); }, []);
  return <Button variant="ghost" size="icon" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => {
    const next = !dark; setDark(next); document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try { localStorage.setItem('kopes-theme', next ? 'dark' : 'light'); } catch { /* Theme works without storage. */ }
  }}>{dark ? <IconSun /> : <IconMoon />}</Button>;
}
function App() {
  const { data: session, isPending, error: sessionError } = auth.useSession();
  const [error, setError] = useState('');
  return <><a href="#main" className="skip-link">Skip to content</a><header className="app-header"><a href="/" aria-label="kopes.dev host security"><Logo width={96} /></a><span className="product-name">Host security</span><div className="header-actions"><span className="local-label">Self-hosted</span><ThemeButton />{session && <Button variant="ghost" size="sm" onClick={async () => { try { const result = await auth.signOut(); if (result.error) setError('Sign out failed. Please retry.'); } catch { setError('Sign out failed. Please retry.'); } }}><IconLogout />Sign out</Button>}</div></header>
    {error && <div className="notice error" role="alert">{error}</div>}
    {isPending ? <main id="main" className="login"><p role="status">Checking your session…</p></main> : session ? <Workspace /> : <main id="main" className="login">
      <section className="sign-in"><h1>Sign in</h1><p>View vulnerability scans for this host and its container images.</p>{sessionError && <p role="alert" className="error">Authentication is unavailable. Check installation settings.</p>}<Button onClick={async () => { setError(''); try { const result = await auth.signIn.social({ provider: 'github', callbackURL: '/', errorCallbackURL: '/?authError=1' }); if (result.error) setError('GitHub sign-in failed. Check OAuth configuration and the allowlist.'); } catch { setError('Unable to contact GitHub sign-in. Please retry.'); } }}><IconBrandGithub />Sign in with GitHub</Button><AuthError /><div className="sign-in-note">Access requires administrator approval. GitHub repositories are not requested or scanned. Scans do not change your server.</div></section>
    </main>}<footer className="app-footer"><span>kopes.dev · Local vulnerability scanning</span><span>Inventory and CVE matching—not runtime protection.</span></footer></>;
}
function AuthError() {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(new URLSearchParams(location.search).has('authError')); }, []);
  return failed ? <p className="error" role="alert">Sign-in was not completed. Check your allowed username and the GitHub OAuth callback URL.</p> : null;
}
function Workspace() {
  const [data, setData] = useState<(Dashboard & { isAdmin: boolean }) | null>(null);
  const [selected, setSelected] = useState('host');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try { setData(await api<Dashboard & { isAdmin: boolean }>('inventory', controller.signal)); setError(''); }
      catch (e) { if (!controller.signal.aborted) { setError((e as Error).message); setData(null); } }
      finally { loading = false; }
    };
    void load(); const timer = setInterval(() => { void load(); }, 10_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  const target = data?.targets.find(t => t.id === selected);
  const groups = [...new Set(data?.containers.map(c => c.project) ?? [])];
  const allCounts = Object.fromEntries(severities.map(s => [s, data?.targets.reduce((n, t) => n + (t.summary?.counts[s] ?? 0), 0) ?? 0]));
  return <main id="main" className="workspace"><section className="workspace-heading"><div><h1>Scan overview</h1><p className="muted">{data ? `${data.containers.length} running containers · ${data.targets.filter(t => t.kind === 'image').length} unique images · re-match every ${data.intervalHours} hours` : 'Connecting to your installation…'}</p></div><div className="inventory-stamp">Inventory refreshed<br /><strong>{date(data?.inventoryAt ?? null)}</strong></div></section>
    {error && <div role="alert" className="notice error">{error}</div>}{data?.inventoryError && <div role="alert" className="notice error">{data.inventoryError}</div>}
    {data?.isAdmin && <UserAccess />}
    <section className="metrics" aria-label="Latest scan totals"><Metric label="Critical" value={allCounts.CRITICAL} severity="CRITICAL" /><Metric label="High" value={allCounts.HIGH} severity="HIGH" /><Metric label="Findings with a fix" value={data?.targets.reduce((n, t) => n + (t.summary?.fixable ?? 0), 0) ?? 0} /><Metric label="Targets awaiting a scan" value={data?.targets.filter(t => t.status !== 'ready').length ?? 0} /></section>
    <p className="metric-note">Latest completed results per unique image and host. Pending, failed, or unsupported scans are not a clean bill of health.</p>
    <div className="workspace-grid"><aside className="inventory" aria-label="Host and running containers"><div className="section-label">Inventory</div>{data?.targets.filter(t => t.kind === 'host').map(t => <TargetButton key={t.id} target={t} selected={selected === t.id} onClick={() => setSelected(t.id)} label="Host OS packages" />)}
      {groups.map(group => <section className="inventory-group" key={group}><h2>{group}</h2>{data?.containers.filter(c => c.project === group).map(c => { const t = data.targets.find(t => t.id === c.target_id); return t && <TargetButton key={c.id} target={t} label={c.name} sublabel={c.image} selected={selected === t.id} onClick={() => setSelected(t.id)} />; })}</section>)}
      {data && !data.containers.length && <p className="empty-small">No running containers discovered. Host packages are scanned independently.</p>}
    </aside><section className="detail">{target ? <TargetDetail key={target.id} target={target} /> : <div className="empty"><IconServer size={32} /><h2>{data ? 'Select a target' : 'Waiting for inventory'}</h2><p>Discovered images and host packages will appear here. Initial scans may take several minutes while vulnerability databases download.</p></div>}</section></div>
  </main>;
}
function Metric({ label, value, severity }: { label: string; value: number; severity?: Severity }) { return <div className="metric"><span>{label}</span><strong className={severity ? `severity-${severity.toLowerCase()}` : ''}>{value}</strong></div>; }
function TargetButton({ target, selected, label, sublabel, onClick }: { target: Target; selected: boolean; label: string; sublabel?: string; onClick: () => void }) {
  return <button className="target-button" aria-pressed={selected} onClick={onClick}>{target.kind === 'host' ? <IconServer size={18} /> : <IconCube size={18} />}<span><strong>{label}</strong><small title={sublabel}>{sublabel || target.summary?.os || 'Linux package databases'}</small></span><span className={`status-dot ${target.status}`} title={target.status}><span className="sr-only">{target.status}</span></span></button>;
}
function TargetDetail({ target }: { target: Target }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState('');
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('ALL');
  const [fixable, setFixable] = useState(false);
  const [page, setPage] = useState(0);
  const [packagePage, setPackagePage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setReport(null);
    if (target.scanned_at) void api<Report>(`report?id=${encodeURIComponent(target.id)}`, controller.signal).then(r => { setReport(r); setPage(0); setPackagePage(0); setError(''); }).catch(e => { if (!controller.signal.aborted) setError((e as Error).message); });
    return () => controller.abort();
  }, [target.id, target.scanned_at]);
  const findings = report?.findings.filter(f => (severity === 'ALL' || f.severity === severity) && (!fixable || f.fixed) && `${f.id} ${f.package} ${f.title}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const packages = report?.packages.filter(p => `${p.name} ${p.version}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const reset = () => { setPage(0); setPackagePage(0); };
  return <><div className="detail-heading"><div><span className={`status-label ${target.status}`}>{target.status}</span><h2>{target.kind === 'host' ? 'Host OS packages' : target.name}</h2><p className="muted">{target.summary?.os || 'OS not identified yet'}{target.platform ? ` · ${target.platform}` : ''}<br />Last successful scan: {date(target.scanned_at)}</p></div><div className="detail-actions"><Button variant="outline" size="sm" disabled={target.status === 'scanning' || target.status === 'queued'} onClick={async () => {
    setAction('Queuing scan…');
    try { const response = await fetch(`/api/data/rescan?id=${encodeURIComponent(target.id)}`, { method: 'POST' }); setAction(response.ok ? 'Scan queued. Results refresh automatically.' : await response.text()); } catch { setAction('Could not queue the scan. Try again.'); }
  }}><IconRefresh />Scan now</Button>{target.scanned_at && <Button asChild variant="ghost" size="sm"><a href={`/api/data/sbom?id=${encodeURIComponent(target.id)}`}><IconDownload />SBOM</a></Button>}</div></div>
    {action && <p className="notice" role="status">{action}</p>}{error && <p className="notice error" role="alert">{error}</p>}{target.error && <p className="notice error" role="alert">Scan failed: {target.error} {target.scanned_at && 'Results below are from the last successful scan.'}</p>}{target.summary?.eol && <p className="notice error">This OS is end-of-life. Vulnerability coverage and fixed versions may be incomplete.</p>}
    {target.status === 'scanning' && <p className="notice" role="status">Scanning locally. Image downloads and upgrade checks can take several minutes.</p>}
    {target.suggestions.length > 0 && <section className="recommendations" aria-label="Verified image comparisons"><div className="section-label">Image comparisons</div>{target.suggestions.map(s => <article key={s.digest}><div className="recommendation-title"><code>{s.tag}</code><span>{s.removed} advisory/package pairs no longer detected</span></div><p>{s.introduced} newly detected · {s.remaining} remaining · checked {date(s.checkedAt)}</p><details><summary>Scanned digest and upgrade caveats</summary><code className="digest">{s.reference}</code><p>Platform: {s.platform}. Update your Compose image reference yourself after testing. A missing finding can also mean a package was removed or coverage changed; this is not proof of compatibility or complete remediation.</p></details></article>)}</section>}
    {target.recommendation_note && <p className="recommendation-note">{target.recommendation_note}</p>}
    <Tabs defaultValue="findings" onValueChange={reset}><TabsList aria-label="Scan results"><TabsTrigger value="findings">Findings {report ? `(${report.findings.length})` : ''}</TabsTrigger><TabsTrigger value="packages">Packages {report ? `(${report.packages.length})` : ''}</TabsTrigger></TabsList><div className="filters"><label className="search"><span className="sr-only">Search packages or advisories</span><input placeholder="Search packages or advisories…" value={query} onChange={e => { setQuery(e.target.value); reset(); }} /></label></div>
    <TabsContent value="findings"><div className="finding-filters"><label>Severity <select value={severity} onChange={e => { setSeverity(e.target.value); reset(); }}><option value="ALL">All severities</option>{severities.map(s => <option key={s}>{s}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={fixable} onChange={e => { setFixable(e.target.checked); reset(); }} />Fixed version available</label></div>
      {report ? findings.length ? <><div className="table-scroll"><table><caption className="sr-only">Vulnerabilities in the selected target</caption><thead><tr><th>Severity</th><th>Advisory / package</th><th>Installed</th><th>Fixed version</th></tr></thead><tbody>{findings.slice(page * 50, (page + 1) * 50).map((f, i) => <tr key={`${f.id}-${f.package}-${i}`}><td><span className={`severity-badge severity-${f.severity.toLowerCase()}`}>{f.severity.toLowerCase()}</span></td><td><strong className="mono">{f.package}</strong><details><summary>{f.id}</summary><p>{f.title}</p><small>{f.type} · {f.path}</small></details></td><td><code>{f.installed}</code></td><td><code className={f.fixed ? 'fixed-version' : 'muted'}>{f.fixed || 'Not available'}</code></td></tr>)}</tbody></table></div><Pagination count={findings.length} page={page} setPage={setPage} /></> : <div className="empty"><h3>{report.findings.length ? 'No findings match these filters.' : 'No known vulnerabilities detected.'}</h3><p>Results reflect the current vulnerability database and supported package coverage—not a guarantee that this target is secure.</p></div> : <div className="empty"><h3>No completed scan yet.</h3><p>Results will appear automatically. A failed or pending scan does not mean zero vulnerabilities.</p></div>}
    </TabsContent><TabsContent value="packages">{report ? <><div className="table-scroll"><table><caption className="sr-only">Detected packages</caption><thead><tr><th>Package</th><th>Version</th><th>Ecosystem</th></tr></thead><tbody>{packages.slice(packagePage * 50, (packagePage + 1) * 50).map((p, i) => <tr key={`${p.name}-${i}`}><td className="mono">{p.name}</td><td><code>{p.version}</code></td><td>{p.type}</td></tr>)}</tbody></table></div><Pagination count={packages.length} page={packagePage} setPage={setPackagePage} /></> : <p className="empty">Package inventory is available after the first successful scan.</p>}</TabsContent></Tabs>
  </>;
}
function Pagination({ count, page, setPage }: { count: number; page: number; setPage: (page: number) => void }) { return <div className="pagination"><span>{count ? `${page * 50 + 1}–${Math.min((page + 1) * 50, count)} of ${count}` : 'No packages match'}</span><div><Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="ghost" size="sm" disabled={(page + 1) * 50 >= count} onClick={() => setPage(page + 1)}>Next</Button></div></div>; }
