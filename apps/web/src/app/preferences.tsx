import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

/** §8 screen 9 "Preferences": simple client-only settings, persisted in localStorage. */
export interface Preferences {
  sizeUnits: "decimal" | "binary";
  dateFormat: "iso" | "us" | "long";
  defaultSearchScope: "Files" | "Folders" | "Both";
  showDriveLetter: boolean;
  liteMode: boolean;
  localOnly: boolean;
  wifiOnly: boolean;
}

const DEFAULTS: Preferences = {
  sizeUnits: "decimal",
  dateFormat: "iso",
  defaultSearchScope: "Files",
  showDriveLetter: false,
  liteMode: false,
  localOnly: false,
  wifiOnly: true,
};

const STORAGE_KEY = "discvault:preferences";

function readInitial(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

interface PreferencesContextValue {
  prefs: Preferences;
  setPref: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(readInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Preference just won't persist across reloads.
    }
  }, [prefs]);

  const setPref = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  }, []);

  return <PreferencesContext.Provider value={{ prefs, setPref }}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used inside PreferencesProvider");
  return ctx;
}
