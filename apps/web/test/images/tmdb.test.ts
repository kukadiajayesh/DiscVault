import { afterEach, describe, expect, it, vi } from "vitest";
import { searchTmdbPoster } from "../../src/images/tmdb.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("searchTmdbPoster", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the poster URL from the first result's poster_path", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("api.themoviedb.org/3/search/movie");
      expect(url).toContain("query=Inception");
      expect(url).toContain("year=2010");
      expect(url).toContain("api_key=test-key");
      return jsonResponse({ results: [{ poster_path: "/abc123.jpg" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await searchTmdbPoster("test-key", "Inception", "2010")).toBe("https://image.tmdb.org/t/p/w500/abc123.jpg");
  });

  it("returns null when there are no results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ results: [] })),
    );
    expect(await searchTmdbPoster("test-key", "Nothing Like This", null)).toBeNull();
  });

  it("returns null on a non-ok response instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 401)),
    );
    expect(await searchTmdbPoster("bad-key", "Inception", null)).toBeNull();
  });

  it("returns null when fetch itself throws (offline/timeout)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await searchTmdbPoster("test-key", "Inception", null)).toBeNull();
  });
});
