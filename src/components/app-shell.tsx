import { Link, useLocation } from '@tanstack/react-router';
import { createAuthClient } from 'better-auth/react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { IconActivity, IconCube, IconLayoutDashboard, IconMenu2, IconUsers, IconBrandGithub, IconLogout, IconMoon, IconSun } from '@tabler/icons-react';
import { Logo } from './logo';
import { Button } from './ui/button';

import type { Dashboard } from '../lib/model';
import { useResource } from '../lib/use-resource';
import { Sheet, SheetContent, SheetTrigger } from './ui/sheet';

type Inventory = Dashboard & { isAdmin: boolean };
const WorkspaceContext = createContext<{
  inventory: ReturnType<typeof useResource<Inventory>>;
  revision: number; refresh: () => void; input: string; setInput: (value: string) => void;
} | null>(null);
export function useWorkspace() {
  const state = useContext(WorkspaceContext);
  if (!state) throw new Error('Workspace unavailable');
  return state;
}
const auth = createAuthClient();
function ThemeButton() {
  const [dark, setDark] = useState(true);
  useEffect(() => { setDark(document.documentElement.dataset.theme !== 'light'); }, []);
  return <Button variant="ghost" size="icon" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => {
    const next = !dark; setDark(next); document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try { localStorage.setItem('kopes-theme', next ? 'dark' : 'light'); } catch { /* Theme works without storage. */ }
  }}>{dark ? <IconSun /> : <IconMoon />}</Button>;
}
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { data: session, isPending, error: sessionError } = auth.useSession();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const inventory = useResource<Inventory>(session ? 'inventory' : '', revision, pathname === '/' ? 2500 : 0);
  const actions = <div className="sidebar-actions"><span className="local-label">Self-hosted</span><ThemeButton />
    {session && <Button variant="ghost" size="sm" onClick={async () => {
      try {
        const result = await auth.signOut();
        if (result.error) setError('Sign out failed. Please retry.');
      } catch { setError('Sign out failed. Please retry.'); }
    }}><IconLogout />Sign out</Button>}
  </div>;
  const navigate = () => { setOpen(false); setInput(''); };
  const sidebar = <div className="sidebar-inner">
    <Link to="/" search={{}} onClick={navigate} aria-label="kopes.dev host security"><Logo width={88} /></Link>
    <span className="sidebar-product">Host security</span>
    <nav className="console-nav" aria-label="Workspace">
      {([
        ['Overview', undefined, IconLayoutDashboard], ['Apps & host', 'apps', IconCube],
        ['Activity', 'activity', IconActivity],
      ] as const).map(([label, view, Icon]) => <Link key={label} to="/" search={{ view }}
        activeOptions={{ exact: view === undefined, explicitUndefined: true }}
        onClick={navigate}><Icon size={16} />{label}</Link>)}
      {inventory?.data?.isAdmin && <Link to="/users" onClick={navigate}><IconUsers size={16} />User access</Link>}
    </nav>
    {actions}
  </div>;
  return <><a href="#main" className="skip-link">Skip to content</a>
    {!session && <header className="app-header"><a href="/" aria-label="kopes.dev host security"><Logo width={88} /></a><span>Host security</span><ThemeButton /></header>}
    {error && <div className="notice error" role="alert">{error}</div>}
    {isPending ? <main id="main" className="login"><p role="status">Checking your session…</p></main> : session ? <WorkspaceContext.Provider value={{ inventory, revision, refresh: () => setRevision(n => n + 1), input, setInput }}>
      <header className="mobile-bar"><Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild><Button variant="ghost" size="icon" aria-label="Open navigation"><IconMenu2 /></Button></SheetTrigger>
        <SheetContent title="Workspace navigation">{sidebar}</SheetContent>
      </Sheet><Logo width={76} /><span>Host security</span></header>
      <div className="console-layout"><aside className="desktop-sidebar">{sidebar}</aside>{children}</div>
    </WorkspaceContext.Provider> : <main id="main" className="login">
      <section className="sign-in"><h1>Sign in</h1><p>View vulnerability scans for this host and its container images.</p>{sessionError && <p role="alert" className="error">Authentication is unavailable. Check installation settings.</p>}<Button onClick={async () => { setError(''); try { const result = await auth.signIn.social({ provider: 'github', callbackURL: pathname, errorCallbackURL: `${pathname}?authError=1` }); if (result.error) setError('GitHub sign-in failed. Check OAuth configuration and the allowlist.'); } catch { setError('Unable to contact GitHub sign-in. Please retry.'); } }}><IconBrandGithub />Sign in with GitHub</Button><AuthError /><div className="sign-in-note">Access requires administrator approval. GitHub repositories are not requested or scanned. Scans do not change your server.</div></section>
    </main>}<footer className="app-footer"><span>kopes.dev · Local vulnerability scanning</span><span>Inventory and CVE matching—not runtime protection.</span></footer></>;
}
function AuthError() {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(new URLSearchParams(location.search).has('authError')); }, []);
  return failed ? <p className="error" role="alert">Sign-in was not completed. Check your allowed username and the GitHub OAuth callback URL.</p> : null;
}
