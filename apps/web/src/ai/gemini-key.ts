const STORAGE_KEY = "discvault:gemini-api-key";

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
