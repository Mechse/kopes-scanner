import { createFileRoute } from '@tanstack/react-router';
import { UserAccess } from '../components/user-access';

export const Route = createFileRoute('/users')({
  head: () => ({ meta: [{ title: 'User management · kopes.dev' }] }),
  component: () => <main id="main" className="console-main">
    <header className="console-heading"><h1>User access</h1></header>
    <UserAccess />
  </main>,
});
