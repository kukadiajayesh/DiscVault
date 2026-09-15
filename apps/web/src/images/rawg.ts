import { fetchWithTimeout } from "../lib/fetch-timeout.js";

const RAWG_TIMEOUT_MS = 8000;

interface RawgSearchResponse {
  results?: { background_image?: string | null }[];
}

/**
 * Looks up a game's cover/background art on RAWG (rawg.io) — free API key. Never throws: any
 * missing key, non-ok response, empty result set or network failure/timeout just means "no image
 * found", not an error the caller has to handle.
 */
export async function searchRawgImage(apiKey: string, title: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ key: apiKey, search: title, page_size: "1" });
    const response = await fetchWithTimeout(`https://api.rawg.io/api/games?${params}`, {}, RAWG_TIMEOUT_MS);
    if (!response.ok) return null;
    const data = (await response.json()) as RawgSearchResponse;
    return data.results?.[0]?.background_image ?? null;
  } catch {
    return null;
  }
}
