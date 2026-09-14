const STORAGE_KEY = "discvault:gemini-api-key";
const MODEL_STORAGE_KEY = "discvault:gemini-model";

/** Fast, cheap model — plenty for a short classification and friendly to Gemini's free tier. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

/**
 * The user's own Gemini API key (a free one from https://aistudio.google.com/apikey), used only
 * for on-demand disc classification (§ AI). Kept in `localStorage` on this device only — never
 * synced, never sent anywhere but Google's API — so it lives next to `local-accounts.ts` and
 * `preferences.tsx` rather than in the synced vault DB.
 */
export function getGeminiApiKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function setGeminiApiKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing or storage disabled: the key just won't persist across reloads.
  }
}

/** The model used for on-demand disc classification. Stored next to the API key, same rules. */
export function getGeminiModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) || DEFAULT_GEMINI_MODEL;
  } catch {
    return DEFAULT_GEMINI_MODEL;
  }
}

export function setGeminiModel(model: string | null): void {
  try {
    if (model && model !== DEFAULT_GEMINI_MODEL) localStorage.setItem(MODEL_STORAGE_KEY, model);
    else localStorage.removeItem(MODEL_STORAGE_KEY);
  } catch {
    // Private browsing or storage disabled: falls back to the default next load.
  }
}
