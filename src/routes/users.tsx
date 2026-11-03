import { createFileRoute, Link } from '@tanstack/react-router';
import { IconArrowLeft } from '@tabler/icons-react';
import { AppShell } from '../components/app-shell';
import { Button } from '../components/ui/button';
import { UserAccess } from '../components/user-access';

export const Route = createFileRoute('/users')({
  head: () => ({ meta: [{ title: 'User management · kopes.dev' }] }),
  component: () => <AppShell><main id="main" className="workspace">
    <section className="workspace-heading"><h1>User management</h1><Button asChild variant="outline" size="sm"><Link to="/"><IconArrowLeft />Back to scan overview</Link></Button></section>
    <UserAccess />
  </main></AppShell>,
});
