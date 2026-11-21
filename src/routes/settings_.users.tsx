import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings_/users')({
  beforeLoad: () => { throw redirect({ to: '/settings', search: { tab: 'users' }, replace: true }); },
});
