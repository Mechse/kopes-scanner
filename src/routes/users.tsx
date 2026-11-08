import { createFileRoute } from '@tanstack/react-router';
import { WorkspaceBar } from '../components/app-shell';
import { UserAccess } from '../components/user-access';

export const Route = createFileRoute('/users')({
  head: () => ({ meta: [{ title: 'User management · kopes.dev' }] }),
  component: () => <main id="main" className="min-w-0 bg-raised px-4 pb-8 desktop:rounded-[10px] desktop:border desktop:border-border desktop:pb-12 desktop:shadow-sm desktop:dark:shadow-black/30">
    <WorkspaceBar section="User access" />
    <h1 className="sr-only">User access</h1>
    <UserAccess />
  </main>,
});
