/** Stroke icon paths lifted from the design's `ICON` map (24x24 viewBox, stroke=currentColor). */
export const ICON_PATH = {
  Dashboard: "M4 4h6.4v6.4H4zM13.6 4H20v6.4h-6.4zM4 13.6h6.4V20H4zM13.6 13.6H20V20h-6.4z",
  Search: "M10.6 4a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 0 0 0-13.2M15.4 15.4 20 20",
  Discs: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2",
  "Add disc": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8.2v7.6M8.2 12h7.6",
  Settings:
    "M3.5 6.5h17M3.5 12h17M3.5 17.5h17M15 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M9 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M16.5 16a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3",
  Sync: "M4.6 12a7.4 7.4 0 0 1 12.6-5.2M19.4 12a7.4 7.4 0 0 1-12.6 5.2M17.2 3.2v3.6h-3.6M6.8 20.8v-3.6h3.6",
  Duplicates: "M9 4.5h10.5V15M4.5 9h11v10.5h-11z",
  Stats: "M4.5 19.5h15M7.6 16.6v-5.2M12 16.6V7.4M16.4 16.6v-3.4",
  Collections: "M12 3.5 20.5 8 12 12.5 3.5 8zM3.5 12.2 12 16.7l8.5-4.5M3.5 16.2 12 20.7l8.5-4.5",
  Locations: "M12 20.8c0-.1 6.4-6 6.4-10.4a6.4 6.4 0 1 0-12.8 0c0 4.4 6.4 10.3 6.4 10.4M12 8.3a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4",
  Health: "M3.5 12h4l2-4.6 3.2 9.2 2-4.6h5.8",
  Home: "M4 10.6 12 4l8 6.6V19.6h-5.6v-6h-4.8v6H4z",
  More: "M5.6 12a.9.9 0 1 0 1.8 0 .9.9 0 1 0-1.8 0M11.1 12a.9.9 0 1 0 1.8 0 .9.9 0 1 0-1.8 0M16.6 12a.9.9 0 1 0 1.8 0 .9.9 0 1 0-1.8 0",
  Logout: "M9 4.5H5.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H9M15.5 16.5 20 12l-4.5-4.5M20 12H9",
  Account: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  Preferences: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 12h6",
  Categories: "M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 3h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z",
  AI: "M12 22c0-5.523-4.477-10-10-10 5.523 0 10-4.477 10-10 0 5.523 4.477 10 10 10-5.523 0-10 4.477-10 10z",
  Import: "M21 16l-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16",
  Copy: "M11 9H20A2 2 0 0 1 22 11V20A2 2 0 0 1 20 22H11A2 2 0 0 1 9 20V11A2 2 0 0 1 11 9ZM5 15H4A2 2 0 0 1 2 13V4A2 2 0 0 1 4 2H13A2 2 0 0 1 15 4V5",
} as const;

export type IconName = keyof typeof ICON_PATH;

export function Icon({ name, size = 17, color = "currentColor" }: { name: IconName; size?: number; color?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ flex: "none", color }}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATH[name]} />
    </svg>
  );
}

export function SearchGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} style={{ flex: "none", color: "var(--dv-text-3)" }} aria-hidden="true">
      <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
