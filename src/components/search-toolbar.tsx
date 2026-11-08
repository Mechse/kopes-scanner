import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export function SearchToolbar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={cn("search-toolbar -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground", className)}>
    {children}
  </div>;
}
