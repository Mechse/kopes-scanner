import { useEffect, useLayoutEffect, useState } from 'react';
import { Link, useLocation, type LinkProps } from '@tanstack/react-router';
import { ArrowLeft, Bell, KeyRound, Mail, Plug, Server, Settings2, TriangleAlert, Users } from 'lucide-react';
import { GithubIcon, GoogleIcon, MicrosoftIcon } from './brand-icons';
import { navLinkClass, useWorkspace } from './app-shell';

/** `scroll`: sections are anchors on one page (by element id) instead of `?tab=` subpages. */
export type SettingsNavData = { back: LinkProps & { label: string }; sections: { tab: string; label: string; children?: SettingsNavChild[] }[]; scroll?: boolean };
/** A nested subpage of a tab, selected by `?section=`. */
export type SettingsNavChild = { section: string; label: string };

const icons = { general: Settings2, notifications: Bell, danger: TriangleAlert, integrations: Plug, auth: KeyRound, users: Users } as Record<string, typeof Settings2>;
const childIcons = { github: GithubIcon, google: GoogleIcon, microsoft: MicrosoftIcon, coolify: Server, email: Mail } as Record<string, (props: { size?: number }) => React.ReactNode>;

/** Active section: the `?tab=` value when listed, otherwise the first section. */
export function activeTab(tab: string | undefined, sections: SettingsNavData['sections']) {
  return sections.some(s => s.tab === tab) ? tab! : sections[0]?.tab;
}

/** Active subpage: the `?section=` value when listed, otherwise the first child. */
export function activeSection(section: string | undefined, children: SettingsNavChild[] = []) {
  return children.some(c => c.section === section) ? section! : children[0]?.section;
}

/** Swap the app sidebar for this page's settings nav while mounted. */
export function useSettingsNav(nav: SettingsNavData | null) {
  const { setSettingsNav } = useWorkspace();
  const key = JSON.stringify(nav);
  useLayoutEffect(() => {
    setSettingsNav(nav);
    return () => setSettingsNav(null);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- nav is plain data, keyed by its JSON
}

/** Scroll-spy: last section whose top passed the 120px line; the last one once the scroller hits bottom. */
function useActiveSection(ids: string[], enabled: boolean) {
  const [active, setActive] = useState(ids[0]);
  const key = ids.join();
  useEffect(() => {
    if (!enabled) return;
    const update = (event?: Event) => {
      const scroller = event?.target instanceof Element ? event.target : document.scrollingElement;
      const atBottom = !!scroller && scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      const passed = ids.filter(id => (document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= 120);
      setActive(atBottom ? ids[ids.length - 1] : passed[passed.length - 1] ?? ids[0]);
    };
    update();
    document.addEventListener('scroll', update, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', update, { capture: true });
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps -- ids keyed by join
  return active;
}

export function SettingsNav({ back: { label, ...back }, sections, scroll, onNavigate }: SettingsNavData & { onNavigate: () => void }) {
  const search = useLocation({ select: l => l.search as { tab?: string; section?: string } });
  const spied = useActiveSection(sections.map(s => s.tab), !!scroll);
  const current = scroll ? spied : activeTab(search.tab, sections);
  // Read in render: app-shell imports this module, so navLinkClass is uninitialised at our module load.
  const linkClass = `${navLinkClass} min-w-0`;
  return <nav className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 desktop:mx-1" aria-label="Settings">
    <Link {...back} className={`${linkClass} mb-3 text-foreground`} onClick={onNavigate}><ArrowLeft size={16} aria-hidden="true"/><span className="truncate">Back to {label}</span></Link>
    {sections.map(({ tab, label, children }) => {
      const Icon = icons[tab] ?? Settings2;
      const content = <><Icon size={16} aria-hidden="true"/><span className="truncate">{label}</span></>;
      const ariaCurrent = tab === current ? (scroll ? 'location' : 'page') : undefined;
      return scroll
        ? <a key={tab} href={`#${tab}`} className={`${linkClass} aria-[current=location]:bg-brand-tint aria-[current=location]:text-brand-ink`} aria-current={ariaCurrent} onClick={event => {
            event.preventDefault();
            onNavigate();
            // Wait a frame so the mobile sheet releases its scroll lock first.
            requestAnimationFrame(() => document.getElementById(tab)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
          }}>{content}</a>
        : <div key={tab} className="grid min-w-0 gap-1">
            <Link to="." search={(prev: Record<string, unknown>) => ({ ...prev, tab, section: undefined })} replace resetScroll={false} className={`${linkClass} ${ariaCurrent && children?.length ? 'text-foreground' : ''}`} aria-current={children?.length ? undefined : ariaCurrent} onClick={onNavigate}>{content}</Link>
            {tab === current && !!children?.length && <div className="ml-[17px] grid min-w-0 gap-1 border-l border-border pl-2">
              {children.map(child => {
                const ChildIcon = childIcons[child.section] ?? Settings2;
                return <Link key={child.section} to="." search={(prev: Record<string, unknown>) => ({ ...prev, tab, section: child.section })} replace resetScroll={false} className={linkClass} aria-current={child.section === activeSection(search.section, children) ? 'page' : undefined} onClick={onNavigate}><ChildIcon size={16}/><span className="truncate">{child.label}</span></Link>;
              })}
            </div>}
          </div>;
    })}
  </nav>;
}
