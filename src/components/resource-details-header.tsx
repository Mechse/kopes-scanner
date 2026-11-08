import { Link } from '@tanstack/react-router';
import { ArrowLeft, Info, Package } from 'lucide-react';
import type { Container, Target } from '../lib/model';
import { Assessment } from './assessment';
import { ResourceIcon } from './resource-icon';
import { pillClass } from './ui/pill';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetTrigger } from './ui/sheet';

export function ResourceDetailsHeader({ target, container, project, open, onOpenChange }: { target: Target; container?: Container; project?: string; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const name = container?.name ?? target.name;
  const parentProject = container?.project ?? project;
  const count = target.summary ? Object.values(target.summary.counts).reduce((sum, value) => sum + value, 0) : undefined;
  const status = { ready: 'Scan complete', queued: 'Queued', scanning: 'Scanning', error: 'Scan failed', unassessed: 'Not assessed' }[target.status];

  return <Sheet open={open} onOpenChange={onOpenChange}>
    {open === undefined && <SheetTrigger asChild>
      <Button variant="ghost" size="sm"><Info aria-hidden="true" />Resource details</Button>
    </SheetTrigger>}
    <SheetContent side="right" title="Resource details">
      <div className="p-5 pt-12">
        <Link
          to="/"
          search={{ view: 'apps', project: parentProject }}
          aria-label={parentProject !== undefined ? `Back to project: ${parentProject || 'Ungrouped'}` : 'Back to projects'}
          className="mb-5 inline-flex max-w-full items-center gap-2 rounded-md text-sm text-muted-foreground hover:text-brand-ink"
        >
          <ArrowLeft size={16} className="shrink-0" aria-hidden="true" />
          {parentProject !== undefined ? <><span className="shrink-0">Back to project:</span><span className="truncate" title={parentProject || 'Ungrouped'}>{parentProject || 'Ungrouped'}</span></> : 'Back to projects'}
        </Link>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground">
              {container || target.kind === 'host' ? <ResourceIcon container={container} /> : <Package size={20} aria-hidden="true" />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="mb-3 text-2xl font-medium leading-tight tracking-tight wrap-anywhere">{name}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`${pillClass} max-w-full wrap-anywhere`}>{container?.manager ?? (target.kind === 'host' ? 'Host' : 'Container image')}</span>
                <span className={pillClass}>
                  <span className={`size-1 shrink-0 rounded-full bg-current ${target.status === 'error' ? 'text-critical' : ''}`} aria-hidden="true" />{status}
                </span>
              </div>
            </div>
          </div>
        </header>
        <section aria-label="Resource summary" className="mt-5 rounded-xl border border-border p-4 sm:p-5">
          <dl className="grid min-w-0 gap-4">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{target.kind === 'host' ? 'Operating system' : 'Image'}</dt>
              <dd className="mt-1 text-sm leading-6 wrap-anywhere">{container?.image ?? (target.kind === 'host' ? target.summary?.os || 'Not identified yet' : target.name)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Platform</dt>
              <dd className="mt-1 text-sm leading-6 wrap-anywhere">{target.platform || 'Not identified yet'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Last successful scan</dt>
              <dd className="mt-1 text-sm leading-6">{target.scanned_at ? <time dateTime={new Date(target.scanned_at).toISOString()}>{new Date(target.scanned_at).toLocaleString()}</time> : 'No completed scans yet'}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Assessment targets={[target]} />
            {count !== undefined && <span className={pillClass}>{count} {count === 1 ? 'finding' : 'findings'}</span>}
            {target.summary && <>
              <span className={pillClass}>{target.summary.fixable} with fixes</span>
              <span className={pillClass}>{target.summary.packages} {target.summary.packages === 1 ? 'package' : 'packages'}</span>
            </>}
            {target.summary?.coverage === 'release-source' && <span className={pillClass}>Release-source coverage</span>}
            {target.summary?.eol && <span className={pillClass}><span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-critical" />End-of-life OS</span>}
          </div>
        </section>
      </div>
    </SheetContent>
  </Sheet>;
}
