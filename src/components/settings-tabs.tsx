import type { ReactNode } from 'react';
import { Tabs, TabsContent } from './ui/tabs';

// Section switching lives in the sidebar (see settings-nav); this only shows the active panel.
export function SettingsTabs({ value, children }: { value: string; children: ReactNode }) {
  return <Tabs value={value}>{children}</Tabs>;
}

// Keep forms mounted so switching tabs preserves unsaved input.
export function SettingsPanel({ value, children }: { value: string; children: ReactNode }) {
  return <TabsContent value={value} forceMount className="pt-0 data-[state=inactive]:hidden">{children}</TabsContent>;
}
