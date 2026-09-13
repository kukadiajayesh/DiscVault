import {
  API_PREFIX,
  type ChangesResponse,
  type ErrorCode,
  type HeadResponse,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  type PushRequest,
  type PushResponse,
  type ReserveRequest,
  type ReserveResponse,
} from "@discvault/sync-protocol";

/** What the sync engine needs from the server. HTTP in the app, an in-memory server in tests. */
export interface SyncTransport {
  head(): Promise<HeadResponse>;
  changes(since: number, limit?: number): Promise<ChangesResponse>;
  push(request: PushRequest): Promise<PushResponse>;
  reserve(request: ReserveRequest): Promise<ReserveResponse>;
  uploadPart(discNo: number, packHash: string, part: number, data: Uint8Array): Promise<void>;
  downloadPart(discNo: number, packHash: string, part: number): Promise<Uint8Array>;
}

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "network",
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** Same-origin API client. The session cookie is the only credential; the vault comes from it. */
export function httpTransport(origin = ""): SyncTransport {
  async function request(method: string, path: string, body?: BodyInit, contentType?: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${origin}${API_PREFIX}${path}`, {
        method,
        credentials: "same-origin",
        headers: { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION), ...(contentType ? { "Content-Type": contentType } : {}) },
        ...(body !== undefined ? { body } : {}),
      });
    } catch (error) {
      throw new SyncHttpError(0, "network", error instanceof Error ? error.message : "network error");
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { code: ErrorCode; message: string; retryAfter?: number };
      } | null;
      throw new SyncHttpError(
        response.status,
        payload?.error?.code ?? "internal",
        payload?.error?.message ?? response.statusText,
        payload?.error?.retryAfter ?? (Number(response.headers.get("Retry-After")) || undefined),
      );
    }
    return response;
  }
  const json = async <T>(method: string, path: string, body?: unknown): Promise<T> =>
    (await (await request(method, path, body === undefined ? undefined : JSON.stringify(body), "application/json")).json()) as T;

  return {
    head: () => json("GET", "/sync/head"),
    changes: (since, limit = 1000) => json("GET", `/sync/changes?since=${since}&limit=${limit}`),
    push: (body) => json("POST", "/sync/push", body),
    reserve: (body) => json("POST", "/packs/reserve", body),
    async uploadPart(discNo, packHash, part, data) {
      await request("PUT", `/packs/${discNo}/${packHash}/${part}`, data as Uint8Array<ArrayBuffer>, "application/gzip");
    },
    async downloadPart(discNo, packHash, part) {
      const response = await request("GET", `/packs/${discNo}/${packHash}/${part}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
