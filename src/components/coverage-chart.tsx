import type { CoverageArea } from '../lib/assessment-coverage';
import { Tooltip } from './ui/tooltip';

const statuses = {
  complete: { label: 'Complete', color: 'var(--brand-ink)' },
  partial: { label: 'Partial', color: 'var(--sev-medium)' },
  unavailable: { label: 'Unavailable', color: 'var(--ink-muted)' },
};

/** Equal segments represent coverage areas, never a percentage of packages assessed. */
export function CoverageChart({ areas }: { areas: CoverageArea[] }) {
  const complete = areas.filter(area => area.status === 'complete').length;
  return <div>
    <div className="mb-4 flex min-h-8 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <p className="font-medium">Assessment coverage</p>
      <Tooltip label="Number of fully assessed areas, not a percentage of packages. Hover or focus each area for details.">
        <span tabIndex={0} className="text-xs text-muted-foreground"><span className="font-medium tabular-nums text-foreground">{complete}/{areas.length}</span> complete</span>
      </Tooltip>
    </div>
    <div className="grid grid-cols-1 gap-3 @sm:grid-cols-[repeat(auto-fit,minmax(0,1fr))]">
      {areas.map(area => <Tooltip key={area.label} label={area.detail}>
        <div tabIndex={0} className="min-w-0 rounded-sm">
          <div aria-hidden="true" className="mb-3 h-2 rounded-sm" style={{ background: statuses[area.status].color }}/>
          <p className="text-xs text-muted-foreground">{area.label}</p>
          <p className="mt-1 text-sm font-medium">{area.statusLabel ?? statuses[area.status].label}</p>
        </div>
      </Tooltip>)}
    </div>
  </div>;
}
