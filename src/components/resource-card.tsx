import type { ReactNode } from 'react';
import { FavouriteButton } from './favourites';

export const resourceCardActionClass = 'relative z-10 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-sunken hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand-ink';

// Shared card for containers and repositories: icon + title, divider, vulnerability count + actions.
export function ResourceCard({ view, icon, title, subtitle, vulnerabilities, favourite, settings }: {
  view: 'grid' | 'line'; icon: ReactNode; title: ReactNode; subtitle?: ReactNode; vulnerabilities?: number;
  favourite: { name: string; active: boolean; disabled: boolean; onClick: () => void }; settings?: ReactNode;
}) {
  const grid = view === 'grid';
  return <article className={`group relative isolate flex min-w-0 ${grid ? 'flex-col rounded-xl border border-border bg-raised hover:border-brand-ink' : 'items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0 hover:bg-sunken/50'}`}>
    <div className={`flex min-w-0 flex-1 items-center gap-3 ${grid ? 'p-4' : ''}`}>
      <span className={`grid shrink-0 place-items-center text-muted-foreground ${grid ? 'size-10 rounded-lg border border-border bg-background' : 'size-8'}`}>{icon}</span>
      <div className="min-w-0 flex-1 text-sm font-medium">{title}{subtitle && <span className="block truncate text-xs font-normal text-muted-foreground">{subtitle}</span>}</div>
    </div>
    <div className={`flex items-center gap-1 text-sm ${grid ? 'mx-4 border-t border-border py-2.5' : 'shrink-0'}`}>
      <span className="mr-auto pr-2 text-muted-foreground">{vulnerabilities === undefined ? 'Not scanned yet' : <><strong className="font-medium text-foreground">{vulnerabilities}</strong> {vulnerabilities === 1 ? 'vulnerability' : 'vulnerabilities'}</>}</span>
      <FavouriteButton {...favourite}/>
      {settings}
    </div>
  </article>;
}
