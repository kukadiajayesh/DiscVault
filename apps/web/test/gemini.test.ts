import { afterEach, describe, expect, it, vi } from "vitest";
import { generateIconPath, isUsableTextModel, listGeminiModels, pickRecommendedGeminiModel } from "../src/ai/gemini.js";

function model(name: string, methods: string[] = ["generateContent"]) {
  return { name, supportedGenerationMethods: methods };
}

describe("isUsableTextModel", () => {
  it("accepts current, text-generating Gemini models", () => {
    expect(isUsableTextModel(model("models/gemini-2.5-flash"))).toBe(true);
    expect(isUsableTextModel(model("models/gemini-2.5-pro"))).toBe(true);
    expect(isUsableTextModel(model("models/gemini-flash-latest"))).toBe(true); // versionless alias — always current
  });

  it("rejects a non-Gemini model, even one that supports generateContent", () => {
    // Every non-text family (embeddings, Imagen, Veo, AQA, …) is caught here already — none of
    // them have "gemini" in the name — so the keyword list below only needs to cover the
    // Gemini-branded non-text kinds (TTS, image/robotics/computer-use output, etc).
    expect(isUsableTextModel(model("models/gemma-3-27b-it"))).toBe(false);
    expect(isUsableTextModel(model("models/aqa"))).toBe(false);
    expect(isUsableTextModel(model("models/imagen-3.0-generate-001"))).toBe(false);
    expect(isUsableTextModel(model("models/veo-2.0-generate-001"))).toBe(false);
  });

  it("rejects a model that doesn't support generateContent at all", () => {
    expect(isUsableTextModel(model("models/gemini-embedding-001", ["embedContent"]))).toBe(false);
    expect(isUsableTextModel(model("models/gemini-2.5-flash", []))).toBe(false);
    expect(isUsableTextModel({ name: "models/gemini-2.5-flash" })).toBe(false);
  });

  it("rejects Gemini-branded models whose output isn't plain text", () => {
    expect(isUsableTextModel(model("models/gemini-2.5-flash-preview-tts"))).toBe(false);
    expect(isUsableTextModel(model("models/gemini-2.0-flash-preview-image-generation"))).toBe(false);
  });

  it("rejects versions older than the retirement floor, but keeps versionless aliases", () => {
    expect(isUsableTextModel(model("models/gemini-2.0-flash-lite"))).toBe(false);
    expect(isUsableTextModel(model("models/gemini-1.0-pro"))).toBe(false);
    expect(isUsableTextModel(model("models/gemini-pro-latest"))).toBe(true);
  });
});

describe("pickRecommendedGeminiModel", () => {
  it("prefers gemini-flash-latest when present", () => {
    expect(pickRecommendedGeminiModel(["gemini-2.5-flash", "gemini-flash-latest"])).toBe("gemini-flash-latest");
  });

  it("otherwise picks the highest-versioned plain flash model", () => {
    expect(pickRecommendedGeminiModel(["gemini-2.5-flash", "gemini-3.0-flash", "gemini-2.5-pro"])).toBe("gemini-3.0-flash");
  });

  it("falls back to gemini-2.5-flash, then any non-lite/preview/exp/8b/thinking flash model", () => {
    expect(pickRecommendedGeminiModel(["gemini-2.5-pro", "gemini-2.5-flash"])).toBe("gemini-2.5-flash");
    expect(pickRecommendedGeminiModel(["gemini-2.5-pro", "gemini-flash-custom"])).toBe("gemini-flash-custom");
  });

  it("skips flash variants the catch-all excludes (lite/preview/exp/8b/thinking), falling back to the first name", () => {
    expect(pickRecommendedGeminiModel(["gemini-2.5-pro", "gemini-2.5-flash-8b"])).toBe("gemini-2.5-pro");
  });

  it("returns the first name when nothing at all matches, and '' for an empty list", () => {
    expect(pickRecommendedGeminiModel(["gemini-2.5-pro"])).toBe("gemini-2.5-pro");
    expect(pickRecommendedGeminiModel([])).toBe("");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("listGeminiModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("live-checks each statically-usable model, drops 404s, keeps everything else including a 429", async () => {
    const models = [
      { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro (retired)", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.0-flash", displayName: "Gemini 3.0 Flash", supportedGenerationMethods: ["generateContent"] },
      // Would already fail the static filter — must never even be live-checked.
      { name: "models/gemini-2.5-flash-preview-tts", displayName: "TTS", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.0-flash-lite", displayName: "Too old", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemma-3-27b-it", displayName: "Gemma", supportedGenerationMethods: ["generateContent"] },
    ];
    const statusByModel: Record<string, number> = {
      "gemini-2.5-flash": 200,
      "gemini-2.5-pro": 404, // clearly gone — excluded
      "gemini-3.0-flash": 429, // just rate-limited by this check — kept
    };
    const checkedModels: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(":generateContent")) {
        const checkedModel = url.match(/\/models\/([^:]+):generateContent/)?.[1] ?? "";
        checkedModels.push(checkedModel);
        return jsonResponse({}, statusByModel[checkedModel] ?? 200);
      }
      return jsonResponse({ models });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listGeminiModels("test-key");

    expect(result.map((m) => m.name)).toEqual(["gemini-2.5-flash", "gemini-3.0-flash"]);
    expect(checkedModels.sort()).toEqual(["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.0-flash"]);
    expect(result.find((m) => m.name === "gemini-3.0-flash")?.recommended).toBe(true);
    expect(result.find((m) => m.name === "gemini-2.5-flash")?.recommended).toBe(false);
  });

  it("excludes a model when checking it throws (network error/timeout), rather than keeping it", async () => {
    const models = [
      { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", supportedGenerationMethods: ["generateContent"] },
    ];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(":generateContent")) {
        if (url.includes("gemini-2.5-pro")) throw new Error("network down");
        return jsonResponse({});
      }
      return jsonResponse({ models });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listGeminiModels("test-key");

    expect(result.map((m) => m.name)).toEqual(["gemini-2.5-flash"]);
  });
});

describe("generateIconPath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends prompt to gemini API and parses path successfully", async () => {
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({ path: "M12 2L2 22h20z" }),
              },
            ],
          },
        },
      ],
    };

    const fetchMock = vi.fn(async () => {
      return jsonResponse(mockResponse);
    });
    vi.stubGlobal("fetch", fetchMock);

    const path = await generateIconPath("test-api-key", "action", "genre");
    expect(path).toBe("M12 2L2 22h20z");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("throws error when API response is invalid", async () => {
    const fetchMock = vi.fn(async () => {
      return jsonResponse({ error: "bad request" }, 400);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateIconPath("test-api-key", "action", "genre")).rejects.toThrow();
  });
});
