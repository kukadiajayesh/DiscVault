import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSearchTmdb, mockSearchRawg, mockSearchItunes, mockGetTmdbKey, mockGetRawgKey } = vi.hoisted(() => ({
  mockSearchTmdb: vi.fn(),
  mockSearchRawg: vi.fn(),
  mockSearchItunes: vi.fn(),
  mockGetTmdbKey: vi.fn(),
  mockGetRawgKey: vi.fn(),
}));

vi.mock("../../src/images/tmdb.js", () => ({ searchTmdbPoster: mockSearchTmdb }));
vi.mock("../../src/images/rawg.js", () => ({ searchRawgImage: mockSearchRawg }));
vi.mock("../../src/images/itunes.js", () => ({ searchItunesArtwork: mockSearchItunes }));
vi.mock("../../src/images/tmdb-key.js", () => ({ getTmdbApiKey: mockGetTmdbKey }));
vi.mock("../../src/images/rawg-key.js", () => ({ getRawgApiKey: mockGetRawgKey }));

import { lookupPreviewImage } from "../../src/images/lookup.js";

beforeEach(() => {
  mockSearchTmdb.mockReset();
  mockSearchRawg.mockReset();
  mockSearchItunes.mockReset();
  mockGetTmdbKey.mockReset();
  mockGetRawgKey.mockReset();
});

describe("lookupPreviewImage", () => {
  it("routes movies to TMDB when a key is configured", async () => {
    mockGetTmdbKey.mockReturnValue("tmdb-key");
    mockSearchTmdb.mockResolvedValue("https://image.tmdb.org/poster.jpg");

    const url = await lookupPreviewImage({ contentType: "movie", title: "Inception", year: "2010" });

    expect(url).toBe("https://image.tmdb.org/poster.jpg");
    expect(mockSearchTmdb).toHaveBeenCalledWith("tmdb-key", "Inception", "2010");
    expect(mockSearchRawg).not.toHaveBeenCalled();
  });

  it("skips the TMDB call entirely when no key is configured", async () => {
    mockGetTmdbKey.mockReturnValue(null);

    const url = await lookupPreviewImage({ contentType: "movie", title: "Inception", year: null });

    expect(url).toBeNull();
    expect(mockSearchTmdb).not.toHaveBeenCalled();
  });

  it("routes games to RAWG when a key is configured", async () => {
    mockGetRawgKey.mockReturnValue("rawg-key");
    mockSearchRawg.mockResolvedValue("https://media.rawg.io/hl2.jpg");

    const url = await lookupPreviewImage({ contentType: "game", title: "Half-Life 2", year: null });

    expect(url).toBe("https://media.rawg.io/hl2.jpg");
    expect(mockSearchRawg).toHaveBeenCalledWith("rawg-key", "Half-Life 2");
  });

  it("skips the RAWG call entirely when no key is configured", async () => {
    mockGetRawgKey.mockReturnValue(null);

    const url = await lookupPreviewImage({ contentType: "game", title: "Half-Life 2", year: null });

    expect(url).toBeNull();
    expect(mockSearchRawg).not.toHaveBeenCalled();
  });

  it("routes software and music to iTunes, never needing a key", async () => {
    mockSearchItunes.mockResolvedValue("https://a.mzstatic.com/app.jpg");

    expect(await lookupPreviewImage({ contentType: "software", title: "Photoshop", year: null })).toBe("https://a.mzstatic.com/app.jpg");
    expect(mockSearchItunes).toHaveBeenCalledWith("Photoshop", "software");

    expect(await lookupPreviewImage({ contentType: "music", title: "Abbey Road", year: null })).toBe("https://a.mzstatic.com/app.jpg");
    expect(mockSearchItunes).toHaveBeenCalledWith("Abbey Road", "music");
  });

  it("never looks anything up for mixed/other content types", async () => {
    expect(await lookupPreviewImage({ contentType: "mixed", title: "Some Stuff", year: null })).toBeNull();
    expect(await lookupPreviewImage({ contentType: "other", title: "Some Stuff", year: null })).toBeNull();
    expect(mockSearchTmdb).not.toHaveBeenCalled();
    expect(mockSearchRawg).not.toHaveBeenCalled();
    expect(mockSearchItunes).not.toHaveBeenCalled();
  });

  it("returns null immediately when there's no title to search for", async () => {
    expect(await lookupPreviewImage({ contentType: "movie", title: null, year: null })).toBeNull();
    expect(mockGetTmdbKey).not.toHaveBeenCalled();
  });

  it("never throws, even if a provider call rejects", async () => {
    mockGetTmdbKey.mockReturnValue("tmdb-key");
    mockSearchTmdb.mockRejectedValue(new Error("boom"));

    await expect(lookupPreviewImage({ contentType: "movie", title: "Inception", year: null })).resolves.toBeNull();
  });
});
