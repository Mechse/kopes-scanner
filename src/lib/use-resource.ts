import { useEffect, useState } from 'react';

export async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/data/${path}`, { signal, cache: 'no-store' });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Your session is no longer authorized. Sign out and sign in again.'
        : 'Unable to load scan data. Check the server and try again.',
    );
  return response.json();
}
export function useResource<T>(path: string, revision: number, interval = 0) {
  const [state, setState] = useState<{ path: string; data?: T; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const data = await api<T>(path, controller.signal);
        if (!controller.signal.aborted) setState({ path, data });
      } catch (error) {
        if (!controller.signal.aborted)
          setState((old) => ({
            path,
            data: old?.path === path ? old.data : undefined,
            error: (error as Error).message,
          }));
      } finally {
        if (interval && !controller.signal.aborted) timer = setTimeout(load, interval);
      }
    }
    if (path) void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, revision, interval]);
  return state?.path === path ? state : undefined;
}
