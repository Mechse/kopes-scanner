import type { Severity } from '../lib/model';

export const severityColors: Record<Severity, string> = {
  CRITICAL: 'text-critical',
  HIGH: 'text-high',
  MEDIUM: 'text-medium',
  LOW: 'text-low',
  UNKNOWN: 'text-info',
};
