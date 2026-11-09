import { ContentSkeleton } from "./ui/loading";
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Check, ChevronDown, Settings } from 'lucide-react';
import { cadenceLabels, type ScanSettings, type SettingsData } from '../lib/settings';
import { useResource } from '../lib/use-resource';
import { useWorkspace } from './app-shell';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';
export function ScanSettingsLink({ project, target, app, iconOnly = false }: { project?: string; target?: string; app?: string; iconOnly?: boolean }) {
  const link = <Button asChild variant={iconOnly ? 'ghost' : 'outline'} size="sm" className={iconOnly ? 'size-8 p-0' : undefined}><Link to="/settings" search={{ project, target, app }} aria-label={iconOnly ? 'Settings' : undefined}><Settings size={14} aria-hidden="true" />{!iconOnly && 'Settings'}</Link></Button>;
  return iconOnly ? <Tooltip label="Settings">{link}</Tooltip> : link;
}

const fieldClass = 'w-full min-w-0 rounded-md border border-border bg-raised px-3 py-2 text-sm disabled:opacity-50';
const rowClass = 'grid min-w-0 gap-3 py-4 @min-[580px]:grid-cols-[minmax(0,1fr)_260px] @min-[580px]:items-center';

export function SettingsForm({ scope, settingsKey, name, detectedName }: { scope: 'project' | 'resource'; settingsKey: string; name: string; detectedName: string }) {
  const { revision, refresh } = useWorkspace();
  const path = `settings?scope=${scope}&key=${encodeURIComponent(settingsKey)}`;
  const result = useResource<SettingsData>(path, revision);
  const [draft, setDraft] = useState<Partial<ScanSettings> | null>(null);
  const [savedValues, setSavedValues] = useState<Partial<ScanSettings> | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const data = result?.data;
  const baseline = savedValues ?? (scope === 'project' ? data?.effective : data?.overrides) ?? {};
  const values = draft ?? baseline;
  const baselineName = savedName ?? data?.displayName ?? '';
  const displayName = nameDraft ?? baselineName;
  const changed = displayName !== baselineName || (['rescanHours', 'notifyNewCve', 'notifyFix'] as const).some(key => values[key] !== baseline[key]);
  const inherited = (key: keyof ScanSettings) => scope === 'resource' && values[key] === undefined;
  function update(key: keyof ScanSettings, value: number | boolean | undefined) {
    setDraft({ ...values, [key]: value });
    setMessage('');
  }
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/data/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, displayName }) });
      if (!response.ok) throw new Error(await response.text());
      const saved: SettingsData = await response.json();
      setSavedValues(scope === 'project' ? saved.effective : saved.overrides);
      setDraft(null);
      setSavedName(saved.displayName); setNameDraft(null);
      setMessage('Settings saved.'); refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save settings.'); }
    finally { setBusy(false); }
  }
  return <div className="@container max-w-3xl py-6">
    <header className="mb-6">
      <h1 className="mb-1 text-xl font-medium tracking-tight">{scope === 'project' ? 'Project settings' : 'Resource settings'}</h1>
      <p className="text-sm leading-6 wrap-anywhere">{name}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {scope === 'project'
          ? 'Defaults for resources in this project. Individual resources can override them.'
          : `Use ${data?.project === null ? 'workspace' : 'project'} defaults or choose a value for this resource.`}
      </p>
    </header>
    {result?.error && <p role="alert" className="mb-4 rounded-md border border-critical/20 bg-critical/5 p-3 text-sm text-critical">{result.error}</p>}
    {!data ? !result?.error && <ContentSkeleton label="Loading settings…" layout="settings" /> : (
      <form onSubmit={event => { event.preventDefault(); if (!busy && changed) void save(); }}>
        <fieldset disabled={busy} className="min-w-0 border-t border-border py-4">
          <legend className="sr-only">Display name</legend>
          <label htmlFor="display-name" className="text-sm font-medium">Display name</label>
          <p id="display-name-help" className="mt-1 mb-3 text-xs leading-5 text-muted-foreground">Shared with everyone in this workspace. Leave blank to use the detected name.</p>
          <input id="display-name" aria-describedby="display-name-help" maxLength={120} className={fieldClass} value={displayName} placeholder={detectedName} onChange={event => { setNameDraft(event.target.value); setMessage(''); }} />
          <Button type="button" variant="ghost" size="sm" className="mt-2" disabled={!displayName} onClick={() => { setNameDraft(''); setMessage(''); }}>Reset to detected name</Button>
        </fieldset>
        <fieldset disabled={busy} className="min-w-0 border-t border-border pt-4">
          <legend className="sr-only">Scanning</legend>
          <h2 className="m-0! text-sm! font-medium">Scanning</h2>
          <div className={rowClass}>
            <div className="min-w-0">
              <label htmlFor="rescan-frequency" className="text-sm">Rescan frequency</label>
              <p id="rescan-help" className="mt-1 text-xs leading-5 text-muted-foreground">How often to check for new vulnerabilities.</p>
            </div>
            <select id="rescan-frequency" aria-describedby="rescan-help" className={fieldClass} value={inherited('rescanHours') ? 'inherit' : String(values.rescanHours)} onChange={event => update('rescanHours', event.target.value === 'inherit' ? undefined : Number(event.target.value))}>
              {scope === 'resource' && <option value="inherit">{data.project === null ? 'Workspace' : 'Project'} default · {cadenceLabels[data.defaults.rescanHours]}</option>}
              {Object.entries(cadenceLabels).sort(([a], [b]) => Number(a) - Number(b)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </fieldset>
        <fieldset disabled={busy} className="min-w-0 border-t border-border pt-4">
          <legend className="sr-only">Pulse notifications</legend>
          <h2 className="m-0! text-sm! font-medium">Pulse notifications</h2>
          <div className="divide-y divide-border/60">
            {([
              ['notifyNewCve', 'New CVE detected', 'Notify when a scan finds a vulnerability for the first time.'],
              ['notifyFix', 'Fix available', 'Notify when a fixed version is available.'],
            ] as const).map(([key, title, description]) => (
              <div key={key} className={rowClass}>
                <div className="min-w-0">
                  <label htmlFor={key} className="text-sm">{title}</label>
                  <p id={`${key}-help`} className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
                </div>
                <select id={key} aria-describedby={`${key}-help`} className={fieldClass} value={inherited(key) ? 'inherit' : String(values[key])} onChange={event => update(key, event.target.value === 'inherit' ? undefined : event.target.value === 'true')}>
                  {scope === 'resource' && <option value="inherit">{data.project === null ? 'Workspace' : 'Project'} default · {data.defaults[key] ? 'On' : 'Off'}</option>}
                  <option value="true">On</option><option value="false">Off</option>
                </select>
              </div>
            ))}
          </div>
        </fieldset>
        <details className="group border-t border-border py-3 text-xs text-muted-foreground">
          <summary className="flex w-fit list-none items-center gap-1.5 rounded-sm [&::-webkit-details-marker]:hidden">
            <ChevronDown size={14} className="-rotate-90 group-open:rotate-0" aria-hidden="true" />How these settings work
          </summary>
          <div className="mt-3 max-w-prose space-y-2 leading-5">
            <p>New resources and container starts are still scanned. Shared images use the shortest active rescan interval.</p>
            <p>Pulse includes all severities, grouped by project. Older CVEs can be newly detected, and fixes can trigger a notification on first detection. Unchanged findings do not send repeat notifications.</p>
            <p>Changes apply to future scans.</p>
          </div>
        </details>
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
          {message && <p role="status" className="mr-auto flex items-center gap-1.5 text-xs text-brand-ink"><Check size={14} aria-hidden="true" />{message}</p>}
          {changed && <p className="mr-auto text-xs text-muted-foreground">Unsaved changes</p>}
          <Button type="submit" size="sm" busy={busy} disabled={busy || !changed}>{busy ? 'Saving…' : 'Save changes'}</Button>
        </footer>
        {error && <p role="alert" className="mt-3 rounded-md border border-critical/20 bg-critical/5 p-3 text-sm text-critical">{error}</p>}
      </form>
    )}
  </div>;
}
