/** SHA-256 as lower-case hex. Works in browsers, Workers and Node. */
export async function sha256Hex(data: Uint8Array | ArrayBuffer | string): Promise<string> {
  const input = typeof data === "string" ? new TextEncoder().encode(data) : (data as Uint8Array<ArrayBuffer> | ArrayBuffer);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function transform(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const writer = stream.writable.getWriter();
  // Not awaited: the readable side below drains the stream while the write completes.
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  return new Uint8Array(await new Response(stream.readable as ReadableStream<Uint8Array<ArrayBuffer>>).arrayBuffer());
}

export function gzip(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return transform(data, new CompressionStream("gzip"));
}

export function gunzip(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return transform(data, new DecompressionStream("gzip"));
}

const HASH_RE = /^[0-9a-f]{64}$/;

export function isSha256Hex(value: string): boolean {
  return HASH_RE.test(value);
}
