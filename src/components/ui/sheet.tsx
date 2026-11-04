import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { IconX } from '@tabler/icons-react';
import { Button } from './button';

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;

export function SheetContent({ title, children, side = 'left' }: { title: string; children: ReactNode; side?: 'left' | 'right' }) {
  return <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55" />
    <Dialog.Content className="fixed inset-y-0 left-0 z-[41] w-[min(264px,85vw)] bg-background data-[side=right]:right-0 data-[side=right]:left-auto data-[side=right]:w-[min(460px,100vw)] data-[side=right]:overflow-y-auto data-[side=right]:border-l data-[side=right]:border-border" data-side={side} aria-describedby={undefined}>
      <Dialog.Title className="sr-only">{title}</Dialog.Title>
      <Dialog.Close asChild><Button className="absolute top-2.5 right-2 z-1" variant="ghost" size="icon" aria-label="Close"><IconX /></Button></Dialog.Close>
      {children}
    </Dialog.Content>
  </Dialog.Portal>;
}
