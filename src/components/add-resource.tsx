import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Dialog } from 'radix-ui';
import { Plus } from 'lucide-react';
import { Button } from './ui/button';

const endpoint = '/api/data/machine-containers';
export type Candidate = { id: string; name: string; image: string };
const contentClass = 'fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-raised p-5 shadow-xl';

export async function post(id: string, action: 'add' | 'remove') {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) });
  if (!response.ok) throw new Error(await response.text());
}

export function AddResource() {
  return <Button size="sm" asChild><Link to="/containers/new"><Plus size={14}/>Add container</Link></Button>;
}

export function UntrackContainer({ id, name, onDone }: { id: string; name: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function untrack() {
    setBusy(true); setError('');
    try { await post(id, 'remove'); setOpen(false); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not untrack container.'); }
    finally { setBusy(false); }
  }
  return <section className="max-w-3xl border-t border-border py-6">
    <h2 className="m-0! text-sm! font-medium">Untrack container</h2>
    <p className="mt-1 mb-3 text-xs leading-5 text-muted-foreground">Stop scanning this container without changing it in Docker. Scan history is kept.</p>
    <Dialog.Root open={open} onOpenChange={value => { if (!busy) { setOpen(value); setError(''); } }}>
      <Dialog.Trigger asChild><Button size="sm" variant="outline" className="text-critical">Untrack container</Button></Dialog.Trigger>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-black/55"/><Dialog.Content className={contentClass}>
        <Dialog.Title>Untrack {name}?</Dialog.Title><Dialog.Description className="mb-4 text-sm text-muted-foreground">It will no longer be scanned. You can add it again later.</Dialog.Description>
        {error && <p role="alert" className="mb-3 text-sm text-critical">{error}</p>}
        <div className="flex justify-end gap-2">
          <Dialog.Close asChild><Button variant="ghost" size="sm" disabled={busy}>Cancel</Button></Dialog.Close>
          <Button size="sm" busy={busy} onClick={() => void untrack()}>Untrack</Button>
        </div>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </section>;
}
