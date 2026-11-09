type Resource = { uuid: string; name: string; id?: string | number };
const kinds = ['application', 'service', 'database'] as const;
export type CoolifyLookup = (labels: Record<string, string>) => string | undefined;

export function coolifyOrigin(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter a valid Coolify URL.'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Use your Coolify HTTPS address without /api/v1. HTTP is allowed only on localhost.');
  }
  return url.origin;
}

async function fetchResources(origin: string, token: string, kind: typeof kinds[number], request: typeof fetch): Promise<Resource[]> {
  let response: Response;
  try {
    response = await request(`${origin}/api/v1/${kind}s`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
  } catch { throw new Error('Could not reach Coolify. Check the URL, HTTPS certificate and network access.'); }
  if (response.status === 401 || response.status === 403) throw new Error('Coolify denied access. Check the token’s read permission, API access and IP allowlist.');
  if (!response.ok) throw new Error(`Coolify returned HTTP ${response.status}. Check API availability.`);
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error('Coolify returned an invalid API response. Check the URL.'); }
  if (!Array.isArray(data)) throw new Error('Invalid Coolify inventory.');
  return data.map(item => {
    if (!item || typeof item.uuid !== 'string' || !item.uuid || typeof item.name !== 'string' || !item.name.trim()) throw new Error('Invalid Coolify resource.');
    return { uuid: item.uuid, name: item.name.trim(), id: typeof item.id === 'number' || typeof item.id === 'string' ? item.id : undefined };
  });
}

export async function testCoolifyConnection(origin: string, token: string, request: typeof fetch = fetch) {
  const lists = await Promise.all(kinds.map(kind => fetchResources(origin, token, kind, request)));
  return { applications: lists[0].length, services: lists[1].length, databases: lists[2].length };
}

// Keep only identifiers and names, never API response bodies or credentials.
export function createCoolifyLookup(origin: string, token: string, request: typeof fetch = fetch, now = Date.now) {
  const resources = new Map<string, Resource[]>();
  let refreshAt = 0;
  let pending: Promise<void> | undefined;
  async function refresh() {
    const results = await Promise.allSettled(kinds.map(async kind => {
      resources.set(kind, await fetchResources(origin, token, kind, request));
    }));
    if (results.some(result => result.status === 'rejected')) {
      console.warn('Coolify name lookup unavailable for some resources; using cached names or Docker labels. Check the Coolify URL, API access and read permission.');
    }
    refreshAt = now() + 5 * 60_000;
  }
  return async (): Promise<CoolifyLookup> => {
    if (now() >= refreshAt) {
      pending ??= refresh().finally(() => { pending = undefined; });
      await pending;
    }
    const all = [...resources.values()].flat();
    const title = (resource: Resource) => `Coolify · ${resource.name}${all.some(other => other.uuid !== resource.uuid && other.name === resource.name) ? ` · ${resource.uuid}` : ''}`;
    return labels => {
      for (const kind of kinds) {
        const uuid = labels[`coolify.${kind}Uuid`];
        const id = labels[`coolify.${kind}Id`];
        const match = resources.get(kind)?.find(resource => uuid ? resource.uuid === uuid : id && (resource.uuid === id || (resource.id !== undefined && String(resource.id) === id)));
        if (match) return title(match);
      }
      // Exact UUID matching also covers Compose stacks with no Coolify labels.
      const compose = labels['com.docker.compose.project'];
      const match = compose && all.find(resource => resource.uuid === compose);
      return match ? title(match) : undefined;
    };
  };
}
