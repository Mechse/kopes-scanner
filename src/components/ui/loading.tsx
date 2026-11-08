import { cn } from '../../lib/utils';

/** Small enough for buttons and status pills; inherits the surrounding text color. */
export function BusyIndicator({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('busy-indicator', className)} />;
}

export function LoadingStatus({ label, className }: { label: string; className?: string }) {
  return <p role="status" className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}><BusyIndicator />{label}</p>;
}

function Bone({ className }: { className?: string }) {
  return <div className={cn('loading-bone h-3 rounded', className)} />;
}

type Layout = 'feed' | 'projects' | 'table' | 'settings' | 'detail' | 'timeline' | 'scan-log';

/** One announcement and one shared animation, regardless of the number of placeholders. */
export function ContentSkeleton({ label, layout = 'table', className }: { label: string; layout?: Layout; className?: string }) {
  return <div role="status" aria-label={label} className={cn('loading-placeholder', layout === 'timeline' || layout === 'scan-log' ? 'py-0' : 'py-6', className)}>
    <span className="sr-only">{label}</span>
    <div aria-hidden="true" className="loading-shapes">
      {layout === 'timeline' ? <div className="-mx-4 overflow-x-auto">
        <div className="min-w-[38rem]">
          <div className="grid grid-cols-[minmax(10rem,28%)_1fr] border-b border-border bg-sunken">
            <div className="px-4 py-2.5"><Bone className="w-10" /></div>
            <div className="grid grid-cols-4 divide-x divide-dashed divide-border">
              {[0, 1, 2, 3].map(i => <div key={i} className="px-2 py-2.5"><Bone className="w-12" /></div>)}
            </div>
          </div>
          {[0, 1].map(group => <div key={group}>
            <div className="flex h-9 items-center gap-2 border-b border-border bg-sunken/60 px-4">
              <Bone className="size-2" /><Bone className={group ? 'w-24' : 'w-32'} /><Bone className="ml-2 h-2 w-12" />
            </div>
            {[0, 1, 2].map(row => <div key={row} className="grid grid-cols-[minmax(10rem,28%)_1fr] border-b border-border/60">
              <div className="space-y-2 border-r border-border px-4 py-2.5"><Bone className="h-3 w-28" /><Bone className={row % 2 ? 'h-2 w-20' : 'h-2 w-32'} /></div>
              <div className="relative grid grid-cols-4 divide-x divide-dashed divide-border">
                {[0, 1, 2, 3].map(i => <span key={i} />)}
                <div className="absolute inset-y-0 flex items-center" style={{ left: `${18 + group * 14 + row * 21}%` }}><Bone className="size-2.5 rotate-45 rounded-[2px]" /></div>
              </div>
            </div>)}
          </div>)}
        </div>
      </div> : layout === 'scan-log' ? <div>
        {[0, 1, 2, 3].map(i => <div key={i} className="grid grid-cols-[16px_1fr_auto] items-center gap-x-3 gap-y-2 border-b border-border p-3">
          <Bone className="size-3" /><Bone className={i % 2 ? 'h-3 w-28' : 'h-3 w-40'} />
          <Bone className="col-start-2 row-start-2 h-3 w-4/5 max-w-md" />
          <Bone className="col-start-2 row-start-3 h-2 w-24 desktop:col-start-3 desktop:row-start-1" />
        </div>)}
      </div> : layout === 'settings' ? <div className="max-w-3xl space-y-4">
        {[0, 1].map(section => <div key={section} className="space-y-6 rounded-xl border border-border p-5">
          <Bone className="h-4 w-28" />
          {[0, 1, 2].map(row => <div key={row} className="flex items-center justify-between gap-6"><div className="w-2/3 space-y-2"><Bone className="w-1/2" /><Bone className="h-2 w-full" /></div><Bone className="h-9 w-24" /></div>)}
        </div>)}<Bone className="h-10 w-32" />
      </div> : layout === 'projects' ? <>
        <div className="mb-6 flex justify-between gap-6"><Bone className="h-9 w-64" /><Bone className="h-9 w-24" /></div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="space-y-6 rounded-xl border border-border p-5"><div className="flex gap-3"><Bone className="size-10 shrink-0" /><div className="flex-1 space-y-3"><Bone className="w-2/3" /><Bone className="h-2 w-full" /></div></div><div className="flex gap-2"><Bone className="h-5 w-24 rounded-full" /><Bone className="h-5 w-16 rounded-full" /></div><Bone className="h-2 w-1/2" /></div>)}</div>
      </> : layout === 'detail' ? <div className="space-y-7">
        <Bone className="h-7 w-2/3 max-w-md" /><div className="flex gap-2"><Bone className="h-6 w-24 rounded-full" /><Bone className="h-6 w-32 rounded-full" /></div>
        <div className="space-y-3 rounded-xl border border-border p-5"><Bone className="w-32" /><Bone className="w-full" /><Bone className="w-4/5" /></div>
        <Bone className="h-5 w-40" /><div className="space-y-3"><Bone /><Bone className="w-5/6" /><Bone className="w-2/3" /></div>
      </div> : layout === 'feed' ? <div className="mx-auto max-w-[752px] space-y-8">
        <Bone className="w-20" />{[0, 1, 2, 3].map(i => <div key={i} className="space-y-3"><div className="flex justify-between gap-8"><Bone className={i % 2 ? 'h-4 w-3/5' : 'h-4 w-4/5'} /><Bone className="w-6" /></div><div className="flex gap-2"><Bone className="h-5 w-20 rounded-full" /><Bone className="h-5 w-28 rounded-full" /><Bone className="h-5 w-16 rounded-full" /></div></div>)}
      </div> : <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex gap-6 border-b border-border bg-sunken p-3"><Bone className="w-1/3" /><Bone className="w-1/4" /></div>
        {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="flex items-center gap-5 border-b border-border/60 p-4 last:border-0"><Bone className="size-5 shrink-0 rounded-full" /><div className="flex-1 space-y-2"><Bone className={i % 2 ? 'w-1/2' : 'w-2/3'} /><Bone className="h-2 w-1/3" /></div><Bone className="h-5 w-16 rounded-full" /></div>)}
      </div>}
    </div>
  </div>;
}
