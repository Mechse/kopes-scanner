import { severityColors } from './severity-colors';
import { useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { severities, type Finding, type Severity } from '../lib/model';
import { Sheet, SheetContent, SheetTrigger } from './ui/sheet';

const cellClass = 'h-[42px] wrap-anywhere [@media(width<=520px)]:block [@media(width<=520px)]:h-auto [@media(width<=520px)]:min-w-0 [@media(width<=520px)]:border-0 [@media(width<=520px)]:p-0';

function SeverityGroup({ severity, findings, locked }: { severity: Severity; findings: Finding[]; locked: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const [limit, setLimit] = useState(50);
  const label = severity[0] + severity.slice(1).toLowerCase();
  return <tbody className="[@media(width<=520px)]:block">
    <tr className="[@media(width<=520px)]:block"><th colSpan={3} scope="rowgroup" className="bg-sunken p-0 [@media(width<=520px)]:block">
      <button className="flex w-full items-center gap-2 px-2.5 py-2 aria-[expanded=false]:[&_svg]:-rotate-90" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <IconChevronDown size={14} aria-hidden="true" />
        <i className={`size-2 rounded-full bg-current ${severityColors[severity]}`} />
        {label} <span className="font-normal text-muted-foreground">{findings.length}</span>
      </button>
    </th></tr>
    {expanded && findings.slice(0, limit).map((f, i) => <tr className="relative [@media(width<=520px)]:grid [@media(width<=520px)]:grid-cols-[minmax(0,1fr)_auto] [@media(width<=520px)]:items-center [@media(width<=520px)]:gap-x-2.5 [@media(width<=520px)]:gap-y-1 [@media(width<=520px)]:border-b [@media(width<=520px)]:border-border [@media(width<=520px)]:px-2.5 [@media(width<=520px)]:py-2" key={`${f.id}-${f.path}-${f.package}-${i}`}>
      <td className={`${cellClass} [@media(width<=520px)]:col-span-full`}><Sheet>
        <SheetTrigger asChild><button type="button" className="flex max-w-full items-baseline gap-3 text-left after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-brand-ink mobile:flex-col mobile:gap-0.5">
          <span className="max-w-[48%] flex-none font-mono text-xs wrap-anywhere text-muted-foreground tabular-nums mobile:max-w-full">{f.id}</span><strong className="truncate font-medium mobile:max-w-full [@media(width<=520px)]:whitespace-normal">{f.title || 'Untitled advisory'}</strong>
        </button></SheetTrigger>
        <SheetContent side="right" title={`Finding details for ${f.id}`}>
          <div className="p-6 wrap-anywhere">
            <p className="mb-8 text-[13px] font-[550]">Finding details</p>
            <span className={`inline-flex rounded-[3px] border border-current px-1.5 py-0.5 text-[10px] ${severityColors[severity]}`}>{label}</span>
            <p className="mt-[18px] mb-1 font-mono text-[.85em] text-muted-foreground">{f.id}</p><h2>{f.title || 'Untitled advisory'}</h2>
            <dl className="mt-6">{[
              ['Package', f.package], [locked ? 'Locked version' : 'Installed version', f.installed],
              ['Fixed version', f.fixed || 'Not available'], ['Ecosystem', f.type], ['Path', f.path],
            ].map(([name, value]) => <div key={name} className="grid grid-cols-[8em_1fr] gap-3 border-t border-border py-2.5"><dt className="text-muted-foreground">{name}</dt><dd><code>{value || 'Not reported'}</code></dd></div>)}</dl>
          </div>
        </SheetContent>
      </Sheet></td>
      <td className={cellClass}><span className="inline-block max-w-full truncate rounded-full border border-border px-2 py-px align-middle text-xs">{f.package}</span></td>
      <td className={`${cellClass} [@media(width<=520px)]:max-w-[45vw] [@media(width<=520px)]:text-right`}><span className="hidden text-[11px] text-muted-foreground [@media(width<=520px)]:inline">Fixed version </span><code className={f.fixed ? 'text-brand-ink' : 'text-muted-foreground'}>{f.fixed || '—'}</code></td>
    </tr>)}
    {expanded && findings.length > limit && <tr className="[@media(width<=520px)]:block"><td colSpan={3}><button className="cursor-pointer py-1.5 text-brand-ink" type="button"
      onClick={() => setLimit(limit + 50)}>Show {Math.min(50, findings.length - limit)} more {label.toLowerCase()} findings</button></td></tr>}
  </tbody>;
}

export function FindingsTable({ findings, locked }: { findings: Finding[]; locked: boolean }) {
  return <div className="overflow-x-auto rounded-sm border border-border"><table className="w-full min-w-0 table-fixed [@media(width<=520px)]:block mobile:[&_th]:whitespace-normal">
    <caption className="sr-only">Findings grouped by severity</caption>
    <colgroup><col /><col className="w-[21%]" /><col className="w-[18%]" /></colgroup>
    <thead className="[@media(width<=520px)]:sr-only"><tr className="[@media(width<=520px)]:block"><th>Advisory</th><th>Package</th><th>Fixed version</th></tr></thead>
    {severities.map(severity => {
      const group = findings.filter(f => f.severity === severity);
      return group.length ? <SeverityGroup key={severity} severity={severity} findings={group} locked={locked} /> : null;
    })}
  </table></div>;
}
