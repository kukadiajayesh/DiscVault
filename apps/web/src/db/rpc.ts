import { type Remote, wrap } from "comlink";
import type { VaultWorkerApi } from "./worker.js";

let remote: Remote<VaultWorkerApi> | null = null;

/** One shared vault worker per tab, created lazily on first use. */
export function vaultWorker(): Remote<VaultWorkerApi> {
  if (!remote) {
    const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    remote = wrap<VaultWorkerApi>(worker);
  }
  return remote;
}
