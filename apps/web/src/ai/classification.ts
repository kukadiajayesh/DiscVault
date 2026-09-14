export interface DiscClassification {
  label: string;
  summary: string;
  confidence: "low" | "medium" | "high";
}

export interface StoredClassification extends DiscClassification {
  model: string;
  analyzedAt: string;
}

/** Reads the AI classification out of a disc's `meta` JSON column (`disc.meta`), if present. */
export function readDiscClassification(metaJson: string | null): StoredClassification | null {
  if (!metaJson) return null;
  try {
    const meta = JSON.parse(metaJson) as { ai?: StoredClassification };
    return meta.ai ?? null;
  } catch {
    return null;
  }
}

/** Merges a fresh classification into a disc's existing `meta` JSON, ready for `writeRow`. */
export function mergeDiscClassification(metaJson: string | null, stored: StoredClassification): Record<string, unknown> {
  let meta: Record<string, unknown> = {};
  if (metaJson) {
    try {
      meta = JSON.parse(metaJson) as Record<string, unknown>;
    } catch {
      meta = {};
    }
  }
  return { ...meta, ai: stored };
}
