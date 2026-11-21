import { useState, type ComponentProps } from 'react';
import { Button } from './ui/button';

export function SettingsInput(props: ComponentProps<'input'>) {
  return <input className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" {...props} />;
}

export function SectionHeading({ title, status }: { title: string; status: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="m-0! text-base font-medium">{title}</h2><span className="text-xs text-muted-foreground">{status}</span></div>;
}

export function CallbackRow({ label, url }: { label: string; url: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  return <>
    <p className="mt-3 text-xs text-muted-foreground">{label}</p>
    <div className="mt-1 flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all text-xs">{url}</code>
      <Button type="button" variant="outline" aria-label={`Copy ${label}`} onClick={async () => {
        try { await navigator.clipboard.writeText(url); setState('copied'); }
        catch { setState('error'); }
      }}>{state === 'copied' ? 'Copied' : 'Copy'}</Button>
    </div>
    {state === 'error' && <p role="status" className="mt-2 text-xs">Select and copy the callback URL above.</p>}
  </>;
}
