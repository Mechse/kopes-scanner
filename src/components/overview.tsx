import { severityColors } from './severity-colors';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowUpRight, Package, Server } from 'lucide-react';
import { severities, type Dashboard, type Target } from '../lib/model';

type Props = { data: Dashboard; priorities: Target[]; targetName: (target: Target) => string };
const scanTime = (time: number) => new Date(time).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

const metricClass = 'grid content-start gap-1 border-l border-border px-[clamp(12px,2vw,28px)]';
const metricValueClass = 'text-[clamp(22px,2.2vw,32px)] font-[540] tracking-[-.045em] tabular-nums';
const linkClass = 'inline-flex w-fit items-center gap-1';
const targetClass = 'w-full items-center gap-2.5 rounded-[5px] p-3 text-left hover:bg-sunken';
const sectionClass = 'mt-8 [@media(width<=600px)]:mt-[22px] [&>p]:mb-3.5 [&>p]:text-muted-foreground';

export function Overview({ data, priorities, targetName }: Props) {
  const [selectedId, setSelectedId] = useState('');
  const selected = priorities.find(t => t.id === selectedId) ?? priorities[0];
  const compared = data.targets.filter(t => t.summary?.newCves !== undefined);
  const changes = compared.filter(t => t.summary!.newCves!.length)
    .sort((a, b) => b.scanned_at! - a.scanned_at!);
  const count = new Set(changes.flatMap(t => t.summary!.newCves!)).size;
  const ready = data.targets.filter(t => t.status === 'ready').length;
  const latest = data.targets.reduce((time, t) => Math.max(time, t.scanned_at ?? 0), 0);
  const fixable = priorities.reduce((total, t) => total + t.summary!.fixable, 0);

  return <div className="mt-6 max-w-[1160px] [&_a:hover]:underline [&_a_svg]:size-3.5">
    <section className="grid grid-cols-[1fr_1fr_1.3fr] border-y border-border py-[18px] [@media(width<=600px)]:grid-cols-2 [@media(width<=600px)]:gap-y-3 [@media(width<=600px)]:py-3 [&_a]:text-muted-foreground [&_small]:text-muted-foreground [&_span]:text-muted-foreground" aria-label="Scan summary">
      <div className="grid content-start gap-1 pr-[clamp(12px,2vw,28px)]"><span>Scan coverage</span><strong className={metricValueClass}>{ready} / {data.targets.length}</strong><Link className={linkClass} to="/" search={{ view: 'activity', log: true }}>Targets ready <ArrowUpRight /></Link></div>
      <div className={metricClass}><span>Fix available</span><strong className={metricValueClass}>{latest ? fixable : '—'}</strong><small>Findings with a fixed version</small></div>
      <div className={`${metricClass} [@media(width<=600px)]:col-span-full [@media(width<=600px)]:flex [@media(width<=600px)]:flex-wrap [@media(width<=600px)]:items-baseline [@media(width<=600px)]:gap-1.5 [@media(width<=600px)]:border-t [@media(width<=600px)]:border-l-0 [@media(width<=600px)]:px-0 [@media(width<=600px)]:pt-2.5`}><span>Last completed scan</span><strong className="my-auto text-[clamp(16px,1.65vw,24px)] font-[540] tracking-[-.045em] tabular-nums [@media(width<=600px)]:text-[13px] [@media(width<=600px)]:tracking-normal">{latest ? scanTime(latest) : 'Waiting'}</strong><small>Rescans follow project and resource settings</small></div>
    </section>
    <section className={sectionClass}>
      <h2 className="flex items-center gap-2 text-[18px]">Newly detected CVEs {compared.length > 0 && <span className="rounded-[5px] bg-sunken px-[7px] py-px text-xs text-muted-foreground">{count}</span>}</h2>
      <p>{compared.length ? `Latest scan compared with the previous scan for ${compared.length} of ${data.targets.length} targets.` : 'Changes will appear after a target has two comparable scans.'}</p>
      {compared.length > 0 && !count && <p>No new CVEs in those comparisons.</p>}
      {changes.map(t => <details className="border-b border-border px-0.5 py-2.5 wrap-anywhere" key={t.id}>
        <summary>{targetName(t)} <span className="ml-2 text-xs text-muted-foreground">{t.summary!.newCves!.length} new · {scanTime(t.scanned_at!)}</span></summary>
        <div className="flex flex-wrap gap-x-4 gap-y-2 pt-3 pb-1 font-mono">{t.summary!.newCves!.map(id => <Link className={linkClass} key={id} to="/" search={{ view: 'apps', target: t.id, match: id }}>{id}<ArrowUpRight /></Link>)}</div>
      </details>)}
    </section>
    <section className={sectionClass}>
      <h2 className="flex items-center gap-2 text-[18px]">Fix priorities <span className="rounded-[5px] bg-sunken px-[7px] py-px text-xs text-muted-foreground">{priorities.length}</span></h2>
      <p>Affected targets with available fixes first, then by severity.</p>
      {selected ? <div className="grid grid-cols-[minmax(0,3fr)_minmax(240px,2fr)] rounded-lg border border-border bg-raised [@media(width<=850px)]:block">
        <div className="max-h-[65vh] overflow-auto p-1.5 [@media(width<=850px)]:max-h-none">{priorities.map(t => {
          const severity = severities.find(s => t.summary!.counts[s])!;
          const Icon = t.kind === 'host' ? Server : Package;
          const label = <><Icon className="flex-none text-muted-foreground" size={17} /><span className="flex-1 wrap-anywhere">{targetName(t)}</span><small className={`text-xs capitalize ${severityColors[severity]}`}>{severity.toLowerCase()}</small></>;
          return <div key={t.id}>
            <button className={`${targetClass} flex aria-pressed:bg-brand-tint aria-pressed:shadow-[inset_2px_0_var(--brand-ink)] [@media(width<=850px)]:hidden`} aria-pressed={selected.id === t.id} onClick={() => setSelectedId(t.id)}>{label}</button>
            <Link className={`${targetClass} hidden [@media(width<=850px)]:flex`} to="/" search={{ view: 'apps', target: t.id }}>{label}</Link>
          </div>;
        })}</div>
        <aside className="border-l border-border p-[clamp(16px,2vw,28px)] wrap-anywhere [@media(width<=850px)]:hidden" aria-label="Selected target">
          <small className="text-muted-foreground">{selected.kind === 'host' ? 'Host' : 'Container image'} · {selected.status}</small>
          <h3 className="mt-2 mb-0.5 text-xl">{targetName(selected)}</h3>
          <p className="text-muted-foreground">{selected.summary!.coverage ? 'Release-source Rust dependencies' : selected.summary!.os || 'OS unidentified'}</p>
          <dl className="my-[18px] [&>div]:flex [&>div]:justify-between [&>div]:border-b [&>div]:border-border [&>div]:py-1.5 [&_dd]:tabular-nums [&_dt]:first-letter:uppercase">{severities.filter(s => selected.summary!.counts[s]).map(s => <div key={s}><dt><i className={`mr-2 inline-block size-[7px] rounded-full bg-current ${severityColors[s]}`} />{s.toLowerCase()}</dt><dd>{selected.summary!.counts[s]}</dd></div>)}
            <div><dt>With a fixed version</dt><dd>{selected.summary!.fixable}</dd></div>
          </dl>
          <Link className={`${linkClass} font-[550]`} to="/" search={{ view: 'apps', target: selected.id }}>Open scan report <ArrowUpRight /></Link>
        </aside>
      </div> : <p>{latest ? 'No findings in the latest completed reports.' : 'Waiting for the first completed report.'}</p>}
    </section>
  </div>;
}
