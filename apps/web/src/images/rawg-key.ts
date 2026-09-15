const KEYS_STORAGE = "discvault:rawg-api-keys";
const ACTIVE_KEY_STORAGE = "discvault:rawg-active-key-id";

/**
 * One RAWG API key the user has added on this device (a free one from https://rawg.io/apidocs),
 * used only to look up a game's cover art after AI identification (§ image preview). Optional —
 * games just get no preview image without one. Kept in `localStorage` on this device only, same
 * rules as `ai/gemini-key.ts`.
 */
export interface RawgApiKeyEntry {
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

function readKeys(): RawgApiKeyEntry[] {
  try {
    const raw = localStorage.getItem(KEYS_STORAGE);
    return raw ? (JSON.parse(raw) as RawgApiKeyEntry[]) : [];
  } catch {
    return [];
  }
}

function writeKeys(keys: RawgApiKeyEntry[]): void {
  try {
    localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys));
  } catch {
    // Private browsing or storage disabled: the change just won't persist across reloads.
  }
}

/** Every RAWG API key added on this device, oldest first. */
export function listRawgApiKeys(): RawgApiKeyEntry[] {
  return readKeys();
}

/** Adds a new key and returns it. The very first key added becomes active automatically. */
export function addRawgApiKey(key: string, label?: string): RawgApiKeyEntry {
  const keys = readKeys();
  const entry: RawgApiKeyEntry = { id: newId(), label: label?.trim() || `Key ${keys.length + 1}`, key: key.trim() };
  writeKeys([...keys, entry]);
  if (!getActiveRawgKeyId()) setActiveRawgKeyId(entry.id);
  return entry;
}

/** Removes a key. If it was the active one, the next remaining key (if any) becomes active. */
export function removeRawgApiKey(id: string): void {
  const keys = readKeys().filter((k) => k.id !== id);
  writeKeys(keys);
  if (getActiveRawgKeyId() === id) setActiveRawgKeyId(keys[0]?.id ?? null);
}

export function renameRawgApiKey(id: string, label: string): void {
  const trimmed = label.trim();
  if (!trimmed) return;
  writeKeys(readKeys().map((k) => (k.id === id ? { ...k, label: trimmed } : k)));
}

export function getActiveRawgKeyId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY_STORAGE) || null;
  } catch {
    return null;
  }
}

export function setActiveRawgKeyId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY_STORAGE, id);
    else localStorage.removeItem(ACTIVE_KEY_STORAGE);
  } catch {
    // Private browsing or storage disabled: falls back to the first key next load.
  }
}

/** The currently-active key's value, or null if no key has been added — image lookup for games is skipped without one. */
export function getRawgApiKey(): string | null {
  const keys = readKeys();
  if (keys.length === 0) return null;
  const active = keys.find((k) => k.id === getActiveRawgKeyId()) ?? keys[0];
  return active?.key || null;
}
