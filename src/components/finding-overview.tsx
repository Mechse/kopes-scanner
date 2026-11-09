import { resourceName } from '../lib/display-name';
import { BusyIndicator } from "./ui/loading";
import { useState, type ReactNode } from 'react';
import { Copy, ShieldAlert, ExternalLink } from 'lucide-react';
import type { Container, Finding, Target } from '../lib/model';
import { explainVector, isCve, safeUrl, type Advisory } from '../lib/advisory';
import { remediation } from '../lib/remediation';
import { useResource } from '../lib/use-resource';
import { Button } from './ui/button';
import { severityColors } from './severity-colors';

function Command({ command }: { command: string }) {
  const [message, setMessage] = useState('');
  return <div className="mt-3 overflow-hidden rounded-md border border-border bg-sunken">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1">
      <span role="status" className="text-xs text-muted-foreground">{message || 'Run in your terminal'}</span>
      <Button size="sm" variant="ghost" aria-label="Copy command" onClick={async () => {
        try { await navigator.clipboard.writeText(command); setMessage('Copied'); }
        catch { setMessage('Could not copy. Select the command to copy it manually.'); }
      }}><Copy size={14} />Copy</Button>
    </div>
    <pre className="overflow-x-auto p-3 text-xs leading-6"><code>{command}</code></pre>
  </div>;
}
function displayDate(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not reported';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export function FindingOverview({ finding, locked, target, container, recordedAt, historical = false, resources }: { finding: Finding; locked: boolean; target: Target; container?: Container; recordedAt?: number; historical?: boolean; resources?: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const resource = useResource<Advisory>(isCve(finding.id) ? `advisory?id=${encodeURIComponent(finding.id)}` : '', revision);
  const advisory = resource?.data;
  const external = advisory?.status === 'available' ? advisory : undefined;
  const vector = finding.cvss?.vector || external?.vector;
  const explanation = explainVector(vector);
  const description = finding.description || external?.description;
  const sources = [...new Set([...(finding.references ?? []), ...(external?.references ?? []), ...(isCve(finding.id) ? [`https://www.cve.org/CVERecord?id=${finding.id}`, `https://nvd.nist.gov/vuln/detail/${finding.id}`] : [])])].filter(safeUrl);
  const steps = remediation(finding, target.kind, container, locked);
  const properties = [
    ['Package', finding.package], [locked ? 'Locked version' : 'Installed version', finding.installed],
    ['Fixed version(s)', finding.fixed || 'Not reported by scanner'], ['Ecosystem', finding.type], ['Path', finding.path],
    ['Resource', resourceName(container ?? target)], ['Published', displayDate(external?.published || finding.published)],
    ['Advisory updated', displayDate(external?.modified || finding.modified)],
    ['CVSS source', finding.cvss?.source || 'Not reported'], ['CVSS vector', vector || 'Not reported'],
    ['Weaknesses', [...new Set([...(finding.cwes ?? []), ...(external?.weaknesses ?? [])])].join('; ') || 'Not reported'],
  ];
  return <article className="mx-auto max-w-[860px] px-2 py-10 wrap-anywhere desktop:px-8 desktop:py-12">
    <div className={`mb-5 grid size-10 place-items-center rounded-lg bg-sunken ${severityColors[finding.severity]}`}><ShieldAlert size={23} aria-hidden="true" /></div>
    <p className="mb-2 font-mono text-sm text-muted-foreground">{finding.id}</p>
    <h1 className="text-[clamp(24px,3vw,36px)] leading-tight">{finding.title || 'Untitled advisory'}</h1>
    <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
      <span className={`rounded-full border border-border px-2.5 py-1 capitalize ${severityColors[finding.severity]}`}>{finding.severity.toLowerCase()}</span>
      {finding.cvss && <span className="rounded-full bg-sunken px-2.5 py-1" title={finding.cvss.source}>CVSS v{finding.cvss.version} · {finding.cvss.score.toFixed(1)}</span>}
      <span className="text-muted-foreground">{finding.fixed ? 'Fixed version reported' : 'No fixed version reported'}</span>
    </div>

    <section className="mt-8 text-sm leading-7" aria-label="What this means">
      <h2 className="mb-3 text-lg">What this means</h2>
      <p>The scan matched <strong>{finding.package} {finding.installed}</strong> to this advisory{locked ? ' using release source metadata' : ''}. Whether it can be exploited here depends on the affected features and how this resource is exposed.</p>
      {explanation.length > 0 && <><ul className="mt-3 list-disc space-y-1 pl-5">{explanation.map(line => <li key={line}>{line}</li>)}</ul><p className="mt-2 text-xs text-muted-foreground">Attack conditions and impact translated from {finding.cvss?.vector ? `the ${finding.cvss.source} scanner rating` : 'the CVE publisher’s rating'}. This is not a test of your deployment’s exposure.</p></>}
      {description ? <details className="mt-4" open><summary className="cursor-pointer font-medium">Advisory description</summary><p className="mt-2 whitespace-pre-line">{description}</p><p className="mt-2 text-xs text-muted-foreground">Source: {finding.description ? 'scanner advisory data' : `CVE record · ${external?.publisher || 'publishing authority'}`}</p></details> : <p className="mt-3 text-muted-foreground">No description is available in this scan{!resource && isCve(finding.id) ? '; checking the CVE record…' : '. Review the source links below.'}</p>}
    </section>

    {resources}

    {advisory?.status === 'rejected' && <p role="status" className="mt-6 rounded border border-border bg-sunken p-4 text-sm">This CVE record has been rejected. Review the CVE record before acting on the scanner finding. {advisory.description}</p>}
    {!historical && advisory?.status !== 'rejected' && <section className="my-8 border-l-[3px] border-brand-ink bg-brand-tint/30 px-5 py-5 text-sm" aria-label="How to fix it">
      <h2 className="mb-2 text-xl">{finding.fixed ? 'How to fix it' : 'What to do while no fix is reported'}</h2>
      {finding.fixed && <p className="mb-5 leading-6">The scanner reports <code className="rounded bg-sunken px-1.5 py-0.5">{finding.fixed}</code> as fixed. Multiple versions can refer to different release branches; check the vendor advisory for yours.</p>}
      <ol className="list-decimal space-y-5 pl-5">{steps.map(step => <li key={step.title} className="pl-1"><h3 className="font-medium">{step.title}</h3><p className="mt-1 leading-6 text-muted-foreground">{step.detail}</p>{step.command && <Command key={step.command} command={step.command} />}</li>)}</ol>
      {(external?.solutions.length || external?.workarounds.length) ? <div className="mt-6 border-t border-border pt-4"><h3 className="font-medium">Published guidance</h3><p className="mt-1 text-xs text-muted-foreground">From <a className="underline" href={external.source} target="_blank" rel="noreferrer">{external.publisher || 'the CVE publisher'}</a>. Check product and version applicability before using it.</p>{external.solutions.map((text, i) => <p key={`s${i}`} className="mt-3 whitespace-pre-line leading-6"><strong>Solution: </strong>{text}</p>)}{external.workarounds.map((text, i) => <p key={`w${i}`} className="mt-3 whitespace-pre-line leading-6"><strong>Workaround: </strong>{text}</p>)}</div> : !finding.fixed && <p className="mt-5 text-xs text-muted-foreground">{external ? 'The CVE record does not list a workaround. Linked vendor advisories may contain further guidance.' : 'No published workaround has been retrieved. Check the source advisories; this does not mean none exists.'}</p>}
    </section>}

    {!historical && target.kind === 'image' && target.suggestions.length > 0 && <section className="mb-8 text-sm"><h2 className="mb-3 text-lg">Image versions already compared</h2><p className="mb-3 text-muted-foreground">These are overall scan comparisons; they do not establish that this specific CVE is fixed.</p>{target.suggestions.map(s => <div key={s.digest} className="border-t border-border py-3"><code>{s.reference}</code><p className="mt-1 text-xs text-muted-foreground">{s.removed} advisory/package pairs removed · {s.introduced} introduced · {s.remaining} remaining · {s.platform} · checked {new Date(s.checkedAt).toLocaleString()}</p></div>)}</section>}

    <details className="border-y border-border py-4 text-sm"><summary className="cursor-pointer font-medium">Technical details</summary><dl className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)]">{properties.map(([label, value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="font-mono text-xs leading-6">{value || 'Not reported'}</dd></div>)}</dl>{locked && <p className="mt-4 text-xs text-muted-foreground">Release source coverage: dependency versions come from release metadata rather than a complete binary inventory.</p>}</details>
    <section className="mt-8 text-sm" aria-label="Sources"><h2 className="mb-3 text-lg">Sources & freshness</h2>
      <p className="text-xs leading-6 text-muted-foreground">{recordedAt !== undefined ? `Pulse update: ${new Date(recordedAt).toLocaleString()}` : `Scan: ${target.scanned_at ? new Date(target.scanned_at).toLocaleString() : 'unknown'}`}. External records add context; package fix status reflects {historical ? 'the recorded update' : 'this scan'}.</p>
      {isCve(finding.id) && <div className="my-3 text-xs text-muted-foreground" role="status">
        {!resource ? <><BusyIndicator className="mr-2" />Loading the CVE record…</> : resource.error || advisory?.status === 'unavailable' ? 'The CVE source is unavailable. Scanner details and source links are still usable. Retry in one minute.' : advisory?.status === 'not-found' ? 'No public CVE record was found.' : `CVE record retrieved ${new Date(advisory!.fetchedAt).toLocaleString()}. Cached for up to one hour.`}
        {(resource?.error || advisory?.status === 'unavailable') && <Button className="ml-2" size="sm" variant="outline" onClick={() => setRevision(r => r + 1)}>Retry source</Button>}
      </div>}
      <ul className="space-y-2">{sources.map(url => <li key={url}><a className="inline-flex items-start gap-2 underline underline-offset-4 hover:text-brand-ink" href={url} target="_blank" rel="noreferrer"><ExternalLink className="mt-1 shrink-0" size={13} aria-hidden="true" /><span>{url}</span></a></li>)}</ul>
      {!sources.length && <p className="text-muted-foreground">No source links were included. Rescan to collect advisory details.</p>}
    </section>
  </article>;
}
