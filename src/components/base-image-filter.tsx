import { Select } from './ui/filters';

export function BaseImageFilter({ value, options, onChange }: {
  value?: string; options: { value: string; label: string }[]; onChange: (value?: string) => void;
}) {
  const available = value && !options.some(option => option.value === value)
    ? [...options, { value, label: `${value} (unavailable in current scans)` }] : options;
  return <div className="space-y-2">
    <p className="text-sm font-medium">Base image</p>
    <Select label="Base image" value={value ?? 'all'} options={['all', ...available.map(option => option.value)]}
      display={key => key === 'all' ? 'All base images' : <span className="inline-block max-w-[min(24rem,60vw)] break-all text-left">{available.find(option => option.value === key)?.label ?? key}</span>}
      onValueChange={key => onChange(key === 'all' ? undefined : key)}/>
    <p className="text-xs text-muted-foreground">Select an exact base image version to show only findings attributed to it. Versions are matched by digest.</p>
    {!options.length && <p className="text-xs text-muted-foreground">No verified base-image findings are available in the current scans. Images need base-image metadata and verified layer evidence.</p>}
  </div>;
}
