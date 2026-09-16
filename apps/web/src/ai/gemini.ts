import type { DiscAiSummary } from "../db/catalog.js";
import { fetchWithTimeout } from "../lib/fetch-timeout.js";
import type { DiscItemDraft } from "./classification.js";
import { DEFAULT_GEMINI_MODEL } from "./gemini-key.js";

function endpointFor(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

const ITEM_SCHEMA = {
  type: "OBJECT",
  properties: {
    path: {
      type: "STRING",
      description: "One of the given top-level folder names this item lives in, or '' if it covers the whole disc.",
    },
    contentType: { type: "STRING", enum: ["game", "movie", "software", "music", "mixed", "other"] },
    title: {
      type: "STRING",
      nullable: true,
      description:
        "The specific identified game/movie/software/song/album title, e.g. 'Half-Life 2'. Null if not confidently a single item.",
    },
    platform: {
      type: "STRING",
      nullable: true,
      description: "Contextual to contentType, e.g. 'PlayStation 2' or 'Windows' for a game/software, 'DVD video' for a movie.",
    },
    publisher: { type: "STRING", nullable: true },
    developer: { type: "STRING", nullable: true, description: "Games/software only." },
    year: { type: "STRING", nullable: true, description: "Original release year of the identified title." },
    genres: {
      type: "ARRAY",
      items: { type: "STRING" },
      description:
        "The most relevant descriptive tags for what this item actually is, e.g. ['Comedy'] for a comedy movie, " +
        "['Action', 'Adventure'] for an action game, ['Rock'] for a rock album. Used to group and browse items later, " +
        "so prefer a specific, recognizable genre/style over a generic one whenever you can.",
    },
    description: { type: "STRING", description: "2-4 sentences about the identified title, from your own knowledge of it." },
    label: { type: "STRING", description: "A short (2-5 word) fallback label, e.g. 'Movie collection' or 'Software installers'." },
    summary: { type: "STRING", description: "One sentence on what this item/folder mostly contains and why." },
    confidence: { type: "STRING", enum: ["low", "medium", "high"] },
  },
  required: ["path", "contentType", "title", "label", "summary", "confidence"],
};

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    discTitle: {
      type: "STRING",
      nullable: true,
      description:
        "A short (under 60 characters) suggested title for the whole disc: the identified title itself if there's one dominant " +
        "item (e.g. 'Half-Life 2'), or a concise descriptive name if it holds several unrelated items (e.g. 'PS2 Game " +
        "Collection', 'Family Vacation Movies'). Null only if nothing meaningful can be suggested.",
    },
    items: { type: "ARRAY", items: ITEM_SCHEMA },
  },
  required: ["items"],
};

function buildPrompt(input: DiscAiSummary): string {
  return [
    "You are identifying the contents of an optical disc from a home backup catalog, using only its",
    "complete folder and file name/path listing below — you do not have access to file contents.",
    "",
    "A disc commonly holds SEVERAL distinct items: several games, a movie plus extras, a handful of",
    "installers. Use the full folder listing (every folder path on the disc, at every depth) to find",
    "the natural boundaries between items — a game or movie's own folder, however deep it's nested —",
    "and the file listing to confirm what each one actually is (installer/executable names, movie-rip",
    "naming conventions, etc.). Return ONE array entry per identified item, with `path` set to the",
    "single folder path (copied exactly from the folder listing below) that best represents that item —",
    "usually its own top-level or nearest-common-ancestor folder, not an individual file. When you",
    'recognize a specific title this way, set contentType to "game", "movie", "software" or "music", put',
    "its name in `title`, and fill in the detail fields (platform, publisher, developer, year, genres,",
    "description) from your own knowledge of that title.",
    "",
    "If the whole disc is clearly just one thing with no meaningful subdivision, return a single entry",
    'with `path` set to "". For folders that don\'t correspond to any single identifiable title, either',
    'leave them out or return an entry with contentType "mixed" or "other" and `title` null — never',
    "guess a title you aren't reasonably confident about. Always return at least one entry.",
    "",
    'Always fill in `label` (a short 2-5 word fallback category, e.g. "Movie collection", "Software',
    'installers", "Family photos", "Mixed archive") and `summary` (one sentence on what that item/folder',
    "mostly contains) on every entry, regardless of whether a single title was identified.",
    "",
    'Content categories are open-ended beyond game/movie/software: use "music" for standalone songs or',
    "albums. Whatever the type, also fill `genres` on every entry with the most specific, recognizable",
    'tags for it (e.g. ["Comedy"] for a comedy movie, ["Action", "Adventure"] for an action game, ["Rock"]',
    "for a rock album) rather than leaving it generic — that's what lets items be grouped and browsed by",
    "genre later, the same way `contentType` groups them by kind.",
    "",
    "Also suggest a top-level `discTitle` for the whole disc: reuse the identified title itself if one item",
    'clearly dominates (e.g. "Half-Life 2"), or a short descriptive name otherwise (e.g. "PS2 Game',
    'Collection", "Family Vacation Movies"). Leave it null only if you can\'t suggest anything meaningful.',
    "",
    `Current disc title: ${input.title ?? input.label ?? "(untitled)"}`,
    `Media type: ${input.mediaType ?? "unknown"}`,
    `Total: ${input.folderCount} folders, ${input.fileCount} files, ${Math.round(input.totalKb / 1024)} MB`,
    `Extensions by file count: ${input.extensions.map((e) => `${e.ext || "(no extension)"}=${e.files}`).join(", ") || "(none)"}`,
    "",
    "All folder paths on this disc:",
    input.allFolderPaths.join("\n") || "(none)",
    "",
    "All file paths on this disc:",
    input.allFilePaths.join("\n") || "(none)",
  ].join("\n");
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

interface RawResponse {
  discTitle?: string | null;
  items?: Partial<DiscItemDraft>[];
}

export interface IdentifyResult {
  /** The exact text Gemini returned, stored verbatim before any parsing/validation — kept as an audit trail. */
  raw: string;
  discTitle: string | null;
  items: DiscItemDraft[];
}

export interface GeminiModelInfo {
  /** Bare model id, e.g. "gemini-3.6-flash" (the "models/" prefix Google returns is stripped). */
  name: string;
  displayName: string;
  /** The one model `pickRecommendedGeminiModel` would default to among the returned list. */
  recommended: boolean;
}

interface ListModelsResponse {
  models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
}

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Model listing/filtering mirrors the sibling `pdf_xl` project's `gemini_status()` /
 * `_gemini_usable()` (extract_policies.py) — same three static checks, then the same kind of live
 * per-model ping before anything reaches the UI, so both apps agree on what "usable" means for a key.
 */

/** Non-Gemini families (embeddings, Imagen, Veo, AQA, …) never reach here — they lack `generateContent`
 * and/or "gemini" in their name — so this only needs to catch non-text *Gemini*-branded models. */
const GEMINI_NON_TEXT_KEYWORDS = ["tts", "image", "robotics", "computer-use", "lyria", "omni"];

/** Older generations are retired; keep this in sync with pdf_xl's `_GEMINI_MIN_VERSION`. */
const GEMINI_MIN_VERSION = 2.5;

/** True when a listed Gemini model can serve this app's text-only classification prompts. */
export function isUsableTextModel(model: { name: string; supportedGenerationMethods?: string[] }): boolean {
  const name = model.name.replace(/^models\//, "");
  const lower = name.toLowerCase();
  if (!lower.includes("gemini")) return false;
  if (!model.supportedGenerationMethods?.includes("generateContent")) return false;
  if (GEMINI_NON_TEXT_KEYWORDS.some((kw) => lower.includes(kw))) return false;
  // Versionless aliases (gemini-flash-latest, gemini-pro-latest) are always current, so keep them.
  const version = /gemini-(\d+(?:\.\d+)?)/.exec(lower);
  return !version || Number(version[1]) >= GEMINI_MIN_VERSION;
}

/**
 * Picks the model to default to: `gemini-flash-latest` if present, else the highest-versioned
 * `gemini-X[.Y]-flash`, else `gemini-2.5-flash`, else any other non-lite/preview/exp/8b/thinking
 * flash model, else just the first one — flash is the sweet spot of cost/latency for this app's
 * short classification prompts. Mirrors pdf_xl's `_recommended_gemini`.
 */
export function pickRecommendedGeminiModel(names: string[]): string {
  if (names.includes("gemini-flash-latest")) return "gemini-flash-latest";
  let best = "";
  let bestVersion = -1;
  for (const name of names) {
    const m = /^gemini-(\d+(?:\.\d+)?)-flash$/.exec(name);
    if (m) {
      const version = Number(m[1]);
      if (version > bestVersion) {
        best = name;
        bestVersion = version;
      }
    }
  }
  if (best) return best;
  if (names.includes("gemini-2.5-flash")) return "gemini-2.5-flash";
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.includes("flash") && !["lite", "preview", "exp", "8b", "thinking"].some((kw) => lower.includes(kw))) return name;
  }
  return names[0] ?? "";
}

/** Runs `fn` over `items` with at most `limit` in flight at once, preserving input order in the result. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** At most this many models are live-checked in parallel, to avoid bursting a free-tier key's rate limit. */
const MODEL_CHECK_CONCURRENCY = 10;
const MODEL_CHECK_TIMEOUT_MS = 3500;

/**
 * Pings a model with a trivial `generateContent` call (`maxOutputTokens: 1`, to spend as little of
 * the key's quota as possible) to confirm it actually answers right now — `models.list` only
 * describes what a model *claims* to support; it still lists models this key isn't allow-listed for,
 * or ones quietly retired, and only a real call reveals that. Only a clear 404 (no such model) or 503
 * (currently overloaded) means "not usable"; every other response — including a rate limit — counts as
 * usable, and a network failure/timeout excludes it. Mirrors pdf_xl's `_works()` exactly.
 */
async function checkModelAvailable(apiKey: string, model: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      `${GEMINI_API_BASE}/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: "1" }] }], generationConfig: { maxOutputTokens: 1 } }),
      },
      MODEL_CHECK_TIMEOUT_MS,
    );
    return response.status !== 404 && response.status !== 503;
  } catch {
    return false;
  }
}

/** Lists the text-in/text-out Gemini models this API key can actually use for classification right now. */
export async function listGeminiModels(apiKey: string): Promise<GeminiModelInfo[]> {
  const response = await fetch(`${GEMINI_API_BASE}/models?pageSize=100`, { headers: { "x-goog-api-key": apiKey } });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gemini request failed (${response.status}): ${body.slice(0, 200) || response.statusText}`);
  }
  const data = (await response.json()) as ListModelsResponse;
  const candidates = (data.models ?? []).filter(isUsableTextModel).map((m) => ({ ...m, name: m.name.replace(/^models\//, "") }));
  const available = await mapWithConcurrency(candidates, MODEL_CHECK_CONCURRENCY, (m) => checkModelAvailable(apiKey, m.name));
  const names = candidates.filter((_, i) => available[i]);
  // Flash models first — cheap and plenty for this app's field-extraction-sized prompts.
  names.sort((a, b) => {
    const af = !a.name.toLowerCase().includes("flash");
    const bf = !b.name.toLowerCase().includes("flash");
    return af === bf ? a.name.localeCompare(b.name) : af ? 1 : -1;
  });
  const recommended = pickRecommendedGeminiModel(names.map((m) => m.name));
  return names.map((m) => ({ name: m.name, displayName: m.displayName ?? m.name, recommended: m.name === recommended }));
}

/** Calls Gemini directly from the browser with the user's own key — see `ai/gemini-key.ts`. */
export async function identifyDiscItems(
  apiKey: string,
  input: DiscAiSummary,
  model: string = DEFAULT_GEMINI_MODEL,
  onLog?: (msg: string) => void,
): Promise<IdentifyResult> {
  const url = endpointFor(model);
  onLog?.(`[HTTP Request] POST ${url}`);
  const start = Date.now();
  const response = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
    }),
  });
  const duration = Date.now() - start;
  onLog?.(`[HTTP Response] POST ${url} - Status ${response.status} (${duration}ms)`);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gemini request failed (${response.status}): ${body.slice(0, 200) || response.statusText}`);
  }
  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");
  const parsed = JSON.parse(text) as RawResponse;
  if (!parsed || !Array.isArray(parsed.items)) throw new Error("Gemini returned an unexpected response shape");

  const knownPaths = new Set(input.allFolderPaths.map((f) => f.toLowerCase()));
  const analyzedAt = new Date().toISOString();
  const items = parsed.items.map((item) => {
    if (!item.contentType || !item.label || !item.summary || !item.confidence) throw new Error("Gemini returned an unexpected item shape");
    const path = item.path && (item.path === "" || knownPaths.has(item.path.toLowerCase())) ? item.path : "";
    return {
      path,
      contentType: item.contentType,
      title: item.title ?? null,
      platform: item.platform ?? null,
      publisher: item.publisher ?? null,
      developer: item.developer ?? null,
      year: item.year ?? null,
      genres: item.genres ?? [],
      description: item.description ?? "",
      label: item.label,
      summary: item.summary,
      confidence: item.confidence,
      model,
      analyzedAt,
    };
  });
  return { raw: text, discTitle: parsed.discTitle?.trim() || null, items };
}

const ICON_REQUEST_TIMEOUT_MS = 20_000;

/**
 * Asks Gemini to generate a clean, modern, minimalist SVG path representation
 * of a specific title category or genre.
 */
export async function generateIconPath(
  apiKey: string,
  name: string,
  type: "title" | "genre",
  model: string = DEFAULT_GEMINI_MODEL,
): Promise<string> {
  const prompt = [
    `You are a professional vector icon designer. Generate a clean, modern, minimalist SVG path (specifically the string for the 'd' attribute of a <path> element) that beautifully and recognizably represents the ${type}: ${JSON.stringify(name)}.`,
    "",
    "Rules for the SVG path:",
    '1. Designed for a 24x24 viewBox (viewBox="0 0 24 24")',
    '2. It must be stroke-based: fill="none", stroke="currentColor", strokeWidth={1.7}, strokeLinecap="round", strokeLinejoin="round"',
    "3. It must be a single cohesive line-art icon. It must look professional, clean, balanced, and recognizable.",
    "4. All coordinate values MUST stay strictly within the 1 to 23 range (keep a 1-2px margin from the border).",
    "5. Avoid extremely complex paths. Keep it elegant and simple, like a Lucide or Feather icon.",
    "6. You MUST return ONLY the SVG path 'd' attribute string in the 'path' field of the JSON. Do not include any HTML tags, <svg> tags, <path> wrappers, or markdown.",
    "",
    "Return the result matching the response schema.",
  ].join("\n");

  const response = await fetchWithTimeout(
    endpointFor(model),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              path: {
                type: "STRING",
                description:
                  "A single SVG path 'd' string (e.g. 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5'). Keep coordinates in 1-23 range.",
              },
            },
            required: ["path"],
          },
        },
      }),
    },
    ICON_REQUEST_TIMEOUT_MS,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gemini request failed (${response.status}): ${body.slice(0, 200) || response.statusText}`);
  }

  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");
  const parsed = JSON.parse(text) as { path?: string };
  if (!parsed.path) throw new Error("Gemini response missing 'path' property");

  return parsed.path.trim();
}
