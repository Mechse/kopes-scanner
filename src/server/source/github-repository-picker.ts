import { z } from 'zod';
import type { Store } from '../store';
import type { RepositoryChoice, RepositoryPickerData } from '../../lib/repository-picker';

const search = z.object({
  q: z.string().trim().max(300).default(''),
  connectionId: z.string().max(200).default(''),
  visibility: z.enum(['all', 'public', 'private']).default('all'),
  page: z.coerce.number().int().min(1).max(200).default(1),
});

/** Search the reconciled inventory, not just the displayed page. No provider calls or credentials. */
export function githubRepositoryPicker(store: Store, url: URL): RepositoryPickerData | null {
  const parsed = search.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return null;
  const { q, connectionId, visibility, page: requestedPage } = parsed.data;
  const query = `WITH accessible AS (
    SELECT r.repository_id,r.name,r.private,c.id AS connection_id,c.label AS connection_label,i.owner_login,
      ROW_NUMBER() OVER (PARTITION BY r.repository_id ORDER BY c.label COLLATE NOCASE,c.id) AS position
    FROM github_installation_repositories r
    JOIN github_installations i ON i.id=r.installation_id
    JOIN github_apps a ON a.id=i.app_id
    JOIN source_connections c ON c.installation_id=i.id
    WHERE c.provider='github' AND c.auth_kind='github_app' AND c.disconnected=0
      AND i.status='active' AND a.status='connected' AND r.status='active'
      AND (?='' OR c.id=?) AND instr(lower(r.name),lower(?))>0
      AND (?='all' OR r.private=?)
  )`;
  const params = [connectionId, connectionId, q, visibility, Number(visibility === 'private')];
  const total = Number(store.db.prepare(`${query} SELECT COUNT(*) AS count FROM accessible WHERE position=1`).get(...params)!.count);
  const pageSize = 50, page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const repositories = store.db.prepare(`${query}
    SELECT repository_id,name,private,connection_id,connection_label,owner_login,
      (SELECT b.id FROM source_bindings b JOIN source_repositories sr ON sr.id=b.repository_id
        WHERE sr.provider='github' AND sr.origin='https://api.github.com'
          AND sr.provider_id=accessible.repository_id AND b.enabled=1
        ORDER BY b.id LIMIT 1) AS binding_id
    FROM accessible WHERE position=1 ORDER BY name COLLATE NOCASE,repository_id LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize) as unknown as RepositoryChoice[];
  return { repositories, total, page, pageSize, hasMore: page * pageSize < total };
}
