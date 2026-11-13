import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { api } from '../lib/use-resource';
import { favouriteId, type Favourite } from '../lib/favourites';

export function useFavourites() {
  const [items, setItems] = useState<Favourite[]>([]);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const version = useRef(0);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      if (busy.current) return;
      const loadedVersion = version.current;
      try {
        const result = await api<Favourite[]>('favourites', controller.signal);
        if (!controller.signal.aborted && !busy.current && loadedVersion === version.current) {
          setItems(result);
          setReady(true);
          setError(undefined);
        }
      } catch {
        if (!controller.signal.aborted) setError('Unable to load favourites. Refresh to try again.');
      }
    }
    void load();
    window.addEventListener('focus', load);
    return () => { controller.abort(); window.removeEventListener('focus', load); };
  }, []);
  const has = (item: Favourite) => items.some(value => favouriteId(value) === favouriteId(item));
  async function toggle(item: Favourite) {
    if (busy.current || !ready) return;
    busy.current = true;
    version.current += 1;
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch('/api/data/favourites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, favourite: !has(item) }),
      });
      if (!response.ok) throw new Error();
      setItems(await response.json());
    } catch {
      setError('Unable to save your favourite. Please try again.');
    } finally { busy.current = false; setPending(false); }
  }
  return { has, toggle, disabled: !ready || pending, error };
}

export function FavouriteButton({ name, active, disabled, onClick }: {
  name: string; active: boolean; disabled: boolean; onClick: () => void;
}) {
  const label = `${active ? 'Remove' : 'Add'} ${name} ${active ? 'from' : 'to'} favourites`;
  return <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled}
    onClick={onClick}
    className="relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-brand-tint hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-brand-ink disabled:opacity-50 aria-pressed:text-brand-ink">
    <Star size={17} fill={active ? 'currentColor' : 'none'} aria-hidden="true" />
  </button>;
}
