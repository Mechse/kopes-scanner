import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Plus } from 'lucide-react';
import { Button } from './ui/button';

const endpoint = '/api/data/machine-containers';
type Candidate = { id: string; name: string; image: string };

export function AddResource({ refresh, removeFromProject, untrack = false }: { refresh: () => void; removeFromProject?: string; untrack?: boolean }) {
  const remove = untrack || removeFromProject !== undefined;
  const action = remove ? 'Untrack' : 'Add';
  const title = remove ? 'Untrack container' : 'Add container';
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
        const response = await fetch(remove ? `${endpoint}?view=tracked${removeFromProject === undefined ? '' : `&projectId=${encodeURIComponent(removeFromProject)}`}` : endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error(await response.text());
        setRows(await response.json());
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not list containers.'); }
    })();
    return () => controller.abort();
  }, [open, remove, removeFromProject]);
  async function apply(id: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: remove ? 'remove' : 'add' }) });
      if (!response.ok) throw new Error(await response.text());
      setOpen(false); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : `Could not ${action.toLowerCase()} container.`); }
    finally { setBusy(false); }
  }
  return <Dialog.Root open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
    <Dialog.Trigger asChild><Button size="sm" variant={remove ? 'outline' : 'default'}>{!remove && <Plus size={14}/>}{title}</Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-black/55"/><Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-raised p-5 shadow-xl">
      <Dialog.Title>{title}</Dialog.Title><Dialog.Description className="mb-4 text-sm text-muted-foreground">{remove ? 'Stop tracking a container without changing it in Docker. Scan history is kept.' : 'Choose a running container to scan.'}</Dialog.Description>
      {error && <p role="alert">{error}</p>}
      {rows === null ? !error && <p role="status">Loading containers…</p> : !rows.length ? <p>{remove ? 'No containers are tracked.' : 'No running containers available to add.'}</p> : <ul>{rows.map(c => <li key={c.id} className="flex items-center justify-between gap-3 border-b border-border py-2"><div className="min-w-0 break-all">{c.name}<div className="text-sm text-muted-foreground">{c.image}{remove && ` · ${c.id.slice(0, 12)}`}</div></div><Button size="sm" variant="outline" disabled={busy} aria-label={`${action} ${c.name}`} onClick={() => void apply(c.id)}>{action}</Button></li>)}</ul>}
      <Dialog.Close asChild><Button variant="ghost" className="mt-4" disabled={busy}>Close</Button></Dialog.Close>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
