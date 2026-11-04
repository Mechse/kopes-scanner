import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { AppShell } from "../components/app-shell";
import stylesheet from "../styles.css?url";
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Host security · kopes.dev" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "stylesheet", href: stylesheet }],
  }),
  component: () => (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem('kopes-theme')||'dark'}catch{}`,
          }}
        />
      </head>
      <body>
        <AppShell>
          <Outlet />
        </AppShell>
        <Scripts />
      </body>
    </html>
  ),
  notFoundComponent: () => (
    <main className="mx-auto flex min-h-[calc(100vh-145px)] max-w-[480px] flex-col justify-center px-6 py-12 [&_h1]:text-[28px]">
      <h1>Page not found</h1>
      <a href="/">Back to host security</a>
    </main>
  ),
  errorComponent: () => (
    <main className="mx-auto flex min-h-[calc(100vh-145px)] max-w-[480px] flex-col justify-center px-6 py-12 [&_h1]:text-[28px]">
      <h1>Unable to load the application</h1>
      <p>Check the container logs and reload.</p>
      <a href="/">Try again</a>
    </main>
  ),
});
