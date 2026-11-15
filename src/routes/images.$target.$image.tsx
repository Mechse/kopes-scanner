import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useWorkspace } from '../components/app-shell';
import { FindingsTable } from '../components/findings-table';
import { Button } from '../components/ui/button';
import { LoadingStatus } from '../components/ui/loading';
import { containerImages } from '../lib/container-images';
import { useResource } from '../lib/use-resource';
import type { Report } from '../lib/model';

export const Route = createFileRoute('/images/$target/$image')({
  validateSearch: (input: Record<string, unknown>): { app?: string; project?: string; managedId?: string } => ({
    app: typeof input.app === 'string' ? input.app : undefined,
    project: typeof input.project === 'string' ? input.project : undefined,
    managedId: typeof input.managedId === 'string' ? input.managedId : undefined,
  }),
  component: ImagePage,
});

function ImagePage() {
  const { target: targetId, image: imageId } = Route.useParams();
  const context = Route.useSearch();
  const { inventory, revision } = useWorkspace();
  const target = inventory?.data?.targets.find(target => target.id === targetId);
  const app = inventory?.data?.containers.find(container => container.id === context.app && container.target_id === targetId);
  const full = useResource<Report>(target?.scanned_at ? `report?id=${encodeURIComponent(targetId)}&scan=${target.scanned_at}` : '', revision);
  const report = full?.data ?? null;
  const error = inventory?.error || full?.error;
  const loading = !error && (!inventory?.data || (!!target?.scanned_at && !report));
  const image = target ? containerImages(target, report, app?.image).find(image => image.id === imageId) : undefined;
  const back = { ...context, view: 'apps' as const, target: targetId, tab: 'images' as const };
  return <main id="main" className="min-w-0 bg-raised px-4 pb-8 desktop:rounded-[10px] desktop:border desktop:border-border desktop:pb-12 desktop:shadow-sm desktop:dark:shadow-black/30">
    <nav aria-label="Breadcrumb" className="-mx-4 flex min-h-[55px] flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-xs">
      <Link to="/" search={{ view: 'apps' }}>Containers</Link><span aria-hidden="true">/</span>
      <Link to="/" search={back}>{app?.displayName || app?.name || target?.displayName || target?.name || 'Container'}</Link><span aria-hidden="true">/</span>
      <Link to="/" search={back}>Images</Link><span aria-hidden="true">/</span><span aria-current="page" className="wrap-anywhere">{image?.name ?? 'Image'}</span>
    </nav>
    <nav aria-label="Image navigation" className="-mx-4 border-b border-border px-4 py-2"><Button asChild size="sm" variant="ghost"><Link to="/" search={back}><ArrowLeft aria-hidden="true"/>Back to images</Link></Button></nav>
    {error ? <p role="alert" className="py-8 text-critical">{error}</p> : loading ? <LoadingStatus label="Loading image details…" className="py-12"/> : !image ? <div role="status" className="py-12"><h1>Image unavailable</h1><p className="mt-2 text-muted-foreground">This image is not available in the container’s latest scan. Return to images to view current results.</p></div> : <>
      <header className="py-6"><p className="mb-2 text-xs text-muted-foreground">{image.kind}</p><h1 className="text-2xl font-medium wrap-anywhere">{image.name}</h1><p className="mt-2 font-mono text-sm text-muted-foreground wrap-anywhere">{image.digest ?? 'Image identifier unavailable'}</p></header>
      <dl className="grid grid-cols-2 gap-5 rounded border border-border bg-sunken p-5 text-sm desktop:grid-cols-4">
        {[
          ['Findings', image.assessed ? image.findings.length : 'Not assessed'],
          ['With fixes', image.assessed ? image.findings.filter(row => !!row.finding.fixed.trim()).length : '—'],
          ['Platform', target?.platform ?? 'Unknown'],
          ['Container scanned', target?.scanned_at ? new Date(target.scanned_at).toLocaleString() : 'Not scanned yet'],
        ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 wrap-anywhere">{value}</dd></div>)}
      </dl>
      {image.identity && <dl className="my-4 space-y-2 text-xs">{[
        ['Manifest digest', image.identity.manifestDigest], ['Image-index digest', image.identity.indexDigest], ['Image-config ID', image.identity.configId],
        ['Ancestry observed', image.discoveredAt ? new Date(image.discoveredAt).toLocaleString() : undefined],
        ['Assessed', image.assessedAt ? new Date(image.assessedAt).toLocaleString() : undefined],
      ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="wrap-anywhere">{value || 'Unknown'}</dd></div>)}</dl>}
      <p className="my-4 text-sm text-muted-foreground">{image.kind !== 'Container image' ? image.standalone ? 'Standalone scan of this underlying image. Packages removed or updated by later build steps may not affect the final container.' : image.assessed ? 'Findings attributed to this verified base image in the container scan. This is not a standalone scan of the base image.' : image.error || 'This base image is declared in image metadata, but its layers could not be verified. Findings have not been attributed to it.' : report?.coverage === 'release-source' ? 'Results cover dependencies from the matched release source; full image coverage is unavailable.' : 'Results cover the scanned container image, including inherited base-image packages.'}</p>
      {image.source && <p className="my-4 text-sm text-muted-foreground">{image.source === 'local' ? 'Discovered by matching local image layers. This confirms shared filesystem layers, but not the original base-image name.' : image.source === 'dockerfile' ? 'Candidate from a Dockerfile at the producer-declared source revision, with matching filesystem layers. Source authenticity and original FROM identity are not proven.' : image.source === 'provenance' ? 'Candidate from published build provenance with matching filesystem layers. Provenance authenticity has not been cryptographically verified; the original Dockerfile FROM name is not proven.' : 'Discovered from a declared base-image reference.'}{image.inherited !== undefined && ` ${image.inherited} findings in the final container occur in these layers.`}</p>}
      {image.historical && <p role="status" className="my-4 text-sm">Historical assessment: {image.assessedAt ? new Date(image.assessedAt).toLocaleString() : 'assessment date unknown'}. Latest scan status: {image.scanStatus ?? 'unknown'}. {image.error} Rescan to refresh vulnerability results.</p>}
      {!!image.affectedFindings?.length && <section aria-label="Findings affecting the container"><h2 className="mb-3 font-medium">Still present in the container ({image.affectedFindings.length})</h2><FindingsTable showOrigins findings={image.affectedFindings} findingSearch={index => ({ ...context, view: 'apps', target: targetId, finding: index, scan: target?.scanned_at ?? undefined })}/></section>}
      <section aria-labelledby="image-findings"><h2 id="image-findings" className="mb-3 font-medium">{image.standalone ? "Standalone image findings" : "Container findings"}</h2>
        {image.standalone ? image.findings.length ? <ul className="divide-y divide-border">{image.findings.map(({ finding, index }) => <li key={index} className="py-3"><details><summary className="cursor-pointer text-sm"><span className="font-medium">{finding.id} · {finding.package}</span> · {finding.severity} · {finding.fixed ? `Fixed in ${finding.fixed}` : 'No known fix'}</summary><div className="mt-3 space-y-2 text-sm"><p>{finding.title}</p><p>Installed: {finding.installed} · {finding.path}</p>{finding.description && <p className="whitespace-pre-wrap">{finding.description}</p>}{finding.references?.[0] && <a className="underline" href={finding.references[0]} target="_blank" rel="noreferrer">Advisory details</a>}</div></details></li>)}</ul> : <p className="py-8 text-sm text-muted-foreground">No findings were reported in the standalone scan.</p> : image.findings.length ? <div className="-mx-4"><FindingsTable showOrigins findings={image.findings} findingSearch={index => ({ ...context, view: 'apps', target: targetId, finding: index, scan: target?.scanned_at ?? undefined, baseImage: image.kind === 'Base image' ? image.id : undefined })}/></div> : <p role="status" className="py-8 text-sm text-muted-foreground">{image.assessed ? 'No findings were reported for this image in the container scan.' : 'No assessment is available for this image.'}</p>}
      </section>
    </>}
  </main>;
}
