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
import Stub from "./screens/Stub.js";
import Sync from "./screens/Sync.js";

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

const syncRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/sync", component: Sync });
const settingsRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/settings/$", component: Settings });

// Phase 4 (§8, items 10-14): position in the information architecture is set; content is a stub.
const duplicatesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/duplicates",
  component: () => <Stub title="Duplicate finder" />,
});
const statsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/stats",
  component: () => <Stub title="Statistics & reports" />,
});
const collectionsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/collections",
  component: () => <Stub title="Collections" />,
});
const collectionRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/collections/$id",
  component: () => <Stub title="Collection" />,
});
const locationsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/locations",
  component: () => <Stub title="Locations & loans" />,
});
const healthRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/health",
  component: () => <Stub title="Data health" />,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  setupRoute,
  appLayoutRoute.addChildren([
    dashboardRoute,
    searchRoute,
    discsRoute,
    discRoute.addChildren([discBrowseRoute]),
    scanRoute,
    syncRoute,
    settingsRoute,
    duplicatesRoute,
    statsRoute,
    collectionsRoute,
    collectionRoute,
    locationsRoute,
    healthRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
