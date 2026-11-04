import { createFileRoute } from '@tanstack/react-router';
import { WorkspaceBar } from '../components/app-shell';
import { UserAccess } from '../components/user-access';

export const Route = createFileRoute('/users')({
  head: () => ({ meta: [{ title: 'User management · kopes.dev' }] }),
  component: () => <main id="main" className="min-w-0 bg-raised px-[clamp(16px,3vw,52px)] pb-8 desktop:rounded-[10px] desktop:border desktop:border-border desktop:pb-12 desktop:shadow-sm desktop:dark:shadow-black/30">
    <WorkspaceBar section="User access" />
    <header className="my-5 desktop:mt-8 desktop:mb-6 [&_h1]:mb-[5px] [&_h1]:text-[clamp(24px,2.2vw,32px)] [&_p]:text-muted-foreground"><h1>User access</h1><p>Manage who can use this scanner.</p></header>
    <UserAccess />
  </main>,
});
