import { vaultWorker } from "../db/rpc.js";
import { lookupPreviewImage } from "../images/lookup.js";
import { identifyDiscItems } from "./gemini.js";
import { DEFAULT_GEMINI_MODEL, setGeminiModel } from "./gemini-key.js";

export interface AnalyzeDiscResult {
  itemCount: number;
  discTitle: string | null;
  /** Which model in the fallback chain actually produced this result. */
  model: string;
}

/**
 * Orders the models to try for one analysis: the preferred model first (tried even if it isn't in
 * `available` — the user picked it explicitly, e.g. by typing a custom id), then every other usable
 * model as a fallback chain (§ AI: disc identification) — so a preview model being overloaded or a
 * one-off 5xx doesn't fail the whole analysis when another model could've answered.
 */
export function buildModelFallbackChain(preferred: string, available: { name: string }[]): string[] {
  const pref = preferred.trim();
  const rest = available.map((m) => m.name).filter((n) => n !== pref);
  if (pref) return [pref, ...rest];
  return rest.length > 0 ? rest : [DEFAULT_GEMINI_MODEL];
}

/**
 * Runs one disc through Gemini and saves the result straight through, no manual review step
 * (§ AI: disc identification): the raw response is cached on the disc first, then the identified
 * items replace whatever the disc had before (so re-analyzing never duplicates them), then an empty
 * disc title is filled in from the AI's suggestion. Shared by the disc explorer's "Analyze with AI"
 * and the disc library's bulk "Analyze all with AI", so both save identically.
 *
 * Tries `opts.models` in order, falling through to the next one on failure, until one succeeds or
 * every model has been tried.
 */
export async function analyzeDiscWithAi(
  discNo: number,
  opts: { apiKey: string; models: string[]; hasTitle: boolean; onLog?: (msg: string) => void },
): Promise<AnalyzeDiscResult> {
  opts.onLog?.("Preparing file catalog metadata summary...");
  const summary = await vaultWorker().discAiSummary(discNo);
  if (!summary) throw new Error(`disc #${discNo} not found`);
  if (opts.models.length === 0) throw new Error("no Gemini model available to try");

  const failures: string[] = [];
  let result: Awaited<ReturnType<typeof identifyDiscItems>> | undefined;
  let usedModel: string | undefined;
  for (const model of opts.models) {
    try {
      opts.onLog?.(`Calling Gemini API via model: ${model}...`);
      result = await identifyDiscItems(opts.apiKey, summary, model);
      usedModel = model;
      break;
    } catch (err) {
      failures.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!result || !usedModel) {
    const list = opts.models.length > 1 ? `all ${opts.models.length} models failed` : "the model failed";
    throw new Error(`disc #${discNo}: ${list} —\n${failures.join("\n")}`);
  }
  opts.onLog?.("Gemini analysis successful! Parsing items...");
  setGeminiModel(usedModel);

  const analyzedAt = new Date().toISOString();
  await vaultWorker().saveDiscAiRaw(discNo, { model: usedModel, analyzedAt, response: result.raw });
  await vaultWorker().applyDiscItems(discNo, result.items);
  if (!opts.hasTitle && result.discTitle) await vaultWorker().setDiscTitle(discNo, result.discTitle);

  opts.onLog?.(`Identified ${result.items.length} item(s) on disc.`);
  return { itemCount: result.items.length, discTitle: result.discTitle, model: usedModel };
}

/**
 * Best-effort preview-image lookup and cache for every item just saved by `analyzeDiscWithAi`
 * (§ image preview). Runs after the items exist with real ids/titles. Never throws: a missing
 * provider key, no search match, or a network failure for one item must never fail the whole
 * analyze flow or block the others — each item is attempted independently.
 */
export async function fetchPreviewImagesForDisc(discNo: number, onLog?: (msg: string) => void): Promise<void> {
  const items = await vaultWorker().discItems(discNo);
  await Promise.all(
    items.map(async (item) => {
      try {
        const titleLabel = item.title ?? item.label;
        onLog?.(`Searching artwork for: "${titleLabel}" (${item.contentType})...`);
        const imageUrl = await lookupPreviewImage(item);
        await vaultWorker().setDiscItemImageUrl(item.id, imageUrl);
        if (imageUrl) {
          onLog?.(`Found artwork URL for: "${titleLabel}"`);
          onLog?.(`Downloading & caching artwork blob for: "${titleLabel}"...`);
          await vaultWorker().cacheDiscItemImage(item.id, imageUrl);
          onLog?.(`Successfully cached artwork for: "${titleLabel}"`);
        } else {
          onLog?.(`No artwork found for: "${titleLabel}"`);
        }
      } catch (err) {
        // one item's image failing must never affect its metadata or any other item
        onLog?.(`Error fetching artwork for item: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
}
