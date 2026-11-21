import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Plus } from 'lucide-react';
import { Button } from './ui/button';

const endpoint = '/api/data/machine-containers';
type Candidate = { id: string; name: string; image: string };
const contentClass = 'fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-raised p-5 shadow-xl';

async function post(id: string, action: 'add' | 'remove') {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) });
  if (!response.ok) throw new Error(await response.text());
}

export function AddResource({ refresh }: { refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setRows(null); setError('');
    void (async () => {
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error(await response.text());
        setRows(await response.json());
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not list containers.'); }
    })();
    return () => controller.abort();
  }, [open]);
  async function apply(id: string) {
    setBusy(true); setError('');
    try { await post(id, 'add'); setOpen(false); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not add container.'); }
    finally { setBusy(false); }
  }
  return <Dialog.Root open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
    <Dialog.Trigger asChild><Button size="sm"><Plus size={14}/>Add container</Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-black/55"/><Dialog.Content className={contentClass}>
      <Dialog.Title>Add container</Dialog.Title><Dialog.Description className="mb-4 text-sm text-muted-foreground">Choose a running container to scan.</Dialog.Description>
      {error && <p role="alert">{error}</p>}
      {rows === null ? !error && <p role="status">Loading containers…</p> : !rows.length ? <p>No running containers available to add.</p> : <ul>{rows.map(c => <li key={c.id} className="flex items-center justify-between gap-3 border-b border-border py-2"><div className="min-w-0 break-all">{c.name}<div className="text-sm text-muted-foreground">{c.image}</div></div><Button size="sm" variant="outline" disabled={busy} aria-label={`Add ${c.name}`} onClick={() => void apply(c.id)}>Add</Button></li>)}</ul>}
      <Dialog.Close asChild><Button variant="ghost" className="mt-4" disabled={busy}>Close</Button></Dialog.Close>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
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
