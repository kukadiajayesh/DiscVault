import { queryClient } from "../app/query-client.js";
import { analyzeDiscWithAi } from "./analyze.js";

/** Minimum gap between two Gemini calls in the bulk queue, so a big library can't burn through a free-tier quota. */
const ANALYZE_INTERVAL_MS = 5 * 60_000;

/** Discs processed per run before stopping on its own — resuming (calling this again) picks up where this run left off. */
const MAX_BATCH_SIZE = 10;

export interface BulkAnalyzeProgress {
  done: number;
  total: number;
  discNo: number;
  waiting: boolean;
}

export interface BulkAnalyzeTarget {
  discNo: number;
  hasTitle: boolean;
}

interface BulkAnalyzeState {
  progress: BulkAnalyzeProgress | null;
  error: string | null;
}

/**
 * App-level singleton (not React state) so the bulk-analyze queue survives navigating away from the
 * Discs screen — it lives as long as the tab does, not as long as the component that started it.
 * Screens subscribe via useSyncExternalStore instead of owning the queue themselves.
 */
let state: BulkAnalyzeState = { progress: null, error: null };
const listeners = new Set<() => void>();
let cancelRequested = false;
let runId = 0;

function setState(next: Partial<BulkAnalyzeState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): BulkAnalyzeState {
  return state;
}

export function isRunning(): boolean {
  return state.progress !== null;
}

export function cancelBulkAnalyze(): void {
  cancelRequested = true;
}

async function cancellableSleep(ms: number): Promise<void> {
  const wakeAt = Date.now() + ms;
  while (!cancelRequested && Date.now() < wakeAt) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, wakeAt - Date.now())));
  }
}

/**
 * Runs every target through Gemini one at a time, waiting ANALYZE_INTERVAL_MS between discs (never
 * in parallel, never back-to-back — friendly to the free-tier API key this app assumes). Each disc
 * itself falls through every available model before counting as failed (`analyzeDiscWithAi`), so
 * this only stops early once a disc has exhausted every model — at that point the error is recorded
 * and calling this again resumes with whatever's still unanalyzed, instead of plowing through the
 * rest with the same failure.
 *
 * Caps itself at MAX_BATCH_SIZE discs per call so a large library doesn't run unattended for hours —
 * callers should pass every unanalyzed disc each time; whatever doesn't fit in this run's batch is
 * simply left unanalyzed for the next call to pick up.
 *
 * A no-op if a run is already in progress (started from another mounted screen instance).
 */
export async function startBulkAnalyze(targets: BulkAnalyzeTarget[], opts: { apiKey: string; models: string[] }): Promise<void> {
  if (isRunning() || targets.length === 0) return;
  const batch = targets.slice(0, MAX_BATCH_SIZE);
  const myRun = ++runId;
  cancelRequested = false;
  setState({ error: null });
  let done = 0;
  try {
    for (const target of batch) {
      if (cancelRequested || myRun !== runId) break;
      if (done > 0) {
        setState({ progress: { done, total: batch.length, discNo: target.discNo, waiting: true } });
        await cancellableSleep(ANALYZE_INTERVAL_MS);
        if (cancelRequested || myRun !== runId) break;
      }
      setState({ progress: { done, total: batch.length, discNo: target.discNo, waiting: false } });
      await analyzeDiscWithAi(target.discNo, { apiKey: opts.apiKey, models: opts.models, hasTitle: target.hasTitle });
      done++;
      await queryClient.invalidateQueries({ queryKey: ["disc-nos-with-ai-items"] });
    }
  } catch (err) {
    setState({
      error: `Stopped after ${done} of ${batch.length} — disc #${batch[done]?.discNo} failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    setState({ progress: null });
    await queryClient.invalidateQueries({ queryKey: ["discs-recent"] });
  }
}
