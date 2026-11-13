import { useState } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { Package } from '../lib/model';
import { Button } from './ui/button';
import { LoadingStatus } from './ui/loading';

const pageSize = 50;

/** The same inventory table and paging controls for container and repository scans. */
export function PackageInventoryPanel({ packages, loading = false, error }: {
  packages?: Package[]; loading?: boolean; error?: string;
}) {
  const [query, setQuery] = useState('');
  const [requestedPage, setPage] = useState(0);
  const filtered = packages?.filter(p => `${p.name} ${p.version}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  return <>
    <h2>Package inventory</h2>
    <input type="search" aria-label="Search packages" placeholder="Search packages…"
      className="my-3 w-full rounded border border-border px-2 py-1" value={query}
      onChange={e => { setQuery(e.target.value); setPage(0); }}/>
    {error && <p role="alert" className="my-4 text-sm text-critical">{error}</p>}
    {packages ? <>
      <div className="overflow-x-auto rounded-sm border border-border mobile:[&_table]:min-w-[460px]">
        <table>
          <caption className="sr-only">Detected packages</caption>
          <thead><tr><th>Package</th><th>Version</th><th>Ecosystem</th></tr></thead>
          <tbody>{filtered.slice(page * pageSize, (page + 1) * pageSize).map((p, i) => <tr key={`${p.name}:${p.path}:${page * pageSize + i}`}>
            <td className="font-mono tabular-nums" title={p.path || undefined}>{p.name}</td>
            <td><code>{p.version}</code></td><td>{p.type}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {!filtered.length && <p role="status" className="py-4 text-sm text-muted-foreground">{packages.length ? 'No packages match your search.' : 'No packages detected in this scan.'}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-4 text-xs text-muted-foreground">
        <span role="status">{filtered.length ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filtered.length)} of ${filtered.length}` : packages.length ? 'No packages match' : '0 packages'}</span>
        <div>
          <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronsLeft aria-hidden="true"/>Previous</Button>
          <Button variant="ghost" size="sm" disabled={(page + 1) * pageSize >= filtered.length} onClick={() => setPage(page + 1)}>Next<ChevronsRight aria-hidden="true"/></Button>
        </div>
      </div>
    </> : loading ? <LoadingStatus label="Loading package inventory…" className="py-12"/> : !error && <p className="max-w-[580px] px-4 py-12 text-left text-muted-foreground">Package inventory is available after the first successful scan.</p>}
  </>;
}
