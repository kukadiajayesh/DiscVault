import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApi, mockIdentify, mockLookup } = vi.hoisted(() => ({
  mockApi: {
    discAiSummary: vi.fn(),
    saveDiscAiRaw: vi.fn(),
    applyDiscItems: vi.fn(),
    setDiscTitle: vi.fn(),
    discItems: vi.fn(),
    setDiscItemImageUrl: vi.fn(),
    cacheDiscItemImage: vi.fn(),
  },
  mockIdentify: vi.fn(),
  mockLookup: vi.fn(),
}));

vi.mock("../src/db/rpc.js", () => ({ vaultWorker: () => mockApi }));
vi.mock("../src/ai/gemini.js", () => ({ identifyDiscItems: mockIdentify }));
vi.mock("../src/images/lookup.js", () => ({ lookupPreviewImage: mockLookup }));

import { analyzeDiscWithAi, buildModelFallbackChain, fetchPreviewImagesForDisc } from "../src/ai/analyze.js";
import { DEFAULT_GEMINI_MODEL } from "../src/ai/gemini-key.js";

beforeEach(() => {
  mockApi.discAiSummary.mockReset();
  mockApi.saveDiscAiRaw.mockReset();
  mockApi.applyDiscItems.mockReset();
  mockApi.setDiscTitle.mockReset();
  mockApi.discItems.mockReset();
  mockApi.setDiscItemImageUrl.mockReset();
  mockApi.cacheDiscItemImage.mockReset();
  mockIdentify.mockReset();
  mockLookup.mockReset();
});

describe("buildModelFallbackChain", () => {
  it("puts the preferred model first, then every other available model", () => {
    expect(buildModelFallbackChain("b", [{ name: "a" }, { name: "b" }, { name: "c" }])).toEqual(["b", "a", "c"]);
  });

  it("still tries the preferred model even when it isn't in the available list", () => {
    expect(buildModelFallbackChain("custom-model", [{ name: "a" }])).toEqual(["custom-model", "a"]);
  });

  it("falls back to the default model when nothing is preferred or available", () => {
    expect(buildModelFallbackChain("", [])).toEqual([DEFAULT_GEMINI_MODEL]);
  });
});

describe("analyzeDiscWithAi", () => {
  it("falls through to the next model when the first one fails", async () => {
    mockApi.discAiSummary.mockResolvedValue({ discNo: 1, title: null, label: null });
    mockIdentify
      .mockRejectedValueOnce(new Error("model-a overloaded"))
      .mockResolvedValueOnce({ raw: "{}", discTitle: "Found It", items: [] });

    const result = await analyzeDiscWithAi(1, { apiKey: "key", models: ["model-a", "model-b"], hasTitle: false });

    expect(result.model).toBe("model-b");
    expect(mockIdentify).toHaveBeenCalledTimes(2);
    expect(mockApi.saveDiscAiRaw).toHaveBeenCalledWith(1, expect.objectContaining({ model: "model-b" }));
    expect(mockApi.applyDiscItems).toHaveBeenCalledWith(1, []);
    expect(mockApi.setDiscTitle).toHaveBeenCalledWith(1, "Found It");
  });

  it("throws with every model's failure once all of them fail", async () => {
    mockApi.discAiSummary.mockResolvedValue({ discNo: 1, title: null, label: null });
    mockIdentify.mockRejectedValue(new Error("quota exceeded"));

    await expect(analyzeDiscWithAi(1, { apiKey: "key", models: ["model-a", "model-b"], hasTitle: true })).rejects.toThrow(
      /model-a.*quota exceeded[\s\S]*model-b.*quota exceeded/,
    );
    expect(mockIdentify).toHaveBeenCalledTimes(2);
    expect(mockApi.applyDiscItems).not.toHaveBeenCalled();
  });

  it("does not overwrite an existing disc title even when the AI suggests one", async () => {
    mockApi.discAiSummary.mockResolvedValue({ discNo: 1, title: "Already titled", label: null });
    mockIdentify.mockResolvedValue({ raw: "{}", discTitle: "New suggestion", items: [] });

    await analyzeDiscWithAi(1, { apiKey: "key", models: ["model-a"], hasTitle: true });

    expect(mockApi.setDiscTitle).not.toHaveBeenCalled();
  });
});

describe("fetchPreviewImagesForDisc", () => {
  it("looks up and saves an image URL for every item, caching bytes only when a URL was found", async () => {
    mockApi.discItems.mockResolvedValue([
      { id: "item-1", contentType: "movie", title: "Inception", year: "2010" },
      { id: "item-2", contentType: "mixed", title: null, year: null },
    ]);
    mockLookup.mockResolvedValueOnce("https://image.tmdb.org/t/p/w500/poster.jpg").mockResolvedValueOnce(null);

    await fetchPreviewImagesForDisc(1);

    expect(mockApi.setDiscItemImageUrl).toHaveBeenCalledWith("item-1", "https://image.tmdb.org/t/p/w500/poster.jpg");
    expect(mockApi.setDiscItemImageUrl).toHaveBeenCalledWith("item-2", null);
    expect(mockApi.cacheDiscItemImage).toHaveBeenCalledTimes(1);
    expect(mockApi.cacheDiscItemImage).toHaveBeenCalledWith("item-1", "https://image.tmdb.org/t/p/w500/poster.jpg");
  });

  it("isolates one item's lookup failure from the others", async () => {
    mockApi.discItems.mockResolvedValue([
      { id: "item-1", contentType: "movie", title: "Broken Lookup", year: null },
      { id: "item-2", contentType: "movie", title: "Fine", year: null },
    ]);
    mockLookup.mockRejectedValueOnce(new Error("network error")).mockResolvedValueOnce("https://image.tmdb.org/t/p/w500/fine.jpg");

    await expect(fetchPreviewImagesForDisc(1)).resolves.toBeUndefined();

    expect(mockApi.setDiscItemImageUrl).toHaveBeenCalledWith("item-2", "https://image.tmdb.org/t/p/w500/fine.jpg");
    expect(mockApi.setDiscItemImageUrl).not.toHaveBeenCalledWith("item-1", expect.anything());
  });
});
