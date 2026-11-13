import { createFileRoute, redirect } from '@tanstack/react-router';
export const Route = createFileRoute('/projects')({
  validateSearch: (search: Record<string, unknown>) => ({ id: typeof search.id === 'string' ? search.id : undefined, resource: typeof search.resource === 'string' ? search.resource : undefined }),
  beforeLoad: ({ search }) => { throw redirect({ to: '/', search: { view: 'apps', managedId: search.id, resource: search.resource }, replace: true }); },
});
