import { ContentSkeleton, LoadingStatus } from "./ui/loading";
import { Link, useLocation } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronRight,
  Activity,
  Box,
  Menu,
  Users,
  LogIn,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { Logo } from "./logo";
import { Button } from "./ui/button";

import type { Dashboard } from "../lib/model";
import { useResource } from "../lib/use-resource";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";

type Inventory = Dashboard & { isAdmin: boolean };
const WorkspaceContext = createContext<{
  inventory: ReturnType<typeof useResource<Inventory>>;
  revision: number;
  refresh: () => void;
} | null>(null);
export function useWorkspace() {
  const state = useContext(WorkspaceContext);
  if (!state) throw new Error("Workspace unavailable");
  return state;
}
export function WorkspaceBar({
  section,
  report,
  project,
}: {
  section: string;
  report?: string;
  project?: string;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={`${report || project !== undefined ? "" : "mobile:hidden"} -mx-4 flex min-h-[55px] min-w-0 items-center gap-2 border-b border-border px-4 py-2 text-xs [&_a]:text-muted-foreground [&_a:hover]:underline [&_svg]:text-muted-foreground`}
    >
      <Link to="/" search={{}}>
        Workspace
      </Link>
      <ChevronRight size={13} />
      {report || project !== undefined ? (
        <Link to="/" search={{ view: "apps" }}>
          Projects
        </Link>
      ) : (
        <span>{section}</span>
      )}
      {project !== undefined && <>
        <ChevronRight size={13} />
        <Link to="/" search={{ view: "apps", project }} className="truncate">{project || "Ungrouped"}</Link>
      </>}
      {report && (
        <>
          <ChevronRight size={13} />
          <span aria-current="page" className="truncate" title={report}>
            {report}
          </span>
        </>
      )}
    </nav>
  );
}
const navLinkClass =
  "flex items-center gap-2.5 rounded-md px-2.5 py-3 text-sm text-muted-foreground hover:bg-sunken hover:text-foreground aria-[current=page]:bg-sunken aria-[current=page]:text-foreground desktop:gap-2 desktop:text-[13px] desktop:py-[5px] desktop:hover:bg-foreground/5 desktop:aria-[current=page]:bg-foreground/9 [&[aria-current=page]_svg]:text-brand-ink";

const auth = createAuthClient();
function ThemeButton() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    setDark(document.documentElement.dataset.theme !== "light");
  }, []);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.dataset.theme = next ? "dark" : "light";
        try {
          localStorage.setItem("kopes-theme", next ? "dark" : "light");
        } catch {
          /* Theme works without storage. */
        }
      }}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const { data: session, isPending, error: sessionError } = auth.useSession();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [authAction, setAuthAction] = useState<"in" | "out" | null>(null);
  const inventory = useResource<Inventory>(
    session ? "inventory" : "",
    revision,
    pathname === "/" ? 2500 : 0,
  );
  const actions = (
    <div className="mt-auto flex items-center justify-between">
      <ThemeButton />
      {session && (
        <Button
          variant="ghost"
          size="sm"
          busy={authAction === "out"}
          onClick={async () => {
            setAuthAction("out");
            try {
              const result = await auth.signOut();
              if (result.error) setError("Sign out failed. Please retry.");
            } catch {
              setError("Sign out failed. Please retry.");
            } finally { setAuthAction(null); }
          }}
        >
          {authAction !== "out" && <LogOut />}
          {authAction === "out" ? "Signing out…" : "Sign out"}
        </Button>
      )}
    </div>
  );
  const navigate = () => {
    setOpen(false);
  };
  const sidebar = (
    <div className="flex flex-col gap-4 px-3 pt-3 pb-3 desktop:gap-0 desktop:sticky desktop:top-0 desktop:h-dvh desktop:overflow-y-auto desktop:top-2 desktop:h-[calc(100dvh-16px)] desktop:pt-4 desktop:pb-2">
      <Link
        to="/"
        search={{}}
        onClick={navigate}
        className="ml-2.5 desktop:mb-6 desktop:ml-3.5"
        aria-label="kopes.dev host security"
      >
        <Logo width={88} />
      </Link>
      <nav className="grid gap-[3px] desktop:mx-1 desktop:gap-0.5" aria-label="Workspace">
        {(
          [
            ["Pulse", undefined, Activity],
            ["Projects", "apps", Box],
            ["Activity", "activity", Activity],
          ] as const
        ).map(([label, view, Icon]) => (
          <Link
            key={label}
            className={navLinkClass}
            to="/"
            search={{ view }}
            aria-current={
              pathname === "/" && search.view === view ? "page" : undefined
            }
            activeOptions={{
              exact: view === undefined,
              explicitUndefined: true,
            }}
            onClick={navigate}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
        {inventory?.data?.isAdmin && (
          <Link className={navLinkClass} to="/users" onClick={navigate}>
            <Users size={16} />
            User access
          </Link>
        )}
      </nav>
      {actions}
    </div>
  );
  return (
    <>
      <a
        href="#main"
        className="fixed -top-25 left-4 z-10 bg-primary p-3 text-primary-foreground focus:top-3"
      >
        Skip to content
      </a>
      {!session && (
        <header className="flex min-h-[76px] items-center gap-[26px] border-b border-border px-10 py-4 mobile:px-4 [&>button]:ml-auto">
          <a className="flex" href="/" aria-label="kopes.dev host security">
            <Logo width={88} />
          </a>
          <ThemeButton />
        </header>
      )}
      {error && (
        <div
          className="mt-3 mb-5 rounded-sm border border-border bg-sunken px-4 py-3 text-[13px] wrap-anywhere text-critical"
          role="alert"
        >
          {error}
        </div>
      )}
      {isPending ? (
        <main
          id="main"
          className="mx-auto flex min-h-[calc(100vh-145px)] max-w-[480px] flex-col justify-center px-6 py-12 [&_h1]:text-[28px]"
        >
          <section className="rounded-[10px] border border-border bg-raised p-6"><LoadingStatus label="Checking your session…" /><ContentSkeleton label="Loading workspace…" layout="detail" /></section>
        </main>
      ) : session ? (
        <WorkspaceContext.Provider
          value={{
            inventory,
            revision,
            refresh: () => setRevision((n) => n + 1),
          }}
        >
          <header className="flex items-center gap-2.5 border-b border-border px-3 py-1 desktop:hidden">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label="Open navigation"
                >
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" title="Workspace navigation">
                {sidebar}
              </SheetContent>
            </Sheet>
            <Logo width={76} />
          </header>
          <div className="min-h-dvh desktop:grid desktop:grid-cols-[208px_minmax(0,1fr)] desktop:bg-[linear-gradient(145deg,var(--surface),color-mix(in_srgb,var(--surface)_60%,var(--surface-sunken)))] desktop:py-2 desktop:pr-2">
            <aside className="hidden desktop:block">{sidebar}</aside>
            {children}
          </div>
        </WorkspaceContext.Provider>
      ) : (
        <main
          id="main"
          className="mx-auto flex min-h-[calc(100vh-145px)] max-w-[480px] flex-col justify-center px-6 py-12 [&_h1]:text-[28px]"
        >
          <section className="rounded-[10px] border border-border bg-raised p-8 mobile:p-6 [&>button]:w-full">
            <div className="pb-5">
              <Logo variant="small" width={40} decorative />
            </div>
            <h1>Sign in to Host security</h1>
            <p className="mb-6 text-muted-foreground">
              Review vulnerability scans for your host and its container images.
            </p>
            {sessionError && (
              <p role="alert" className="mb-6 text-critical">
                Authentication is unavailable. Check installation settings.
              </p>
            )}
            <Button
              busy={authAction === "in"}
              onClick={async () => {
                setAuthAction("in");
                setError("");
                try {
                  const result = await auth.signIn.social({
                    provider: "github",
                    callbackURL: window.location.pathname + window.location.search,
                    errorCallbackURL: `${pathname}?authError=1`,
                  });
                  if (result.error) {
                    setAuthAction(null);
                    setError(
                      "GitHub sign-in failed. Check OAuth configuration and the allowlist.",
                    );
                  }
                } catch {
                  setAuthAction(null);
                  setError("Unable to contact GitHub sign-in. Please retry.");
                }
              }}
            >
              {authAction !== "in" && <LogIn />}
              {authAction === "in" ? "Connecting to GitHub…" : "Sign in with GitHub"}
            </Button>
            <AuthError />
            <div className="mt-6 border-t border-border pt-6 text-xs text-muted-foreground">
              Access requires administrator approval. GitHub repositories are
              not requested or scanned. Scans do not change your server.
            </div>
          </section>
        </main>
      )}
    </>
  );
}
function AuthError() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(new URLSearchParams(location.search).has("authError"));
  }, []);
  return failed ? (
    <p className="mb-6 text-critical" role="alert">
      Sign-in was not completed. Check your allowed username and the GitHub
      OAuth callback URL.
    </p>
  ) : null;
}
