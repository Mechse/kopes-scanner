import { z } from 'zod';
import type { Container } from './model';

export const scanSettingsSchema = z.object({
  rescanHours: z.union([
    z.literal(0), z.literal(5 / 60), z.literal(15 / 60), z.literal(30 / 60),
    z.literal(1), z.literal(6), z.literal(12), z.literal(24), z.literal(72),
    z.literal(168), z.literal(336), z.literal(720),
  ]),
  notifyNewCve: z.boolean(),
  notifyFix: z.boolean(),
}).strict();
export const overridesSchema = scanSettingsSchema.partial();
export type ScanSettings = z.infer<typeof scanSettingsSchema>;
export const defaultSettings: ScanSettings = { rescanHours: 168, notifyNewCve: true, notifyFix: true };
export const cadenceLabels: Record<number, string> = {
  0: 'Manual only',
  [5 / 60]: 'Every 5 minutes',
  [15 / 60]: 'Every 15 minutes',
  [30 / 60]: 'Every 30 minutes',
  1: 'Hourly',
  6: 'Every 6 hours',
  12: 'Every 12 hours',
  24: 'Daily',
  72: 'Every 3 days',
  168: 'Weekly',
  336: 'Every 2 weeks',
  720: 'Monthly (every 30 days)',
};
// Container names survive recreation and image upgrades; image IDs and container IDs do not.
export const resourceKey = (container?: Pick<Container, 'project' | 'name'>) => container ? JSON.stringify([container.project, container.name]) : 'host';
export const displayNameSchema = z.string().trim().max(120);
export const projectSettingsSchema = scanSettingsSchema.extend({ displayName: displayNameSchema.optional() });
export const resourceSettingsSchema = overridesSchema.extend({ displayName: displayNameSchema.optional() });
export type SettingsData = { displayName: string; project: string | null; defaults: ScanSettings; overrides: Partial<ScanSettings>; effective: ScanSettings };
