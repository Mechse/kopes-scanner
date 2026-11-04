import type { ComponentProps } from 'react';
import { Checkbox as Check, Select as Menu } from 'radix-ui';
import { IconCheck, IconChevronDown } from '@tabler/icons-react';

export function Checkbox(props: ComponentProps<typeof Check.Root>) {
  return <Check.Root className="grid size-4 place-items-center rounded border border-border bg-raised text-foreground data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" {...props}>
    <Check.Indicator><IconCheck size={13} /></Check.Indicator>
  </Check.Root>;
}

export function Select({ label, value, options, display, onValueChange }: {
  label: string; value: string; options: string[]; display: (value: string) => string;
  onValueChange: (value: string) => void;
}) {
  return <Menu.Root value={value} onValueChange={onValueChange}>
    <Menu.Trigger className="flex items-center justify-between gap-3 rounded border border-border bg-raised px-2 py-[5px] text-foreground" aria-label={label}>
      <Menu.Value /><Menu.Icon><IconChevronDown size={14} /></Menu.Icon>
    </Menu.Trigger>
    <Menu.Portal><Menu.Content position="popper" sideOffset={4} className="z-30 min-w-(--radix-select-trigger-width) rounded border border-border bg-raised p-[3px] text-foreground">
      <Menu.Viewport>{options.map(option => <Menu.Item key={option} value={option} className="flex items-center justify-between gap-3 px-2 py-[5px] data-highlighted:bg-brand-tint data-highlighted:outline-none">
        <Menu.ItemText>{display(option)}</Menu.ItemText>
        <Menu.ItemIndicator><IconCheck size={14} /></Menu.ItemIndicator>
      </Menu.Item>)}</Menu.Viewport>
    </Menu.Content></Menu.Portal>
  </Menu.Root>;
}
