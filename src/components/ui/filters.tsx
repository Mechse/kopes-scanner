import { SelectItem } from './select';
import { SelectField } from './select-field';
import type { ComponentProps, ReactNode } from 'react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { Check } from 'lucide-react';

export function Checkbox(props: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return <CheckboxPrimitive.Root className="grid size-4 place-items-center rounded border border-border bg-raised text-foreground data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" {...props}>
    <CheckboxPrimitive.Indicator><Check size={13} /></CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>;
}

export function Select({ label, value, options, display, onValueChange }: {
  label: string; value: string; options: string[]; display: (value: string) => ReactNode;
  onValueChange: (value: string) => void;
}) {
  return <SelectField aria-label={label} value={value} onValueChange={onValueChange}>
    {options.map(option => <SelectItem key={option} value={option}>{display(option)}</SelectItem>)}
  </SelectField>;
}
