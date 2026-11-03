import { useLocation } from '@tanstack/react-router';
import { createAuthClient } from 'better-auth/react';
import { useEffect, useState, type ReactNode } from 'react';
import { IconBrandGithub, IconLogout, IconMoon, IconSun } from '@tabler/icons-react';
import { Logo } from './logo';
import { Button } from './ui/button';

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
  return <><a href="#main" className="skip-link">Skip to content</a><header className="app-header"><a href="/" aria-label="kopes.dev host security"><Logo width={96} /></a><span className="product-name">Host security</span><div className="header-actions"><span className="local-label">Self-hosted</span><ThemeButton />{session && <Button variant="ghost" size="sm" onClick={async () => { try { const result = await auth.signOut(); if (result.error) setError('Sign out failed. Please retry.'); } catch { setError('Sign out failed. Please retry.'); } }}><IconLogout />Sign out</Button>}</div></header>
    {error && <div className="notice error" role="alert">{error}</div>}
    {isPending ? <main id="main" className="login"><p role="status">Checking your session…</p></main> : session ? children : <main id="main" className="login">
      <section className="sign-in"><h1>Sign in</h1><p>View vulnerability scans for this host and its container images.</p>{sessionError && <p role="alert" className="error">Authentication is unavailable. Check installation settings.</p>}<Button onClick={async () => { setError(''); try { const result = await auth.signIn.social({ provider: 'github', callbackURL: pathname, errorCallbackURL: `${pathname}?authError=1` }); if (result.error) setError('GitHub sign-in failed. Check OAuth configuration and the allowlist.'); } catch { setError('Unable to contact GitHub sign-in. Please retry.'); } }}><IconBrandGithub />Sign in with GitHub</Button><AuthError /><div className="sign-in-note">Access requires administrator approval. GitHub repositories are not requested or scanned. Scans do not change your server.</div></section>
    </main>}<footer className="app-footer"><span>kopes.dev · Local vulnerability scanning</span><span>Inventory and CVE matching—not runtime protection.</span></footer></>;
}
function AuthError() {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(new URLSearchParams(location.search).has('authError')); }, []);
  return failed ? <p className="error" role="alert">Sign-in was not completed. Check your allowed username and the GitHub OAuth callback URL.</p> : null;
}
