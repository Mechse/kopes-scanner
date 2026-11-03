import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
const buttonVariants = cva('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand-ink)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 shrink-0', {
  variants: { variant: { default: 'bg-[var(--brand)] text-[var(--on-brand)] hover:bg-[var(--brand-hover)]', outline: 'border border-[var(--border)] bg-[var(--surface-raised)] hover:bg-[var(--surface-sunken)]', ghost: 'hover:bg-[var(--surface-sunken)]' }, size: { default: 'h-10 px-4 py-2', sm: 'h-8 px-3 text-xs', icon: 'size-10' } },
  defaultVariants: { variant: 'default', size: 'default' },
});
export function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
