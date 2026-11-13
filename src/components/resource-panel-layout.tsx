import type { ReactNode } from 'react';

export function ResourcePanelHeader({ icon, name, badges }: { icon: ReactNode; name: string; badges: ReactNode }) {
  return <header className="flex flex-wrap items-start justify-between gap-4">
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground">{icon}</div>
      <div className="min-w-0 flex-1">
        <h2 className="mb-3 text-2xl font-medium leading-tight tracking-tight wrap-anywhere">{name}</h2>
        <div className="flex flex-wrap items-center gap-2">{badges}</div>
      </div>
    </div>
  </header>;
}

export function ScanPanelSummary({ status, label = status, description, actions }: {
  status: string; label?: string; description: ReactNode; actions: ReactNode;
}) {
  return <div className="mt-3.5 mb-5 flex flex-col items-start justify-between gap-2 min-[1200px]:mt-0 desktop:flex-row desktop:gap-5 [&_p]:text-xs [&>div:first-child]:min-w-0">
    <div>
      <span data-status={status} className="inline-flex items-center gap-[5px] rounded border border-border px-[7px] py-[3px] text-[11px] text-muted-foreground capitalize before:size-1.5 before:rounded-full before:bg-current data-[status=error]:text-critical data-[status=ready]:border-transparent data-[status=ready]:bg-brand-tint data-[status=ready]:text-brand-ink">{label}</span>
      <p className="text-muted-foreground wrap-anywhere">{description}</p>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-1">{actions}</div>
  </div>;
}
