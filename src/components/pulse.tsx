import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Bookmark, Check, Eye, EyeOff, ShieldAlert, CircleCheck, Activity, RotateCcw } from 'lucide-react';
import { useResource } from '../lib/use-resource';
import { batchPulse, hasPulseFix, pulseRank, type PulseItem, type PulseKind } from '../lib/pulse';
import { severities, type Dashboard, type Target } from '../lib/model';
import { severityColors } from './severity-colors';
import { Button } from './ui/button';

const labels: Record<PulseKind, string> = { discovered: 'New finding', fix: 'Fix available', resolved: 'No longer detected', changed: 'Finding updated', failure: 'Scan needs attention', recovered: 'Scan recovered', coverage: 'Coverage changed' };
function dayLabel(time: number) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (time >= today.getTime()) return 'Today';
  if (time >= yesterday.getTime()) return 'Yesterday';
  return new Date(time).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}
function timeLabel(time: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function Pulse({ data, revision, targetName }: { data: Dashboard; revision: number; targetName: (target: Target) => string }) {
  const [tab, setTab] = useState('Relevant');
  const [filter, setFilter] = useState('All updates');
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [overrides, setOverrides] = useState<Record<string, Pick<PulseItem, 'read' | 'dismissed' | 'bookmarked' | 'seq'>>>({});
  const resource = useResource<PulseItem[]>('pulse-feed', revision + refresh, 30000);
  useEffect(() => {
    if (!resource?.data) return;
    setOverrides(old => Object.fromEntries(Object.entries(old).filter(([id, state]) => {
      const saved = resource.data!.find(item => item.id === id);
      return saved && saved.seq === state.seq && (saved.read !== state.read || saved.dismissed !== state.dismissed || saved.bookmarked !== state.bookmarked);
    })));
  }, [resource?.data]);
  const items = (resource?.data ?? []).map(item => overrides[item.id]?.seq === item.seq ? { ...item, ...overrides[item.id] } : item);
  const visible = items.filter(item => (filter === 'Dismissed' ? item.dismissed : !item.dismissed)
    && (filter !== 'Bookmarks' || item.bookmarked) && (filter !== 'Unread' || !item.read)
    && (tab !== 'Fix available' || hasPulseFix(item)));
  visible.sort((a, b) => {
    const dateDelta = new Date(b.time).setHours(0, 0, 0, 0) - new Date(a.time).setHours(0, 0, 0, 0);
    return dateDelta || (tab === 'Relevant' ? pulseRank(a) - pulseRank(b) : 0) || b.time - a.time;
  });
  async function act(item: PulseItem, action: string) {
    setPending(item.id); setError('');
    try {
      const response = await fetch('/api/data/pulse-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issue: item.id, seq: item.seq, action }) });
      if (!response.ok) throw new Error('Could not save your change. Please try again.');
      const updated = (await response.json() as PulseItem[]).find(i => i.id === item.id);
      if (updated) setOverrides(old => ({ ...old, [item.id]: { seq: updated.seq, read: updated.read, dismissed: updated.dismissed, bookmarked: updated.bookmarked } }));
      setRefresh(n => n + 1);
    } catch (error) { setError((error as Error).message); }
    finally { setPending(''); }
  }
  const batches = batchPulse(visible);
  function renderItem(item: PulseItem) {
        const latest = item.events[0];
        const finding = item.events.filter(e => e.kind !== 'resolved' && e.finding).sort((a, b) => severities.indexOf(a.finding!.severity) - severities.indexOf(b.finding!.severity))[0]?.finding ?? item.events.find(e => e.finding)?.finding;
        const resolved = item.events.every(e => e.kind === 'resolved');
        const fix = hasPulseFix(item);
        const Icon = resolved || latest.kind === 'recovered' ? CircleCheck : finding ? ShieldAlert : Activity;
        const statusColor = resolved || latest.kind === 'recovered' ? 'text-brand-ink' : finding ? severityColors[finding.severity] : 'text-medium';
        const title = finding ? finding.title || latest.issue : labels[latest.kind];
        const kinds = [...new Set(item.events.map(e => labels[e.kind]))];
        return <div key={item.id}>
          <article aria-label={finding ? `${latest.issue}: ${title}` : title} className="mb-12 wrap-anywhere sm:mb-16">
            <div className="flex items-start justify-between gap-4"><h3 className="text-xl leading-snug font-medium tracking-tight sm:text-[23px]">{title}</h3><span className="mt-2 flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{item.bookmarked && <Bookmark size={14} fill="currentColor" aria-label="Bookmarked" />}{!item.read && <span className="size-2 rounded-full bg-brand-ink" aria-label="Unread" />}</span></div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span className={`inline-flex items-center gap-2 ${statusColor}`}><Icon size={17} />{resolved ? 'No longer detected' : finding ? finding.severity.charAt(0) + finding.severity.slice(1).toLowerCase() : labels[latest.kind]}</span>
              {finding && <span className="text-muted-foreground">{latest.issue}</span>}
              <time className="text-muted-foreground" dateTime={new Date(item.time).toISOString()} title={new Date(item.time).toLocaleString()}>{timeLabel(item.time)}</time>
            </div>
            <p className="mt-5 text-[15px] leading-7 text-muted-foreground">{finding
              ? `${kinds.join(' · ')} across ${item.events.length} ${item.events.length === 1 ? 'resource' : 'resources'}. ${resolved ? 'This advisory was absent from the latest comparable scans.' : fix ? 'A fixed version is reported for at least one affected package. Review the scan report for upgrade details.' : 'Review the affected packages and advisory before taking action.'}`
              : latest.detail}</p>
            <ul className="mt-3 space-y-2 text-sm">{item.events.map(event => {
              const target = data.targets.find(t => t.id === event.target);
              return <li key={event.resource ?? event.target} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {target ? <Link to="/" search={{ view: 'apps', target: target.id, match: event.finding ? event.issue : undefined }} className="font-medium underline-offset-4 hover:underline">{event.resourceName ?? targetName(target)}</Link> : <span>{event.name} (removed)</span>}
                <span className="text-xs text-muted-foreground">{labels[event.kind]}{event.kind !== 'resolved' && event.finding?.fixed ? ` · Fix: ${event.finding.fixed}` : ''}</span>
              </li>;
            })}</ul>
            <div className="mt-5 flex flex-wrap gap-1 text-muted-foreground">
              <Button variant="ghost" size="sm" disabled={!!pending} aria-pressed={item.read} onClick={() => void act(item, item.read ? 'unread' : 'read')}><Check size={14} />{item.read ? 'Mark unread' : 'Mark as read'}</Button>
              <Button variant="ghost" size="sm" disabled={!!pending} aria-pressed={item.bookmarked} onClick={() => void act(item, item.bookmarked ? 'unbookmark' : 'bookmark')}><Bookmark size={14} fill={item.bookmarked ? 'currentColor' : 'none'} />{item.bookmarked ? 'Bookmarked' : 'Bookmark'}</Button>
              <Button variant="ghost" size="sm" disabled={!!pending} onClick={() => void act(item, item.dismissed ? 'restore' : 'dismiss')}>{item.dismissed ? <RotateCcw size={14} /> : <EyeOff size={14} />}{item.dismissed ? 'Restore' : 'Dismiss'}</Button>
              {item.read && <span className="inline-flex items-center gap-1 px-2 text-xs"><Eye size={12} />Read</span>}
            </div>
          </article>
        </div>;

  }
  return <section aria-label="Pulse updates">
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <nav aria-label="Pulse views" className="flex flex-wrap gap-2">
        {['Relevant', 'Recent', 'Fix available'].map(label => <button key={label} onClick={() => setTab(label)} aria-pressed={tab === label}
          className="rounded-full border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-sunken aria-pressed:bg-sunken aria-pressed:font-medium aria-pressed:text-foreground">{label}</button>)}
      </nav>
      <select aria-label="Filter Pulse updates" value={filter} onChange={e => setFilter(e.target.value)} className="rounded-md border border-border bg-raised px-3 py-2 text-xs text-muted-foreground">
        {['All updates', 'Unread', 'Bookmarks', 'Dismissed'].map(value => <option key={value}>{value}</option>)}
      </select>
    </div>
    <div className="mx-auto max-w-[800px] px-1 pt-6 pb-12 sm:px-6 sm:pt-10">
      {tab === 'Relevant' && <p className="mb-8 text-xs text-muted-foreground">Latest changes, with unread risks and available fixes first each day.</p>}
      {(error || resource?.error) && <div role="alert" className="mb-6 rounded-md border border-border p-4 text-sm">{error || resource?.error}<Button variant="ghost" size="sm" onClick={() => setRefresh(n => n + 1)}>Retry</Button></div>}
      {!resource && <p role="status" className="py-12 text-sm text-muted-foreground">Loading Pulse…</p>}
      {resource?.data && !visible.length && <div role="status" className="py-16 text-center"><Activity className="mx-auto mb-4 text-muted-foreground" size={28} /><h2 className="text-lg">{items.length ? 'You’re caught up here' : 'Waiting for the first findings'}</h2><p className="mt-2 text-sm text-muted-foreground">{items.length ? 'No updates match this view. Try another filter.' : 'Vulnerabilities, fixes, and scan changes will appear here as scans complete.'}</p></div>}
      {batches.map((batch, index) => <div key={batch.key}>
        {(index === 0 || dayLabel(batches[index - 1].time) !== dayLabel(batch.time)) && <div className="mb-9 flex items-center gap-4 text-sm text-muted-foreground"><h2 className="m-0 text-sm font-normal tracking-normal">{dayLabel(batch.time)}</h2><div className="h-px flex-1 bg-border" /></div>}
        {batch.items.length === 1 ? renderItem(batch.items[0]) : <details className="group mb-12 wrap-anywhere rounded-lg border border-border px-5 py-4 sm:mb-16">
          <summary className="cursor-pointer text-lg font-medium">
            {batch.items.length} updates for {batch.items[0].events.map(e => e.resourceName || data.targets.find(t => t.id === e.target)?.name || e.name).join(', ')}
            <span className="mt-2 block text-sm font-normal leading-6 text-muted-foreground">Within ten minutes · {batch.items.filter(i => !i.read).length} unread · {batch.items.filter(i => i.events.some(e => e.kind !== 'resolved' && e.finding?.severity === 'CRITICAL')).length} critical · {batch.items.filter(hasPulseFix).length} with fixes. Expand to review each vulnerability.</span>
          </summary>
          <div className="mt-8">{batch.items.map(renderItem)}</div>
        </details>}
      </div>)}
    </div>
  </section>;
}
