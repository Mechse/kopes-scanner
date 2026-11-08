import type { ReactElement } from 'react';
import { Tooltip as Primitive } from 'radix-ui';

export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  return <Primitive.Provider delayDuration={200}>
    <Primitive.Root>
      <Primitive.Trigger asChild>{children}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content sideOffset={6} className="z-50 rounded-md border border-border bg-raised px-2.5 py-1.5 text-xs text-foreground shadow-md">
          {label}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  </Primitive.Provider>;
}
