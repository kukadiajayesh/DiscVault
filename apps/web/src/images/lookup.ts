import type { DiscContentType } from "../ai/classification.js";
import { searchItunesArtwork } from "./itunes.js";
import { searchRawgImage } from "./rawg.js";
import { getRawgApiKey } from "./rawg-key.js";
import { searchTmdbPoster } from "./tmdb.js";
import { getTmdbApiKey } from "./tmdb-key.js";

export interface PreviewImageQuery {
  contentType: DiscContentType;
  title: string | null;
  year: string | null;
}

/**
 * Resolves a "live" preview-image URL for one AI-identified item, from a real external provider —
 * Gemini's own answer has no web access, so it can't supply one (§ image preview). Routed by
 * `contentType`: movies via TMDB, games via RAWG (both need a free user-supplied key, skipped
 * silently without one), software/music via Apple's iTunes Search (no key needed). Never throws:
 * every provider call already swallows its own failures, and this is one more defensive layer in
 * case that ever changes — a lookup failure must never block saving the item's other metadata.
 */
export async function lookupPreviewImage(item: PreviewImageQuery, onLog?: (msg: string) => void): Promise<string | null> {
  if (!item.title) return null;
  try {
    // `return await`, not a bare `return`, so a rejection from any of these — none should ever
    // reject given their own internal never-throw contracts, but this is the defensive layer for
    // if that ever changes — actually lands in this function's own `catch` below.
    switch (item.contentType) {
      case "movie": {
        const key = getTmdbApiKey();
        if (key) {
          onLog?.(`[HTTP Request] GET https://api.themoviedb.org/3/search/movie (query="${item.title}")`);
          const start = Date.now();
          const res = await searchTmdbPoster(key, item.title, item.year);
          const duration = Date.now() - start;
          onLog?.(`[HTTP Response] GET https://api.themoviedb.org/3/search/movie - ${res ? "Success" : "No match"} (${duration}ms)`);
          return res;
        }
        onLog?.(`[Skip] TMDB movie search skipped (no TMDB API key configured)`);
        return null;
      }
      case "game": {
        const key = getRawgApiKey();
        if (key) {
          onLog?.(`[HTTP Request] GET https://api.rawg.io/api/games (query="${item.title}")`);
          const start = Date.now();
          const res = await searchRawgImage(key, item.title);
          const duration = Date.now() - start;
          onLog?.(`[HTTP Response] GET https://api.rawg.io/api/games - ${res ? "Success" : "No match"} (${duration}ms)`);
          return res;
        }
        onLog?.(`[Skip] RAWG game search skipped (no RAWG API key configured)`);
        return null;
      }
      case "software": {
        onLog?.(`[HTTP Request] GET https://itunes.apple.com/search (query="${item.title}", media="software")`);
        const start = Date.now();
        const res = await searchItunesArtwork(item.title, "software");
        const duration = Date.now() - start;
        onLog?.(`[HTTP Response] GET https://itunes.apple.com/search - ${res ? "Success" : "No match"} (${duration}ms)`);
        return res;
      }
      case "music": {
        onLog?.(`[HTTP Request] GET https://itunes.apple.com/search (query="${item.title}", media="music")`);
        const start = Date.now();
        const res = await searchItunesArtwork(item.title, "music");
        const duration = Date.now() - start;
        onLog?.(`[HTTP Response] GET https://itunes.apple.com/search - ${res ? "Success" : "No match"} (${duration}ms)`);
        return res;
      }
      default:
        return null;
    }
  } catch (err) {
    onLog?.(`[Error] Lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
