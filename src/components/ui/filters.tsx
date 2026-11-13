import type { ComponentProps, ReactNode } from 'react';
import { Checkbox as CheckboxPrimitive, Select as Menu } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';

export function Checkbox(props: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return <CheckboxPrimitive.Root className="grid size-4 place-items-center rounded border border-border bg-raised text-foreground data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" {...props}>
    <CheckboxPrimitive.Indicator><Check size={13} /></CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>;
}

export function Select({ label, value, options, display, onValueChange }: {
  label: string; value: string; options: string[]; display: (value: string) => ReactNode;
  onValueChange: (value: string) => void;
}) {
  return <Menu.Root value={value} onValueChange={onValueChange}>
    <Menu.Trigger data-toolbar-control className="flex items-center justify-between gap-3 rounded border border-border bg-raised px-2 py-[5px] text-foreground" aria-label={label}>
      <Menu.Value /><Menu.Icon><ChevronDown size={14} /></Menu.Icon>
    </Menu.Trigger>
    <Menu.Portal><Menu.Content position="popper" sideOffset={4} className="dropdown-content min-w-(--radix-select-trigger-width)">
      <Menu.Viewport>{options.map(option => <Menu.Item key={option} value={option} className="dropdown-item justify-between">
        <Menu.ItemText>{display(option)}</Menu.ItemText>
        <Menu.ItemIndicator><Check size={14} /></Menu.ItemIndicator>
      </Menu.Item>)}</Menu.Viewport>
    </Menu.Content></Menu.Portal>
  </Menu.Root>;
}
