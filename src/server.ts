import { startupFailure } from './server/startup-error';
import handler, { createServerEntry } from '@tanstack/react-start/server-entry';
import { runtime } from './server/runtime';

export default createServerEntry({
  async fetch(request, options) {
    try { await runtime(); }
    catch (error) { return new Response(startupFailure('configuration',error).message, { status: 503, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } }); }
    const response = await handler.fetch(request, options);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  },
});
