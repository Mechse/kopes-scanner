import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { IconX } from '@tabler/icons-react';
import { Button } from './button';

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;

export function SheetContent({ title, children }: { title: string; children: ReactNode }) {
  return <Dialog.Portal>
    <Dialog.Overlay className="sheet-overlay" />
    <Dialog.Content className="sheet-content" aria-describedby={undefined}>
      <Dialog.Title className="sr-only">{title}</Dialog.Title>
      <Dialog.Close asChild><Button className="sheet-close" variant="ghost" size="icon" aria-label="Close menu"><IconX /></Button></Dialog.Close>
      {children}
    </Dialog.Content>
  </Dialog.Portal>;
}
