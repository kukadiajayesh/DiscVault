import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

export type Theme = "light" | "dark";
/** What the user picked in Settings; "system" follows the OS light/dark setting live. */
export type ThemePreference = Theme | "system";

/**
 * Only an explicit Light/Dark choice is stored. The old `discvault:theme` key saved whatever theme was
 * resolved on first load, so it can't tell a real choice from a default — it's dropped, and everyone
 * starts back on "system".
 */
const STORAGE_KEY = "discvault:theme-preference";
const LEGACY_STORAGE_KEY = "discvault:theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextValue {
  /** The theme actually applied right now. */
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPreference(): ThemePreference {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // localStorage unavailable (private browsing): follow the system.
  }
  return "system";
}

function systemTheme(): Theme {
  return typeof matchMedia !== "undefined" && matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme = preference === "system" ? system : preference;

  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const query = matchMedia(DARK_QUERY);
    const onChange = () => setSystem(query.matches ? "dark" : "light");
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-dv-theme", theme);
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#111113" : "#ffffff");
  }, [theme]);

  useEffect(() => {
    try {
      if (preference === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Preference just won't persist across reloads.
    }
  }, [preference]);

  const value = useMemo<ThemeContextValue>(() => ({ theme, preference, setPreference }), [theme, preference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
