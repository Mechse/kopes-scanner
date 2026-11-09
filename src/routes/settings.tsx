import { resourceName, projectName as displayProjectName } from '../lib/display-name';
import { ContentSkeleton } from "../components/ui/loading";
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useWorkspace } from '../components/app-shell';
import { SettingsForm } from '../components/scan-settings';
import { resourceKey } from '../lib/settings';
import { AuthMethodsSettings } from '../components/auth-settings';
import { CoolifySettings } from '../components/coolify-settings';

type SettingsSearch = { project?: string; target?: string; app?: string };
export const Route = createFileRoute('/settings')({
  validateSearch: (input: Record<string, unknown>): SettingsSearch => ({
    project: typeof input.project === 'string' ? input.project : undefined,
    target: typeof input.target === 'string' ? input.target : undefined,
    app: typeof input.app === 'string' ? input.app : undefined,
  }),
  head: () => ({ meta: [{ title: 'Settings · kopes.dev' }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { project, target: targetId, app } = Route.useSearch();
  const { inventory } = useWorkspace();
  const data = inventory?.data;
  const target = data?.targets.find(item => item.id === targetId);
  const container = data?.containers.find(item => item.id === app && item.target_id === targetId);
  const isResource = targetId !== undefined;
  const appSettings = project === undefined && targetId === undefined && app === undefined;
  const valid = isResource ? !!target && (app !== undefined ? !!container : target.kind === 'host') : project !== undefined && !!data?.containers.some(item => item.project === project);
  const name = isResource ? resourceName(container ?? target) : displayProjectName(project ?? '', data);
  const settingsKey = isResource ? resourceKey(container) : project ?? '';
  const projectName = container?.project ?? project;
  const back = { view: 'apps' as const, project: projectName, target: targetId, app };
  return <main id="main" className="min-w-0 bg-raised px-4 pb-8 desktop:rounded-[10px] desktop:border desktop:border-border desktop:pb-12 desktop:shadow-sm desktop:dark:shadow-black/30">
    <nav aria-label="Breadcrumb" className="-mx-4 flex min-h-[55px] min-w-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-xs">
      <Link to="/" search={{ view: 'apps' }} className="shrink-0 text-muted-foreground hover:text-brand-ink">Projects</Link>
      {valid && isResource && projectName !== undefined && <>
        <ChevronRight size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <Link to="/" search={{ view: 'apps', project: projectName }} title={displayProjectName(projectName, data)} className="max-w-40 truncate text-muted-foreground hover:text-brand-ink">{displayProjectName(projectName, data)}</Link>
      </>}
      {valid && <>
        <ChevronRight size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <Link to="/" search={back} title={name} className="max-w-56 truncate text-muted-foreground hover:text-brand-ink">{name}</Link>
      </>}
      <ChevronRight size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      <span aria-current="page">Settings</span>
    </nav>
    {inventory?.error && <p role="alert" className="mt-4 rounded-lg border border-critical/20 bg-critical/5 p-4 text-sm text-critical">{inventory.error}</p>}
    {!data ? !inventory?.error && <ContentSkeleton label="Loading settings…" layout="settings" /> : appSettings ? data.isAdmin ? <><CoolifySettings /><AuthMethodsSettings /></> : <p role="status" className="py-6 text-sm">Administrator access is required to manage connections and sign-in methods.</p> : valid ? <SettingsForm key={`${isResource}:${settingsKey}`} scope={isResource ? 'resource' : 'project'} settingsKey={settingsKey} name={name} detectedName={isResource ? container?.name ?? target?.name ?? 'Resource' : project || 'Ungrouped'} /> : <p role="status" className="mt-6 max-w-3xl rounded-xl border border-dashed border-border p-5 text-sm leading-6 text-muted-foreground">This {isResource ? 'resource' : 'project'} is no longer in the inventory. Return to Projects to select another.</p>}
  </main>;
}
