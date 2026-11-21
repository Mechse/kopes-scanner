import { useState } from 'react';
import { useResource } from '../lib/use-resource';
import { SectionHeading, SettingsInput } from './settings-fields';
import { Button } from './ui/button';

export function TelegramSettings() {
  const loaded = useResource<{ chat: string }>('telegram-settings', 0);
  const [saved, setSaved] = useState<string>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const chat = saved ?? loaded?.data?.chat;
  if (chat === undefined) return <p role="status" className="py-6">{loaded?.error ?? 'Loading Telegram settings…'}</p>;
  async function submit(body: Record<string, unknown>, form?: HTMLFormElement) {
    setBusy(true); setMessage('');
    try {
      const res = await fetch('/api/data/telegram-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setMessage(data.error ?? 'Could not update Telegram.'); return; }
      setSaved(data.chat); form?.reset(); setMessage(data.chat ? 'Test message sent. Telegram is connected.' : 'Telegram disconnected.');
    } catch { setMessage('Could not reach the server. Try again.'); }
    finally { setBusy(false); }
  }
  return <section className="max-w-xl space-y-4 py-6">
    <SectionHeading title="Telegram" status={chat ? `Connected to ${chat}` : 'Not connected'} />
    <p className="text-sm text-muted-foreground">Send new CVEs from workspace repository and container scans to one chat. Everyone in that chat can see resource names and CVE IDs. Containers follow their Pulse settings.</p>
    <p className="text-sm">Create a bot with @BotFather, then start a chat with it or add it to your group before testing.</p>
    <form key={chat} onSubmit={e => { e.preventDefault(); const form = e.currentTarget; void submit({ ...Object.fromEntries(new FormData(form)), action: 'connect' }, form); }}>
      <fieldset disabled={busy} className="grid gap-4">
        <label>Bot token<SettingsInput name="token" type="password" autoComplete="new-password" required /></label>
        <label>Numeric chat ID<SettingsInput name="chat" defaultValue={chat} required /></label>
        <div className="flex gap-2"><Button type="submit">Test and save</Button>{chat && <Button type="button" variant="outline" onClick={() => void submit({ action: 'disconnect' })}>Disconnect</Button>}</div>
      </fieldset>
    </form>
    <p role="status" className="text-sm">{message}</p>
  </section>;
}
