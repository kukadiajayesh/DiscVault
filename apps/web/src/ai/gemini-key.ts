const LEGACY_KEY_STORAGE = "discvault:gemini-api-key";
const KEYS_STORAGE = "discvault:gemini-api-keys";
const ACTIVE_KEY_STORAGE = "discvault:gemini-active-key-id";
const MODEL_STORAGE_KEY = "discvault:gemini-model";

/** Fast, cheap model — plenty for a short classification and friendly to Gemini's free tier. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

/**
 * One Gemini API key the user has added on this device (a free one from
 * https://aistudio.google.com/apikey), used only for on-demand disc classification (§ AI). Kept in
 * `localStorage` on this device only — never synced, never sent anywhere but Google's API — so this
 * lives next to `local-accounts.ts` and `preferences.tsx` rather than in the synced vault DB.
 *
 * A user can add several (e.g. a personal and a work key, or a spare for when one hits its daily
 * quota), but exactly one is ever *active* — every AI call uses that one key; switching which is
 * active is a manual choice in Settings, not automatic failover.
 */
export interface GeminiApiKeyEntry {
  id: string;
  label: string;
  key: string;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `k${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  }
}

function readKeys(): GeminiApiKeyEntry[] {
  try {
    const raw = localStorage.getItem(KEYS_STORAGE);
    if (raw) return JSON.parse(raw) as GeminiApiKeyEntry[];
    // One-time migration from the single-key era: fold the old value into the new list and drop it.
    const legacy = localStorage.getItem(LEGACY_KEY_STORAGE);
    if (!legacy) return [];
    const entry: GeminiApiKeyEntry = { id: newId(), label: "Default", key: legacy };
    localStorage.setItem(KEYS_STORAGE, JSON.stringify([entry]));
    localStorage.setItem(ACTIVE_KEY_STORAGE, entry.id);
    localStorage.removeItem(LEGACY_KEY_STORAGE);
    return [entry];
  } catch {
    return [];
  }
}

function writeKeys(keys: GeminiApiKeyEntry[]): void {
  try {
    localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys));
  } catch {
    // Private browsing or storage disabled: the change just won't persist across reloads.
  }
}

/** Every Gemini API key added on this device, oldest first. */
export function listGeminiApiKeys(): GeminiApiKeyEntry[] {
  return readKeys();
}

/** Adds a new key and returns it. The very first key added becomes active automatically. */
export function addGeminiApiKey(key: string, label?: string): GeminiApiKeyEntry {
  const keys = readKeys();
  const entry: GeminiApiKeyEntry = { id: newId(), label: label?.trim() || `Key ${keys.length + 1}`, key: key.trim() };
  writeKeys([...keys, entry]);
  if (!getActiveGeminiKeyId()) setActiveGeminiKeyId(entry.id);
  return entry;
}

/** Removes a key. If it was the active one, the next remaining key (if any) becomes active. */
export function removeGeminiApiKey(id: string): void {
  const keys = readKeys().filter((k) => k.id !== id);
  writeKeys(keys);
  if (getActiveGeminiKeyId() === id) setActiveGeminiKeyId(keys[0]?.id ?? null);
}

export function renameGeminiApiKey(id: string, label: string): void {
  const trimmed = label.trim();
  if (!trimmed) return;
  writeKeys(readKeys().map((k) => (k.id === id ? { ...k, label: trimmed } : k)));
}

export function getActiveGeminiKeyId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY_STORAGE) || null;
  } catch {
    return null;
  }
}

export function setActiveGeminiKeyId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY_STORAGE, id);
    else localStorage.removeItem(ACTIVE_KEY_STORAGE);
  } catch {
    // Private browsing or storage disabled: falls back to the first key next load.
  }
}

/** The currently-active key's value, if any key has been added — what every AI call actually uses. */
export function getGeminiApiKey(): string | null {
  const keys = readKeys();
  if (keys.length === 0) return null;
  const active = keys.find((k) => k.id === getActiveGeminiKeyId()) ?? keys[0];
  return active?.key || null;
}

/** The model used for on-demand disc classification. Stored next to the API keys, same rules. */
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
