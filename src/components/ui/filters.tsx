import type { ComponentProps } from 'react';
import { Checkbox as Check, Select as Menu } from 'radix-ui';
import { IconCheck, IconChevronDown } from '@tabler/icons-react';

export function Checkbox(props: ComponentProps<typeof Check.Root>) {
  return <Check.Root className="check-control" {...props}>
    <Check.Indicator><IconCheck size={13} /></Check.Indicator>
  </Check.Root>;
}

export function Select({ label, value, options, display, onValueChange }: {
  label: string; value: string; options: string[]; display: (value: string) => string;
  onValueChange: (value: string) => void;
}) {
  return <Menu.Root value={value} onValueChange={onValueChange}>
    <Menu.Trigger className="select-control" aria-label={label}>
      <Menu.Value /><Menu.Icon><IconChevronDown size={14} /></Menu.Icon>
    </Menu.Trigger>
    <Menu.Portal><Menu.Content position="popper" sideOffset={4} className="select-popup">
      <Menu.Viewport>{options.map(option => <Menu.Item key={option} value={option} className="select-option">
        <Menu.ItemText>{display(option)}</Menu.ItemText>
        <Menu.ItemIndicator><IconCheck size={14} /></Menu.ItemIndicator>
      </Menu.Item>)}</Menu.Viewport>
    </Menu.Content></Menu.Portal>
  </Menu.Root>;
}
