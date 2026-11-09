import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { UserAccess } from '../components/user-access';

export const Route = createFileRoute('/settings_/users')({
  head: () => ({ meta: [{ title: 'User management · kopes.dev' }] }),
  component: () => <main id="main" className="min-w-0 bg-raised px-4 pb-8 desktop:rounded-[10px] desktop:border desktop:border-border desktop:pb-12 desktop:shadow-sm desktop:dark:shadow-black/30">
    <nav aria-label="Breadcrumb" className="-mx-4 flex min-h-[55px] items-center gap-2 border-b border-border px-4 py-3 text-xs">
      <Link to="/settings" search={{}} className="text-muted-foreground hover:text-brand-ink">Settings</Link>
      <ChevronRight size={13} className="text-muted-foreground" aria-hidden="true" />
      <span aria-current="page">User access</span>
    </nav>
    <h1 className="sr-only">User access</h1>
    <UserAccess />
  </main>,
});
