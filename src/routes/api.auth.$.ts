import { createFileRoute } from '@tanstack/react-router';
import { configuredProviders } from '../server/config';
import { runtime } from '../server/runtime';
const handle = async ({ request }: { request: Request }) => {
  const { auth, config } = await runtime();
  if (request.method === 'GET' && new URL(request.url).pathname === '/api/auth/providers') {
    return Response.json({ providers: configuredProviders(config), origin: config.origin }, { headers: { 'Cache-Control': 'no-store' } });
  }
  return auth.handler(request);
};
export const Route = createFileRoute('/api/auth/$')({ server: { handlers: { GET: handle, POST: handle } } });
