import { useState } from 'react';
import { Settings } from 'lucide-react';
import { cadenceLabels, type ScanSettings, type SettingsData } from '../lib/settings';
import { useResource } from '../lib/use-resource';
import { useWorkspace } from './app-shell';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetTrigger } from './ui/sheet';

export function ScanSettingsButton({ scope, settingsKey, name }: { scope: 'project' | 'resource'; settingsKey: string; name: string }) {
  const [open, setOpen] = useState(false);
  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger asChild><Button variant="ghost" size="sm" aria-label={`Settings for ${name}`}><Settings size={14} /><span className="sr-only sm:not-sr-only">Settings</span></Button></SheetTrigger>
    <SheetContent side="right" title={`Settings for ${name}`}>
      {open && <SettingsForm scope={scope} settingsKey={settingsKey} name={name} />}
    </SheetContent>
  </Sheet>;
}

function SettingsForm({ scope, settingsKey, name }: { scope: 'project' | 'resource'; settingsKey: string; name: string }) {
  const { revision, refresh } = useWorkspace();
  const path = `settings?scope=${scope}&key=${encodeURIComponent(settingsKey)}`;
  const result = useResource<SettingsData>(path, revision);
  const [draft, setDraft] = useState<Partial<ScanSettings> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const data = result?.data;
  const values = draft ?? (scope === 'project' ? data?.effective : data?.overrides) ?? {};
  const inherited = (key: keyof ScanSettings) => scope === 'resource' && values[key] === undefined;
  function update(key: keyof ScanSettings, value: number | boolean | undefined) {
    setDraft({ ...values, [key]: value });
    setMessage('');
  }
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/data/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      if (!response.ok) throw new Error(await response.text());
      const saved: SettingsData = await response.json();
      setDraft(scope === 'project' ? saved.effective : saved.overrides);
      setMessage('Settings saved.'); refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save settings.'); }
    finally { setBusy(false); }
  }
  const selectClass = 'mt-2 w-full rounded border border-border bg-raised px-3 py-2 text-sm';
  return <div className="px-5 py-12">
    <p className="text-xs text-muted-foreground">{scope === 'project' ? 'Project defaults' : 'Resource settings'}</p>
    <h2 className="mt-2 wrap-anywhere">{name}</h2>
    <p className="mb-6 text-sm text-muted-foreground">{scope === 'project' ? 'Applies to resources unless they override a setting.' : `Inherits ${data?.project === null ? 'workspace defaults' : 'project settings'}. Override only what needs to differ.`}</p>
    {result?.error && <p role="alert">{result.error}</p>}
    {!data ? <p role="status">Loading settings…</p> : <form onSubmit={event => { event.preventDefault(); void save(); }} className="grid gap-6">
      <fieldset disabled={busy} className="grid gap-6">
        <label className="text-sm font-medium">Rescan frequency
          <select className={selectClass} value={inherited('rescanHours') ? 'inherit' : String(values.rescanHours)} onChange={event => update('rescanHours', event.target.value === 'inherit' ? undefined : Number(event.target.value))}>
            {scope === 'resource' && <option value="inherit">Use {data.project === null ? 'default' : 'project setting'} · {cadenceLabels[data.defaults.rescanHours]}</option>}
            {Object.entries(cadenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <span className="mt-2 block text-xs font-normal text-muted-foreground">New resources and container starts are still scanned. Shared images use the shortest active rescan interval.</span>
        </label>
        <div className="border-t border-border pt-5"><h3 className="text-sm font-medium">Pulse notifications</h3><p className="mt-1 text-xs text-muted-foreground">All severities, grouped by project.</p></div>
        {([['notifyNewCve', 'New CVE detected', 'Any CVE newly detected on this resource, including older CVEs.'], ['notifyFix', 'Fix available', 'When a fixed version becomes available, including for a newly detected CVE.']] as const).map(([key, title, description]) => <label key={key} className="text-sm font-medium">{title}
          <span className="mt-1 block text-xs font-normal text-muted-foreground">{description}</span>
          <select className={selectClass} value={inherited(key) ? 'inherit' : String(values[key])} onChange={event => update(key, event.target.value === 'inherit' ? undefined : event.target.value === 'true')}>
            {scope === 'resource' && <option value="inherit">Use {data.project === null ? 'default' : 'project setting'} · {data.defaults[key] ? 'On' : 'Off'}</option>}
            <option value="true">On</option><option value="false">Off</option>
          </select>
        </label>)}
      </fieldset>
      <p className="text-xs text-muted-foreground">Changes apply to future scans. Unchanged findings do not create repeat messages.</p>
      {error && <p role="alert" className="text-sm text-critical">{error}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
      <Button type="submit" disabled={busy || draft === null}>{busy ? 'Saving…' : 'Save settings'}</Button>
    </form>}
  </div>;
}
