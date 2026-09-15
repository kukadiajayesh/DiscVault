export type DiscContentType = "game" | "movie" | "software" | "music" | "mixed" | "other";

/** One AI-identified item on a disc, not yet saved — Gemini's raw answer for one array entry. */
export interface DiscItemDraft {
  /** Top-level folder this item is anchored to, or "" for the whole disc. */
  path: string;
  contentType: DiscContentType;
  /** Specific identified title (e.g. "Half-Life 2"), or null when no single item was confident. */
  title: string | null;
  platform: string | null;
  publisher: string | null;
  developer: string | null;
  year: string | null;
  genres: string[];
  description: string;
  /** Fallback short label/summary, used when `title` is null (mixed/other items). */
  label: string;
  summary: string;
  confidence: "low" | "medium" | "high";
  model: string;
  analyzedAt: string;
}
