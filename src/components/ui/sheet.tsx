import { Dialog } from 'radix-ui';
import { useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;

export function SheetContent({ title, children, side = 'left' }: { title: string; children: ReactNode; side?: 'left' | 'right' | 'bottom' }) {
  const dragStart = useRef<number | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  return <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55" />
    <Dialog.Content className="app-sheet fixed inset-y-0 left-0 z-[41] w-[min(264px,85vw)] bg-background data-[side=right]:right-0 data-[side=right]:left-auto data-[side=right]:w-[min(460px,100vw)] data-[side=right]:overflow-y-auto data-[side=right]:border-l data-[side=right]:border-border" data-side={side} aria-describedby={undefined}>
      <div className="sheet-handle" aria-hidden="true"
        onPointerDown={event => { dragStart.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerUp={event => { if (dragStart.current !== null && event.clientY - dragStart.current > 40) close.current?.click(); dragStart.current = null; }}
        onPointerCancel={() => { dragStart.current = null; }}
      ><span /></div>
      <Dialog.Title className="sr-only">{title}</Dialog.Title>
      <Dialog.Close asChild><Button ref={close} className="absolute top-2.5 right-2 z-1 mobile:size-11" variant="ghost" size="icon" aria-label="Close"><X /></Button></Dialog.Close>
      {children}
    </Dialog.Content>
  </Dialog.Portal>;
}
