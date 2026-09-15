import { afterEach, describe, expect, it, vi } from "vitest";
import { searchItunesArtwork } from "../../src/images/itunes.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("searchItunesArtwork", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("upsizes the default 100x100 artwork URL to 600x600", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("itunes.apple.com/search");
      expect(url).toContain("media=music");
      expect(url).not.toContain("api_key");
      return jsonResponse({ results: [{ artworkUrl100: "https://a.mzstatic.com/album100x100bb.jpg" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await searchItunesArtwork("Abbey Road", "music")).toBe("https://a.mzstatic.com/album600x600bb.jpg");
  });

  it("returns null when there are no results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ results: [] })),
    );
    expect(await searchItunesArtwork("Nothing Like This", "software")).toBeNull();
  });

  it("returns null on a non-ok response instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 500)),
    );
    expect(await searchItunesArtwork("Abbey Road", "music")).toBeNull();
  });

  it("returns null when fetch itself throws (offline/timeout)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await searchItunesArtwork("Abbey Road", "music")).toBeNull();
  });
});
