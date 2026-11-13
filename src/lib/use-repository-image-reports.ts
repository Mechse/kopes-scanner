import { useEffect, useState } from 'react';
import { relatedContainers } from './coverage-explanation';
import { api } from './use-resource';
import type { Dashboard, Report, Target } from './model';

export function useRepositoryImageReports(repository: string | undefined, inventory: Dashboard | undefined) {
  const targets = repository && inventory ? [...new Map(relatedContainers(repository, inventory)
    .flatMap(({ target }) => target?.kind === 'image' && target.scanned_at ? [[target.id, target] as const] : [])).values()] : [];
  const key = JSON.stringify([repository, targets.map(target => [target.id, target.scanned_at])]);
  const [state, setState] = useState<{ key: string; reports: { target: Target; report: Report }[]; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled(targets.map(async target => ({ target, report: await api<Report>(`report?id=${encodeURIComponent(target.id)}&scan=${target.scanned_at}`, controller.signal) })))
      .then(results => {
        if (controller.signal.aborted) return;
        setState({ key, reports: results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []),
          error: results.some(result => result.status === 'rejected') ? 'Some linked container scans could not be loaded. Base-image results may be incomplete.' : undefined });
      });
    return () => controller.abort();
  }, [key]);
  return { reports: state?.key === key ? state.reports : [], error: state?.key === key ? state.error : undefined,
    loading: !!repository && (!inventory || state?.key !== key) };
}
