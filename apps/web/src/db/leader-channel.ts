import { uuidv7 } from "@discvault/sync-protocol";

/**
 * RPC over `BroadcastChannel` between the tab that owns a vault's SQLite connection (the
 * "leader") and every other tab with that vault open ("followers"). One instance per vault,
 * shared by both roles — which role a given tab plays can change at runtime (a follower is
 * promoted to leader if the leader tab closes), so the same channel is used to `call()` out
 * before promotion and to `serve()` requests after.
 */
export class LeaderChannel {
  private readonly channel: BroadcastChannel;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private handler: ((method: string, args: unknown[]) => Promise<unknown>) | null = null;

  constructor(vaultId: string) {
    this.channel = new BroadcastChannel(`discvault:vault:${vaultId}:rpc`);
    this.channel.addEventListener("message", (event) => this.onMessage(event.data as Message));
  }

  /** Leader side: start answering calls forwarded by follower tabs. */
  serve(handler: (method: string, args: unknown[]) => Promise<unknown>): void {
    this.handler = handler;
  }

  stopServing(): void {
    this.handler = null;
  }

  /** Follower side: forward one call to whichever tab is currently serving, and wait for its reply. */
  call<T>(method: string, args: unknown[], timeoutMs = 10_000): Promise<T> {
    const id = uuidv7();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`leader tab did not respond to "${method}" in time`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.channel.postMessage({ kind: "req", id, method, args } satisfies Message);
    });
  }

  private onMessage(data: Message): void {
    if (data.kind === "req") {
      if (!this.handler) return; // this tab isn't (or is no longer) the leader — ignore
      this.handler(data.method, data.args)
        .then((result) => this.channel.postMessage({ kind: "res", id: data.id, ok: true, result } satisfies Message))
        .catch((error: unknown) =>
          this.channel.postMessage({
            kind: "res",
            id: data.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } satisfies Message),
        );
      return;
    }
    const waiter = this.pending.get(data.id);
    if (!waiter) return; // reply to a call we've already timed out on, or aren't waiting for
    this.pending.delete(data.id);
    if (data.ok) waiter.resolve(data.result);
    else waiter.reject(new Error(data.error));
  }

  /** Tears down the channel and rejects any calls still in flight. */
  close(): void {
    this.handler = null;
    this.channel.close();
    for (const { reject } of this.pending.values()) reject(new Error("leader channel closed"));
    this.pending.clear();
  }
}

type Message =
  | { kind: "req"; id: string; method: string; args: unknown[] }
  | { kind: "res"; id: string; ok: true; result: unknown }
  | { kind: "res"; id: string; ok: false; error: string };
