import { createFileRoute } from '@tanstack/react-router';
import { runtime } from '../server/runtime';
const handle = async ({ request }: { request: Request }) => (await runtime()).auth.handler(request);
export const Route = createFileRoute('/api/auth/$')({ server: { handlers: { GET: handle, POST: handle } } });
