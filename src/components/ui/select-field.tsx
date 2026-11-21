import type { ComponentProps, ReactNode } from 'react';
import { Select, SelectContent, SelectTrigger, SelectValue } from './select';

type SelectFieldProps = ComponentProps<typeof Select> &
  Pick<ComponentProps<typeof SelectTrigger>, 'id' | 'aria-label' | 'aria-describedby' | 'className'> & {
    placeholder?: ReactNode;
  };

export function SelectField({ id, 'aria-label': label, 'aria-describedby': description, className, placeholder, children, ...props }: SelectFieldProps) {
  return <Select {...props}>
    <SelectTrigger id={id} aria-label={label} aria-describedby={description} className={className}>
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent>{children}</SelectContent>
  </Select>;
}
