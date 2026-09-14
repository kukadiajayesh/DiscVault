import type { DiscAiSummary } from "../db/catalog.js";
import type { StoredClassification } from "./classification.js";

/** Fast, cheap model — plenty for a short classification and friendly to Gemini's free tier. */
const MODEL = "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    label: { type: "STRING", description: "A short (2-5 word) category label, e.g. 'Movie collection' or 'Software installers'." },
    summary: { type: "STRING", description: "One sentence on what this disc mostly contains and why." },
    confidence: { type: "STRING", enum: ["low", "medium", "high"] },
  },
  required: ["label", "summary", "confidence"],
};

function buildPrompt(input: DiscAiSummary): string {
  return [
    "You are classifying an optical disc from a home backup catalog, using only its folder/file",
    "names, extensions and counts — you do not have access to file contents. Suggest a short",
    'category label for what this disc mostly contains (e.g. "Movie collection", "Software',
    'installers", "Family photos", "Source code backup", "Mixed archive").',
    "",
    `Disc title: ${input.title ?? input.label ?? "(untitled)"}`,
    `Media type: ${input.mediaType ?? "unknown"}`,
    `Total: ${input.folderCount} folders, ${input.fileCount} files, ${Math.round(input.totalKb / 1024)} MB`,
    `Top-level folder names: ${input.topFolders.join(", ") || "(none)"}`,
    `Extensions by file count: ${input.extensions.map((e) => `${e.ext || "(no extension)"}=${e.files}`).join(", ") || "(none)"}`,
    `Sample file names (largest files on the disc): ${input.sampleFileNames.join(", ") || "(none)"}`,
  ].join("\n");
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** Calls Gemini directly from the browser with the user's own key — see `ai/gemini-key.ts`. */
export async function classifyDiscWithGemini(apiKey: string, input: DiscAiSummary): Promise<StoredClassification> {
  const response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gemini request failed (${response.status}): ${body.slice(0, 200) || response.statusText}`);
  }
  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");
  const parsed = JSON.parse(text) as Partial<StoredClassification>;
  if (!parsed.label || !parsed.summary || !parsed.confidence) throw new Error("Gemini returned an unexpected response shape");
  return {
    label: parsed.label,
    summary: parsed.summary,
    confidence: parsed.confidence,
    model: MODEL,
    analyzedAt: new Date().toISOString(),
  };
}
