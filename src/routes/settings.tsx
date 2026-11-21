import { GitlabSettings } from '../components/gitlab';
import { GithubSettings } from '../components/github-settings';
import { resourceName, projectName as displayProjectName } from '../lib/display-name';
import { ContentSkeleton } from "../components/ui/loading";
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useWorkspace } from '../components/app-shell';
import { SettingsForm } from '../components/scan-settings';
import { resourceKey } from '../lib/settings';
import { AuthMethodsSettings } from '../components/auth-settings';
import { UserAccess } from '../components/user-access';
import { UntrackContainer } from '../components/add-resource';
import { SettingsTabs, SettingsPanel } from '../components/settings-tabs';
import { activeSection, activeTab, useSettingsNav, type SettingsNavData } from '../components/settings-nav';
import { providerNames } from '../components/auth-setup';
import { githubSetupNotice, type GithubSetupNotice } from '../lib/github';

type SettingsSearch = { project?: string; target?: string; app?: string; tab?: string; section?: string; connection?: string; githubSetup?: GithubSetupNotice };
export const Route = createFileRoute('/settings')({
  validateSearch: (input: Record<string, unknown>): SettingsSearch => ({
    tab: typeof input.tab === 'string' ? input.tab : undefined,
    section: typeof input.section === 'string' ? input.section : undefined,
    connection: typeof input.connection === 'string' ? input.connection : undefined,
    githubSetup: githubSetupNotice(input.githubSetup),
    project: typeof input.project === 'string' ? input.project : undefined,
    target: typeof input.target === 'string' ? input.target : undefined,
    app: typeof input.app === 'string' ? input.app : undefined,
  }),
  head: () => ({ meta: [{ title: 'Settings · kopes.dev' }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { project, target: targetId, app, tab, section, connection, githubSetup } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { inventory, refresh } = useWorkspace();
  const data = inventory?.data;
  const target = data?.targets.find(item => item.id === targetId);
  const container = data?.containers.find(item => item.id === app && item.target_id === targetId);
  const isResource = targetId !== undefined;
  const appSettings = project === undefined && targetId === undefined && app === undefined;
  const valid = isResource ? !!target && (app !== undefined ? !!container : target.kind === 'host') : project !== undefined && !!data?.containers.some(item => item.project === project);
  const name = isResource ? resourceName(container ?? target) : displayProjectName(project ?? '', data);
  const settingsKey = isResource ? resourceKey(container) : project ?? '';
  const back = { view: 'apps' as const, target: targetId, app };
  const sections: SettingsNavData['sections'] = appSettings
    ? [
      { tab: 'integrations', label: 'Integrations', children: [{ section: 'github', label: 'GitHub' },{section:'gitlab',label:'GitLab'}] },
      { tab: 'auth', label: 'Auth', children: Object.entries(providerNames).map(([section, label]) => ({ section, label })) },
      { tab: 'users', label: 'Users' },
    ]
    : [{ tab: 'general', label: 'General' }, { tab: 'notifications', label: 'Notifications' }, ...(container && data?.isAdmin ? [{ tab: 'danger', label: 'Danger zone' }] : [])];
  const current = activeTab(tab, sections);
  const currentSection = activeSection(section, sections.find(s => s.tab === current)?.children);
  useSettingsNav({
    scroll: !appSettings,
    back: appSettings ? { to: '/', search: {}, label: 'workspace' } : { to: '/', search: isResource ? back : { view: 'apps' }, label: valid ? name : 'Containers' },
    sections,
  });
  return <main id="main" className="min-w-0 bg-raised px-4 pb-8 desktop:rounded-[10px] desktop:border desktop:border-border desktop:pb-12 desktop:shadow-sm desktop:dark:shadow-black/30">
    <nav aria-label="Breadcrumb" className="-mx-4 flex min-h-[55px] min-w-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-xs">
      <Link to="/" search={{ view: 'apps' }} className="shrink-0 text-muted-foreground hover:text-brand-ink">Containers</Link>
      {valid && <>
        <ChevronRight size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <Link to="/" search={back} title={name} className="max-w-56 truncate text-muted-foreground hover:text-brand-ink">{name}</Link>
      </>}
      <ChevronRight size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      <span aria-current="page">Settings</span>
    </nav>
    {inventory?.error && <p role="alert" className="mt-4 rounded-lg border border-critical/20 bg-critical/5 p-4 text-sm text-critical">{inventory.error}</p>}
    {!data ? !inventory?.error && <ContentSkeleton label="Loading settings…" layout="settings" /> : appSettings ? data.isAdmin ? <>
      <h1 className="sr-only">Settings</h1>
      <SettingsTabs value={current}>
        <SettingsPanel value="integrations">{current === 'integrations' && (currentSection==='gitlab'?<GitlabSettings/>:<GithubSettings key={connection ?? ''} selection={connection} setupNotice={githubSetup} />)}</SettingsPanel>
        <SettingsPanel value="auth">{current === 'auth' && <AuthMethodsSettings section={currentSection!} />}</SettingsPanel>
        <SettingsPanel value="users"><div className="pt-6"><p className="mb-4 text-sm text-muted-foreground">Manage who can sign in and access this workspace.</p><UserAccess /></div></SettingsPanel>
      </SettingsTabs>
    </> : <p role="status" className="py-6 text-sm">Administrator access is required to manage connections and sign-in methods.</p> : valid ? <><SettingsForm container={container} key={`${isResource}:${settingsKey}`} scope={isResource ? 'resource' : 'project'} settingsKey={settingsKey} name={name} detectedName={isResource ? container?.name ?? target?.name ?? 'Resource' : project || 'Ungrouped'} />{container && data.isAdmin && <UntrackContainer id={container.id} name={name} onDone={() => { refresh(); void navigate({ to: '/', search: { view: 'apps' } }); }} />}</> : <p role="status" className="mt-6 max-w-3xl rounded-xl border border-dashed border-border p-5 text-sm leading-6 text-muted-foreground">This {isResource ? 'resource' : 'container'} is no longer in the inventory. Return to Containers to select another.</p>}
  </main>;
}
