import type { Finding } from '../lib/model';
import { originOf } from '../lib/finding-origin';
import { pillClass } from './ui/pill';
import { Tooltip } from './ui/tooltip';

export function OriginBadge({ finding }: { finding: Finding }) {
  const origin = originOf(finding);
  return <Tooltip label={origin.explanation}>
    <span tabIndex={0} aria-label={`Origin: ${origin.category}`}
      className={`${pillClass} relative z-10 focus-visible:outline-2 focus-visible:outline-brand-ink`}>
      {origin.category}
    </span>
  </Tooltip>;
}
