import * as React from 'react';
import { Tabs as Primitive } from 'radix-ui';
import { cn } from '../../lib/utils';
export function Tabs(props: React.ComponentProps<typeof Primitive.Root>) { return <Primitive.Root data-slot="tabs" {...props} />; }
export function TabsList({ className, ...props }: React.ComponentProps<typeof Primitive.List>) { return <Primitive.List className={cn('inline-flex gap-1 border-b border-border w-full', className)} {...props} />; }
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof Primitive.Trigger>) { return <Primitive.Trigger className={cn('px-4 py-3 text-sm text-muted-foreground border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground focus-visible:outline-2 focus-visible:outline-brand-ink', className)} {...props} />; }
export function TabsContent({ className, ...props }: React.ComponentProps<typeof Primitive.Content>) { return <Primitive.Content className={cn('pt-5 outline-none', className)} {...props} />; }
