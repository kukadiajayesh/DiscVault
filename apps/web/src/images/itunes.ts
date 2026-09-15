import { fetchWithTimeout } from "../lib/fetch-timeout.js";

const ITUNES_TIMEOUT_MS = 8000;

interface ItunesSearchResponse {
  results?: { artworkUrl100?: string | null }[];
}

/**
 * Looks up software/music artwork on Apple's iTunes Search API — no key needed, CORS-friendly for
 * direct browser calls. Never throws: a non-ok response, empty result set or network
 * failure/timeout just means "no image found", not an error the caller has to handle.
 */
export async function searchItunesArtwork(title: string, media: "software" | "music"): Promise<string | null> {
  try {
    const params = new URLSearchParams({ term: title, media, limit: "1" });
    const response = await fetchWithTimeout(`https://itunes.apple.com/search?${params}`, {}, ITUNES_TIMEOUT_MS);
    if (!response.ok) return null;
    const data = (await response.json()) as ItunesSearchResponse;
    const artwork = data.results?.[0]?.artworkUrl100;
    // The default 100x100 thumbnail is tiny; every size in between is served from the same URL shape.
    return artwork ? artwork.replace("100x100", "600x600") : null;
  } catch {
    return null;
  }
}
