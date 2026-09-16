import { QueryClient } from "@tanstack/react-query";

/**
 * Module-level singleton so app-level background work (e.g. the bulk AI-analyze queue in
 * ai/bulk-analyze.ts) can invalidate query caches without depending on a live component tree.
 */
export const queryClient = new QueryClient();
