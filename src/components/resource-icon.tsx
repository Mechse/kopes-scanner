import { useSyncExternalStore } from 'react';
import { Box, Database, Globe, HardDrive, Layers, ListTree, Network, Radar, Server } from 'lucide-react';
import type { Container } from '../lib/model';

const icons = {
  Application: Box, Database, Cache: Layers, Storage: HardDrive,
  Proxy: Network, Web: Globe, Queue: ListTree, Scanner: Radar, Server,
};
type ResourceType = keyof typeof icons;

const rules: [ResourceType, RegExp][] = [
  ['Proxy', /\b(proxy|gateway|traefik|haproxy|envoy)\b/],
  ['Database', /\b(postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|clickhouse|timescaledb|couchdb|db)\b/],
  ['Cache', /\b(redis|valkey|memcached)\b/],
  ['Storage', /\b(garage|minio|seaweedfs)\b/],
  ['Queue', /\b(rabbitmq|kafka|nats)\b/],
  ['Web', /\b(nginx|caddy|httpd|web|frontend)\b/],
  ['Scanner', /\b(scanner|trivy|grype)\b/],
];

function guessType(container?: Container): ResourceType {
  if (!container) return 'Server';
  const image = container.image.split('@')[0].split('/').pop()?.split(':')[0] ?? '';
  for (const source of [image, container.service, container.name]) {
    const name = source.toLowerCase().replaceAll('_', '-');
    const match = rules.find(([, pattern]) => pattern.test(name));
    if (match) return match[0];
  }
  return 'Application';
}

function subscribe(update: () => void) {
  window.addEventListener('storage', update);
  window.addEventListener('resource-icon-change', update);
  return () => {
    window.removeEventListener('storage', update);
    window.removeEventListener('resource-icon-change', update);
  };
}

export function ResourceIcon({ container }: { container?: Container }) {
  const key = 'kopes.resource-icon:' + JSON.stringify(container ? [container.project, container.name] : ['host']);
  const override = useSyncExternalStore(subscribe, () => localStorage.getItem(key), () => null);
  const automatic = guessType(container);
  const selected = override && Object.hasOwn(icons, override) ? override as ResourceType : null;
  const type = selected ?? automatic;
  const Icon = icons[type];
  const label = `Change icon for ${container?.name ?? 'Host OS packages'} (currently ${type})`;
  return <label className="relative z-10 grid size-8 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-sunken hover:text-foreground focus-within:ring-2 focus-within:ring-brand-ink" title={label}>
    <Icon size={17} aria-hidden="true" />
    <select aria-label={label} className="absolute inset-0 size-full cursor-pointer opacity-0" value={selected ?? ''} onChange={event => {
      const value = event.target.value;
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
      window.dispatchEvent(new Event('resource-icon-change'));
    }}>
      <option value="">Automatic ({automatic})</option>
      {Object.keys(icons).map(option => <option key={option}>{option}</option>)}
    </select>
  </label>;
}
