import { afterEach, describe, expect, it, vi } from "vitest";
import { searchRawgImage } from "../../src/images/rawg.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("searchRawgImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the first result's background_image", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("api.rawg.io/api/games");
      expect(url).toContain("search=Half-Life+2");
      expect(url).toContain("key=test-key");
      return jsonResponse({ results: [{ background_image: "https://media.rawg.io/half-life-2.jpg" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await searchRawgImage("test-key", "Half-Life 2")).toBe("https://media.rawg.io/half-life-2.jpg");
  });

  it("returns null when there are no results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ results: [] })),
    );
    expect(await searchRawgImage("test-key", "Nothing Like This")).toBeNull();
  });

  it("returns null on a non-ok response instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 403)),
    );
    expect(await searchRawgImage("bad-key", "Half-Life 2")).toBeNull();
  });

  it("returns null when fetch itself throws (offline/timeout)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await searchRawgImage("test-key", "Half-Life 2")).toBeNull();
  });
});
