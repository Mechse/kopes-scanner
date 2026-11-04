import { ShieldAlert } from 'lucide-react';
import type { Finding } from '../lib/model';
import { severityColors } from './severity-colors';

export function FindingOverview({ finding, locked }: { finding: Finding; locked: boolean }) {
  const { severity, cvss, fixed } = finding;
  const properties = [
    ['Package', finding.package],
    [locked ? 'Locked version' : 'Installed version', finding.installed],
    ['Fixed version', fixed || 'Not available'],
    ['Ecosystem', finding.type],
    ['Path', finding.path],
  ];
  return <article className="mx-auto max-w-[780px] px-2 py-10 wrap-anywhere desktop:px-8 desktop:py-16">
    <div className={`mb-5 grid size-10 place-items-center rounded-lg bg-sunken ${severityColors[severity]}`}>
      <ShieldAlert size={23} aria-hidden="true" />
    </div>
    <p className="mb-2 font-mono text-sm text-muted-foreground">{finding.id}</p>
    <h1 className="text-[clamp(24px,3vw,36px)] leading-tight">{finding.title || 'Untitled advisory'}</h1>
    <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
      <span className={`rounded-full border border-border px-2.5 py-1 capitalize ${severityColors[severity]}`}>{severity.toLowerCase()}</span>
      {cvss && <span className="rounded-full bg-sunken px-2.5 py-1" title={cvss.source}>CVSS v{cvss.version} · {cvss.score.toFixed(1)}</span>}
      <span className="text-muted-foreground">{fixed ? 'Fix available' : 'No fix available'}</span>
    </div>
    <dl className="mt-8 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-4 border-t border-border pt-6 text-sm">
      {properties.map(([label, value]) => <div key={label} className="contents">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="font-mono">{value || 'Not reported'}</dd>
      </div>)}
    </dl>
  </article>;
}
