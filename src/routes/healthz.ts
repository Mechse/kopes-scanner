import { createFileRoute } from '@tanstack/react-router';
import { runtime } from '../server/runtime';
export const Route = createFileRoute('/healthz')({ server: { handlers: { GET: async () => {
  const { store, signal } = await runtime();
  store.db.prepare('SELECT 1').get();
  return new Response(signal.aborted ? 'stopped' : 'ok', { status: signal.aborted ? 503 : 200 });
} } } });
