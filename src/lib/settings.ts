import { z } from 'zod';
import type { Container } from './model';

export const scanSettingsSchema = z.object({
  rescanHours: z.union([z.literal(0), z.literal(24), z.literal(168), z.literal(720)]),
  notifyNewCve: z.boolean(),
  notifyFix: z.boolean(),
}).strict();
export const overridesSchema = scanSettingsSchema.partial();
export type ScanSettings = z.infer<typeof scanSettingsSchema>;
export const defaultSettings: ScanSettings = { rescanHours: 168, notifyNewCve: true, notifyFix: true };
export const cadenceLabels: Record<number, string> = { 0: 'Manual only', 24: 'Daily', 168: 'Weekly', 720: 'Monthly (every 30 days)' };
// Container names survive recreation and image upgrades; image IDs and container IDs do not.
export const resourceKey = (container?: Pick<Container, 'project' | 'name'>) => container ? JSON.stringify([container.project, container.name]) : 'host';
export type SettingsData = { project: string | null; defaults: ScanSettings; overrides: Partial<ScanSettings>; effective: ScanSettings };
