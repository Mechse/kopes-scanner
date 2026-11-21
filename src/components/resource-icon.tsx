import { SelectItem } from './ui/select';
import { SelectField } from './ui/select-field';
import { createElement, useSyncExternalStore } from 'react';
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

function useIcon(container?: Container) {
  const key = 'kopes.resource-icon:' + JSON.stringify(container ? [container.project, container.name] : ['host']);
  const override = useSyncExternalStore(subscribe, () => localStorage.getItem(key), () => null);
  const automatic = guessType(container);
  const selected = override && Object.hasOwn(icons, override) ? override as ResourceType : null;
  return { key, automatic, selected, type: selected ?? automatic };
}

export function ResourceIcon({ container }: { container?: Container }) {
  const Icon = icons[useIcon(container).type];
  return <Icon aria-hidden="true" />;
}

export function ResourceIconField({ id, container, className }: { id: string; container?: Container; className?: string }) {
  const { key, automatic, selected } = useIcon(container);
  return <SelectField id={id} className={className} value={selected ?? 'automatic'} onValueChange={value => {
    if (value === 'automatic') localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    window.dispatchEvent(new Event('resource-icon-change'));
  }}>
    <SelectItem value="automatic">{createElement(icons[automatic], { 'aria-hidden': true })}Automatic ({automatic})</SelectItem>
    {Object.entries(icons).map(([option, Icon]) => <SelectItem key={option} value={option}><Icon aria-hidden="true" />{option}</SelectItem>)}
  </SelectField>;
}
