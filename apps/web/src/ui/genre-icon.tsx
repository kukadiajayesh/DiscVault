import { useEffect, useSyncExternalStore } from "react";
import { generateIconPath } from "../ai/gemini.js";
import { getGeminiApiKey, getGeminiModel } from "../ai/gemini-key.js";

export type IconKind = "title" | "genre";

/**
 * Hand-picked stroke paths (24x24 viewBox, Feather/Lucide style) for the fixed title categories and the
 * genres the AI tags most often. Keys are `normalizeIconName` output. Anything that resolves here never
 * costs a Gemini call, so it's worth covering the common cases generously.
 */
const STATIC_ICONS: Record<string, string> = {
  // Title categories (matched by their display label)
  games:
    "M6 12h4M8 10v4M15 13h.01M18 11h.01M17.32 5H6.68a4 4 0 0 0-3.978 3.59C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z",
  movies:
    "M4.18 2h15.64A2.18 2.18 0 0 1 22 4.18v15.64A2.18 2.18 0 0 1 19.82 22H4.18A2.18 2.18 0 0 1 2 19.82V4.18A2.18 2.18 0 0 1 4.18 2zM7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5",
  software: "M4 17l6-6-6-6M12 19h8",
  songs: "M9 18V5l12-2v13M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  mixed: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  other: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",

  // Common genres
  action: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  adventure: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z",
  animation:
    "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12",
  comedy: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01",
  documentary: "M23 7l-7 5 7 5V7zM3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  drama: "M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z",
  education: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
  family: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  fantasy: "M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h.01M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5",
  fighting: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  horror: "M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z",
  "hip hop": "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
  music: "M9 18V5l12-2v13M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  mystery: "M10.6 4a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 0 0 0-13.2M15.4 15.4L20 20",
  "operating system": "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 21h8M12 17v4",
  productivity: "M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",
  programming: "M16 18l6-6-6-6M8 6l-6 6 6 6",
  racing: "M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0",
  romance:
    "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z",
  rpg: "M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2",
  "sci fi":
    "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2zM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",
  security: "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4",
  shooter: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM22 12h-4M6 12H2M12 6V2M12 22v-4",
  sports:
    "M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2z",
  spy: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  technology:
    "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3",
  thriller: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  utility:
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  war: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7",
};

/** Other spellings the AI uses for the same idea, mapped onto a `STATIC_ICONS` key. */
const ICON_ALIASES: Record<string, string> = {
  anime: "animation",
  cartoon: "animation",
  business: "productivity",
  office: "productivity",
  children: "family",
  kids: "family",
  coding: "programming",
  development: "programming",
  detective: "mystery",
  educational: "education",
  learning: "education",
  fps: "shooter",
  "first person shooter": "shooter",
  "martial arts": "fighting",
  os: "operating system",
  rap: "hip hop",
  "role playing": "rpg",
  "role playing game": "rpg",
  scifi: "sci fi",
  "science fiction": "sci fi",
  space: "sci fi",
  sport: "sports",
  suspense: "thriller",
  tools: "utility",
  utilities: "utility",
  antivirus: "security",
  military: "war",
};

/** Placeholder shown while a generated icon is on its way, or when none can be generated. */
const SPARKLE_ICON_PATH = "M12 22c0-5.523-4.477-10-10-10 5.523 0 10-4.477 10-10 0 5.523 4.477 10 10 10-5.523 0-10 4.477-10 10z";

/** Lowercase, punctuation-insensitive form, so "Sci-Fi", "sci fi" and "SCI_FI" all look the same. */
export function normalizeIconName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function staticKey(phrase: string): string | undefined {
  if (STATIC_ICONS[phrase]) return phrase;
  const alias = ICON_ALIASES[phrase];
  return alias && STATIC_ICONS[alias] ? alias : undefined;
}

/**
 * A hand-picked path for `name`, if any: the whole phrase first, then its individual words from last to
 * first — the last word is usually the noun ("Action RPG" → rpg, "Survival Horror" → horror).
 */
export function staticIconPath(name: string): string | undefined {
  const phrase = normalizeIconName(name);
  const whole = staticKey(phrase);
  if (whole) return STATIC_ICONS[whole];
  const words = phrase.split(" ");
  for (let i = words.length - 1; i >= 0; i--) {
    const key = staticKey(words[i] as string);
    if (key) return STATIC_ICONS[key];
  }
  return undefined;
}

const MAX_GENERATED_PATH_LENGTH = 1500;

/** Only accepts a plain SVG path `d` string (commands + numbers), so a chatty or malformed model reply never renders. */
export function isValidIconPath(path: string): boolean {
  return (
    path.length > 0 && path.length <= MAX_GENERATED_PATH_LENGTH && /^[Mm][MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]*$/.test(path) && /\d/.test(path)
  );
}

// --- Generated icon store -------------------------------------------------------------------------
// Module-level so every <GenreIcon> on screen shares one cache, one request queue and one failure state.

const CACHE_STORAGE_KEY = "discvault:generated-icons";
/** Gap before each Gemini call, so a page full of new genres doesn't burst a free-tier key's rate limit. */
const REQUEST_GAP_MS = 500;

let generatedCache: Map<string, string> | null = null;
const inflight = new Set<string>();
/** Names whose generated path was unusable — not retried until reload. */
const rejected = new Set<string>();
/** Set after any request error (bad key, quota, offline): stops further calls until reload rather than retrying on every mount. */
let halted = false;
let queue: Promise<void> = Promise.resolve();

let storeVersion = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getStoreVersion(): number {
  return storeVersion;
}

function notify(): void {
  storeVersion++;
  for (const listener of listeners) listener();
}

function cacheKeyFor(name: string, kind: IconKind): string {
  return `${kind}:${normalizeIconName(name)}`;
}

function readCache(): Map<string, string> {
  if (generatedCache) return generatedCache;
  generatedCache = new Map();
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    for (const [key, path] of Object.entries(stored)) {
      if (typeof path === "string" && isValidIconPath(path)) generatedCache.set(key, path);
    }
  } catch {
    // Private browsing or a corrupt entry: start with an empty cache.
  }
  return generatedCache;
}

function writeCache(cache: Map<string, string>): void {
  try {
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    // Private browsing or storage disabled: the icon just gets regenerated next session.
  }
}

function requestGeneratedIcon(name: string, kind: IconKind): void {
  const key = cacheKeyFor(name, kind);
  if (halted || inflight.has(key) || rejected.has(key) || readCache().has(key) || !getGeminiApiKey()) return;

  inflight.add(key);
  notify();
  queue = queue.then(async () => {
    try {
      // Re-read the key and model at run time: either may have changed in Settings while this waited.
      const apiKey = getGeminiApiKey();
      if (halted || !apiKey) return;
      await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
      const path = await generateIconPath(apiKey, name, kind, getGeminiModel());
      if (isValidIconPath(path)) {
        const cache = readCache();
        cache.set(key, path);
        writeCache(cache);
      } else {
        rejected.add(key);
      }
    } catch (err) {
      console.error(`Icon generation stopped after failing for ${key}:`, err);
      halted = true;
    } finally {
      inflight.delete(key);
      notify();
    }
  });
}

interface GenreIconProps {
  name: string;
  type: IconKind;
  size?: number;
  color?: string;
}

/**
 * Icon for a title category or AI genre tag: a hand-picked path when one matches, otherwise one generated by
 * Gemini (with the active key, one request at a time) and cached on this device. Shows a sparkle meanwhile.
 */
export function GenreIcon({ name, type, size = 20, color = "currentColor" }: GenreIconProps) {
  useSyncExternalStore(subscribe, getStoreVersion);

  const key = cacheKeyFor(name, type);
  const path = staticIconPath(name) ?? readCache().get(key);
  const pending = !path && inflight.has(key);

  useEffect(() => {
    if (!path) requestGeneratedIcon(name, type);
  }, [name, type, path]);

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ flex: "none", color, opacity: pending ? 0.6 : 1, transition: "opacity 0.2s ease" }}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path ?? SPARKLE_ICON_PATH} />
    </svg>
  );
}
