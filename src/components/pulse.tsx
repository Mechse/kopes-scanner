import { ContentSkeleton, LoadingStatus } from "./ui/loading";
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Bookmark, EyeOff, CircleCheck, Activity, RotateCcw, Box } from 'lucide-react';
import { useResource } from '../lib/use-resource';
import { currentPulseItem, pulseFindingEvent, hasPulseFix, pulseRank, type CurrentPulseItem, type PulseItem, type PulseKind } from '../lib/pulse';
import { type Dashboard, type Target } from '../lib/model';
import { severityColors } from './severity-colors';
import { Button } from './ui/button';
import { pillClass } from './ui/pill';

const labels: Record<PulseKind, string> = { discovered: 'New', fix: 'Fix available', resolved: 'Not detected', changed: 'Updated', failure: 'Scan failed', recovered: 'Scan recovered', coverage: 'Coverage changed' };
function dayLabel(time: number) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (time >= today.getTime()) return 'Today';
  if (time >= yesterday.getTime()) return 'Yesterday';
  return new Date(time).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}
function timeLabel(time: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  return minutes < 1 ? 'Now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function Pulse({ data, revision }: { data: Dashboard; revision: number; targetName: (target: Target) => string }) {
  const [tab, setTab] = useState('Relevant');
  const [filter, setFilter] = useState('All updates');
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [overrides, setOverrides] = useState<Record<string, Pick<PulseItem, 'dismissed' | 'bookmarked' | 'seq'>>>({});
  const resource = useResource<PulseItem[]>('pulse-feed', revision + refresh, 30000);
  useEffect(() => {
    if (!resource?.data) return;
    setOverrides(old => Object.fromEntries(Object.entries(old).filter(([id, state]) => {
      const saved = resource.data!.find(item => item.id === id);
      return saved && saved.seq === state.seq && (saved.dismissed !== state.dismissed || saved.bookmarked !== state.bookmarked);
    })));
  }, [resource?.data]);
  const items = (resource?.data ?? []).map(item => overrides[item.id]?.seq === item.seq ? { ...item, ...overrides[item.id] } : item);
  const targetIds = new Set(data.targets.map(target => target.id));
  const currentItems = items.map(item => currentPulseItem(item, targetIds)).filter(item => item !== null);
  const visible = currentItems.filter(item => (filter === 'Dismissed' ? item.dismissed : !item.dismissed)
    && (filter !== 'Bookmarks' || item.bookmarked)
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
      if (updated) setOverrides(old => ({ ...old, [item.id]: { seq: updated.seq, dismissed: updated.dismissed, bookmarked: updated.bookmarked } }));
      setRefresh(n => n + 1);
    } catch (error) { setError((error as Error).message); }
    finally { setPending(''); }
  }
  function renderItem(item: CurrentPulseItem) {
    const latest = item.events[0];
    const finding = pulseFindingEvent(item)?.finding;
    const resolved = item.events.every(e => e.kind === 'resolved');
    const fix = hasPulseFix(item);
    const title = finding ? finding.title || latest.issue : labels[latest.kind];
    const currentEvents = item.events;
    const appCount = new Set(currentEvents.map(event => event.target)).size;
    const appLabel = `${appCount} ${appCount === 1 ? 'app' : 'apps'}`;
    const status = resolved ? 'Not detected' : fix ? 'Fix available' : labels[latest.kind];
    const bookmarkLabel = item.bookmarked ? 'Remove bookmark' : 'Bookmark';
    return <article key={item.id} aria-label={finding ? `${latest.issue}: ${title}` : title}
      className="group/pulse relative mb-7 sm:mb-8">
      <Link
        {...(finding
          ? { to: '/issues/$issue' as const, params: { issue: latest.issue } }
          : { to: '/' as const, search: { view: 'apps' as const, target: latest.target } })}
        aria-label={finding ? `Open ${latest.issue}: ${title}` : `Open report: ${title}`}
        className="block rounded-sm py-1 hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-ink"
      >
        <span className="flex min-w-0 items-center gap-2 pr-24">
          <span className="line-clamp-2 text-[15px] font-medium leading-6 wrap-anywhere" title={title}>{title}</span>
          {item.bookmarked && <Bookmark size={12} className="shrink-0 text-muted-foreground" fill="currentColor" aria-label="Bookmarked" />}
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5 pb-0.5">
          {finding && !resolved && <span className={pillClass}><span aria-hidden="true" className={`size-1 rounded-full bg-current ${severityColors[finding.severity]}`} />{finding.severity.charAt(0) + finding.severity.slice(1).toLowerCase()}</span>}
          {finding && <span className={pillClass}>{latest.issue}</span>}
          {finding && <span className={pillClass}>{(resolved || fix) && <CircleCheck size={11} />}{status}</span>}
          <span className={`${pillClass} max-w-48`} title="Apps in the current inventory"><Box size={12} className="shrink-0" /><span className="truncate">{appLabel}</span></span>
        </span>
      </Link>
      {pending === item.id && <LoadingStatus label="Saving…" className="mt-2 text-xs" />}
      <div className="pointer-events-none absolute top-0.5 right-0 flex h-7 items-center">
        <time className="px-1 text-xs text-muted-foreground [@media(hover:hover)]:group-hover/pulse:opacity-0 [@media(hover:hover)]:group-focus-within/pulse:opacity-0" dateTime={new Date(item.time).toISOString()} title={new Date(item.time).toLocaleString()}>{timeLabel(item.time)}</time>
        <div className="pointer-events-auto flex items-center rounded-md bg-background text-muted-foreground [@media(hover:hover)]:absolute [@media(hover:hover)]:right-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/pulse:opacity-100 [@media(hover:hover)]:group-focus-within/pulse:opacity-100">
          <Button variant="ghost" size="icon" className="size-7" disabled={!!pending} aria-label={bookmarkLabel} title={bookmarkLabel} aria-pressed={item.bookmarked} onClick={() => void act(item, item.bookmarked ? 'unbookmark' : 'bookmark')}><Bookmark size={14} fill={item.bookmarked ? 'currentColor' : 'none'} /></Button>
          <Button variant="ghost" size="icon" className="size-7" disabled={!!pending} aria-label={item.dismissed ? 'Restore' : 'Dismiss'} title={item.dismissed ? 'Restore' : 'Dismiss'} onClick={() => void act(item, item.dismissed ? 'restore' : 'dismiss')}>{item.dismissed ? <RotateCcw size={14} /> : <EyeOff size={14} />}</Button>
        </div>
      </div>
    </article>;
  }
  return <section aria-label="Pulse updates">
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <nav aria-label="Pulse views" className="flex flex-wrap gap-2">
        {['Relevant', 'Recent', 'Fix available'].map(label => <button key={label} onClick={() => setTab(label)} aria-pressed={tab === label}
          className="rounded-full border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-sunken aria-pressed:bg-sunken aria-pressed:font-medium aria-pressed:text-foreground">{label}</button>)}
      </nav>
      <select aria-label="Filter Pulse updates" value={filter} onChange={e => setFilter(e.target.value)} className="rounded-md border border-border bg-raised px-3 py-2 text-xs text-muted-foreground">
        {['All updates', 'Bookmarks', 'Dismissed'].map(value => <option key={value}>{value}</option>)}
      </select>
    </div>
    <div className="mx-auto max-w-[800px] px-1 pt-4 pb-12 sm:px-6 sm:pt-6">
      {tab === 'Relevant' && <p className="mb-5 text-xs text-muted-foreground">Highest risks and available fixes first.</p>}
      {(error || resource?.error) && <div role="alert" className="mb-6 rounded-md border border-border p-4 text-sm">{error || resource?.error}<Button variant="ghost" size="sm" onClick={() => setRefresh(n => n + 1)}>Retry</Button></div>}
      {!resource && <ContentSkeleton label="Loading Pulse…" layout="feed" />}
      {resource?.data && !visible.length && <div role="status" className="py-16 text-center"><Activity className="mx-auto mb-4 text-muted-foreground" size={28} /><h2 className="text-lg">{items.length ? 'You’re caught up here' : 'Waiting for the first findings'}</h2><p className="mt-2 text-sm text-muted-foreground">{items.length ? 'No updates match this view. Try another filter.' : 'Vulnerabilities, fixes, and scan changes will appear here as scans complete.'}</p></div>}
      {visible.map((item, index) => <div key={item.id}>
        {(index === 0 || dayLabel(visible[index - 1].time) !== dayLabel(item.time)) && <h2 className="mt-8 mb-4 text-xs font-medium tracking-normal text-muted-foreground">{dayLabel(item.time)}</h2>}
        {renderItem(item)}
      </div>)}
    </div>
  </section>;
}
