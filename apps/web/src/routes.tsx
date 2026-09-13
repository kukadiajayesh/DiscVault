import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";

/**
 * Code-based routes for the 14 screens (§8). Placeholders only — real screens come from the
 * Claude Design work. This file exists so navigation, deep links and the app shell can be built
 * and tested before any screen has content.
 */
function Placeholder({ title }: { title: string }) {
  return (
    <div style={{ padding: 24 }}>
      <h1>{title}</h1>
      <p>Not built yet.</p>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: () => <Placeholder title="Sign in" /> });
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: () => <Placeholder title="First-time setup" />,
});
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => <Placeholder title="Dashboard" /> });
const searchRoute = createRoute({ getParentRoute: () => rootRoute, path: "/search", component: () => <Placeholder title="Search" /> });
const discsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/discs", component: () => <Placeholder title="Disc library" /> });
const discRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/discs/$no",
  component: () => <Placeholder title="Disc explorer" />,
});
const discBrowseRoute = createRoute({
  getParentRoute: () => discRoute,
  path: "/browse/$",
  component: () => <Placeholder title="Disc explorer" />,
});
const scanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/scan",
  component: () => <Placeholder title="Add / re-scan disc" />,
});
const syncRoute = createRoute({ getParentRoute: () => rootRoute, path: "/sync", component: () => <Placeholder title="Sync & storage" /> });
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$",
  component: () => <Placeholder title="Settings" />,
});
const duplicatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/duplicates",
  component: () => <Placeholder title="Duplicate finder" />,
});
const statsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/stats",
  component: () => <Placeholder title="Statistics & reports" />,
});
const collectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collections",
  component: () => <Placeholder title="Collections" />,
});
const collectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collections/$id",
  component: () => <Placeholder title="Collection" />,
});
const locationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/locations",
  component: () => <Placeholder title="Locations & loans" />,
});
const healthRoute = createRoute({ getParentRoute: () => rootRoute, path: "/health", component: () => <Placeholder title="Data health" /> });

const routeTree = rootRoute.addChildren([
  loginRoute,
  setupRoute,
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
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
