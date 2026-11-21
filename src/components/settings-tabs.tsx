import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

export function SettingsTabs({ value, onValueChange, tabs, children }: {
  value: string;
  onValueChange: (value: string) => void;
  tabs: readonly { value: string; label: string }[];
  children: ReactNode;
}) {
  return <Tabs value={value} onValueChange={onValueChange}>
    <TabsList aria-label="Settings" className="flex gap-6 overflow-x-auto">
      {tabs.map(tab => <TabsTrigger key={tab.value} value={tab.value} className="shrink-0 px-0 data-[state=active]:border-current data-[state=active]:font-medium focus-visible:-outline-offset-2">{tab.label}</TabsTrigger>)}
    </TabsList>
    {children}
  </Tabs>;
}

// Keep forms mounted so switching tabs preserves unsaved input.
export function SettingsPanel({ value, children }: { value: string; children: ReactNode }) {
  return <TabsContent value={value} forceMount className="pt-0 data-[state=inactive]:hidden">{children}</TabsContent>;
}
