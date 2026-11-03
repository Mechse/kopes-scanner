import handler, { createServerEntry } from '@tanstack/react-start/server-entry';
import { runtime } from './server/runtime';

export default createServerEntry({
  async fetch(request, options) {
    try { await runtime(); }
    catch { return new Response('Installation not configured. Run pnpm run setup in the scanner repository and restart. Check server configuration and database permissions.', { status: 503 }); }
    const response = await handler.fetch(request, options);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  },
});
