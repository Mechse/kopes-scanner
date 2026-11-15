import { ancestryReasons, normalizeAncestry } from '../lib/ancestry';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { containerImages, type ContainerImage } from '../lib/container-images';
import type { Container, Report, Target } from '../lib/model';
import { FindingsSearch } from './findings-search';
import { SearchToolbar } from './search-toolbar';
import { LoadingStatus } from './ui/loading';

type Context = { app?: string; project?: string; managedId?: string };
function ImageSection({ label, images, target, context }: { label: string; images: ContainerImage[]; target: string; context: Context }) {
  const [expanded, setExpanded] = useState(true);
  return <tbody>
    <tr><th colSpan={2} scope="rowgroup" className="finding-section"><button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><ChevronDown size={10} aria-hidden="true"/>{label} <span className="font-normal text-muted-foreground">{images.length}</span></button></th></tr>
    {expanded && images.map(image => {
      const hasFix = image.findings.some(row => !!row.finding.fixed.trim());
      const status = !image.assessed ? 'Not assessed' : image.findings.length ? `${image.findings.length} findings · ${hasFix ? 'Fix available' : 'No known fix'}` : 'No findings';
      return <tr key={image.id} className="finding-row"><td><Link to="/images/$target/$image" params={{ target, image: image.id }} search={context} className="finding-summary package-summary">
        <span className="finding-mobile-package">{image.name}</span><span className="finding-mobile-status">{image.kind} · {status}{image.historical ? ' · Historical assessment' : ''}</span>
        <span className="finding-score" aria-label={status}>{image.assessed ? image.findings.length : '—'}</span>
        <span className="finding-id" title={image.digest ?? undefined}>{image.digest ? image.digest.slice(0, 19) : '—'}</span>
        <i role="img" aria-label={status} title={status} className={`finding-ring relative z-10 ${hasFix ? 'filled' : ''} ${image.findings.length ? 'text-high' : 'text-muted-foreground'}`}/><strong title={image.name}>{image.name}</strong>
      </Link></td><td><span className="finding-chip">{image.historical ? `Historical · ${image.scanStatus ?? "unknown"}` : image.kind}</span></td></tr>;
    })}
  </tbody>;
}

export function ContainerImages({ target, report, scannedAt, error, app, project, managedId }: { target: Target; report: Report | null; scannedAt: number | null; error: string; app?: Container; project?: string; managedId?: string }) {
  const [query, setQuery] = useState('');
  const images = containerImages(target, report, app?.image);
  const coverage = report ? normalizeAncestry(report).ancestry : undefined;
  const groups = [
    { label: 'With findings', images: images.filter(image => image.assessed && image.findings.length) },
    { label: 'No findings', images: images.filter(image => image.assessed && !image.findings.length) },
    { label: 'Not assessed', images: images.filter(image => !image.assessed) },
  ];
  const matches = (image: ContainerImage) => `${image.name} ${image.digest ?? ''} ${image.kind}`.toLowerCase().includes(query.trim().toLowerCase());
  return <>
    {coverage && <details className="my-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer">{coverage.state === 'confirmed-no-base' ? 'Confirmed no base image.' : 'Ancestry incomplete — some underlying images could not be identified.'} <span className="underline underline-offset-2">Details</span></summary>
      <div className="mt-2 space-y-2 border-l border-border pl-3">
        {coverage.reasons.map(reason => <p key={reason}>{ancestryReasons[reason]}</p>)}
        {report?.baseDiscoveryNote && <p>{report.baseDiscoveryNote}</p>}
        {!!report?.buildOnlyImages?.length && <p>Build-stage candidates (not runtime ancestry): {[...new Set(report.buildOnlyImages.map(image => image.name))].join(', ')}.</p>}
        <p>Standalone image counts may overlap. Prioritize findings affecting the container.</p>
        {scannedAt && <p>Container scanned {new Date(scannedAt).toLocaleString()}</p>}
      </div>
    </details>}
    <SearchToolbar><FindingsSearch label="Search images" value={query} onChange={setQuery}/></SearchToolbar>
    {error && <p role="alert" className="my-4 text-critical">{error}</p>}
    {target.scanned_at && !report && !error ? <LoadingStatus label="Loading images…" className="py-12"/> : <div className="-mx-4 findings-list">
      {!images.some(matches) && <p role="status" className="px-4 py-12 text-sm text-muted-foreground">No images match your search.</p>}
      <table><caption className="sr-only">Container images grouped by findings</caption><thead className="sr-only"><tr><th>Finding count, digest and image</th><th>Image role</th></tr></thead>
        {groups.map(group => <ImageSection key={group.label} label={group.label} images={group.images.filter(matches)} target={target.id} context={{ app: app?.id, project, managedId }}/>)}</table>
    </div>}
  </>;
}
