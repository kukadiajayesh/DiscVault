import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { RequireAuth } from "./app/require-auth.js";
import { AppShell } from "./app/shell.js";
import Dashboard from "./screens/Dashboard.js";
import DiscExplorer from "./screens/DiscExplorer.js";
import Discs from "./screens/Discs.js";
import Login from "./screens/Login.js";
import Scan from "./screens/Scan.js";
import Search from "./screens/Search.js";
import Settings from "./screens/Settings.js";
import Setup from "./screens/Setup.js";
import Sync from "./screens/Sync.js";
import Titles from "./screens/Titles.js";

/** Code-based routes for the 14 screens (§8) plus the disc-explorer browse splat and settings splat. */

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// Full-bleed, no app shell: reached before a vault is open.
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: Login });
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: () => (
    <RequireAuth>
      <Setup />
    </RequireAuth>
  ),
});

// Every other screen shares the app shell (top bar / left nav / bottom tabs) and requires a session.
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app-layout",
  component: () => (
    <RequireAuth>
      <AppShell>
        <Outlet />
      </AppShell>
    </RequireAuth>
  ),
});

const dashboardRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/", component: Dashboard });

const searchRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/search",
  validateSearch: (search: Record<string, unknown>): { q?: string } => (typeof search.q === "string" && search.q ? { q: search.q } : {}),
  component: Search,
});

const discsRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/discs", component: Discs });
const discRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/discs/$no", component: DiscExplorer });
const discBrowseRoute = createRoute({ getParentRoute: () => discRoute, path: "/browse/$", component: DiscExplorer });

const scanRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/scan",
  validateSearch: (search: Record<string, unknown>): { disc?: number } => {
    const disc = typeof search.disc === "number" ? search.disc : typeof search.disc === "string" ? Number(search.disc) : undefined;
    return disc === undefined || Number.isNaN(disc) ? {} : { disc };
  },
  component: Scan,
});

const titlesRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/titles", component: Titles });
const titlesGenreRoute = createRoute({ getParentRoute: () => titlesRoute, path: "/genre/$genre", component: Titles });
const titlesByTypeRoute = createRoute({ getParentRoute: () => titlesRoute, path: "/$type", component: Titles });

const syncRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/sync", component: Sync });
const settingsRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/settings/$", component: Settings });

const routeTree = rootRoute.addChildren([
  loginRoute,
  setupRoute,
  appLayoutRoute.addChildren([
    dashboardRoute,
    searchRoute,
    discsRoute,
    discRoute.addChildren([discBrowseRoute]),
    titlesRoute.addChildren([titlesGenreRoute, titlesByTypeRoute]),
    scanRoute,
    syncRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
