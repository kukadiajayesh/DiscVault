import { fetchWithTimeout } from "../lib/fetch-timeout.js";

const TMDB_TIMEOUT_MS = 8000;

interface TmdbSearchResponse {
  results?: { poster_path?: string | null }[];
}

/**
 * Looks up a movie's poster on TMDB (themoviedb.org) — free API key, no CORS issues for direct
 * browser calls. Never throws: any missing key, non-ok response, empty result set or network
 * failure/timeout just means "no image found", not an error the caller has to handle.
 */
export async function searchTmdbPoster(apiKey: string, title: string, year: string | null): Promise<string | null> {
  try {
    const params = new URLSearchParams({ query: title, api_key: apiKey });
    if (year) params.set("year", year);
    const response = await fetchWithTimeout(`https://api.themoviedb.org/3/search/movie?${params}`, {}, TMDB_TIMEOUT_MS);
    if (!response.ok) return null;
    const data = (await response.json()) as TmdbSearchResponse;
    const posterPath = data.results?.[0]?.poster_path;
    return posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : null;
  } catch {
    return null;
  }
}
