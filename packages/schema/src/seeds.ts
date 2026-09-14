/** Lookup rows shipped with the app (§5.3: new kinds are added as rows, never as CHECK changes). */

export const MEDIA_TYPES: { code: string; label: string; capacity_kb: number; sort_order: number }[] = [
  { code: "CD", label: "CD (700 MB)", capacity_kb: 720_000, sort_order: 10 },
  { code: "DVD5", label: "DVD-5 (4.7 GB)", capacity_kb: 4_590_208, sort_order: 20 },
  { code: "DVD9", label: "DVD-9 (8.5 GB)", capacity_kb: 8_343_424, sort_order: 30 },
  { code: "BD25", label: "Blu-ray (25 GB)", capacity_kb: 24_438_784, sort_order: 40 },
  { code: "BD50", label: "Blu-ray DL (50 GB)", capacity_kb: 48_877_568, sort_order: 50 },
];

export const DISC_STATUSES = [
  { code: "available", label: "Available" },
  { code: "on_loan", label: "On loan" },
  { code: "damaged", label: "Damaged" },
  { code: "lost", label: "Lost" },
  { code: "retired", label: "Retired" },
];

export const CATEGORIES = [
  { code: "video", label: "Video", icon: "film" },
  { code: "audio", label: "Audio", icon: "music" },
  { code: "image", label: "Image", icon: "image" },
  { code: "document", label: "Document", icon: "file-text" },
  { code: "archive", label: "Archive", icon: "archive" },
  { code: "software", label: "Software", icon: "app-window" },
  { code: "subtitle", label: "Subtitle", icon: "captions" },
  { code: "other", label: "Other", icon: "file" },
];

const EXTENSIONS: Record<string, string[]> = {
  video: [
    "avi",
    "mkv",
    "mp4",
    "m4v",
    "mov",
    "wmv",
    "mpg",
    "mpeg",
    "vob",
    "flv",
    "webm",
    "3gp",
    "ts",
    "m2ts",
    "divx",
    "rm",
    "rmvb",
    "ogm",
    "dat",
    "ifo",
    "bup",
  ],
  audio: ["mp3", "wav", "wma", "flac", "aac", "m4a", "ogg", "opus", "ac3", "dts", "mid", "midi", "amr", "ape"],
  image: ["jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "webp", "heic", "raw", "cr2", "nef", "ico", "psd", "svg"],
  document: [
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "txt",
    "rtf",
    "odt",
    "ods",
    "csv",
    "htm",
    "html",
    "chm",
    "epub",
    "nfo",
    "md",
    "xml",
  ],
  archive: ["zip", "rar", "7z", "gz", "tar", "bz2", "xz", "iso", "cab", "r00", "r01", "001"],
  software: ["exe", "msi", "dll", "apk", "dmg", "pkg", "deb", "bat", "cmd", "jar", "inf", "sys", "ini"],
  subtitle: ["srt", "sub", "idx", "ass", "ssa", "vtt"],
};

export const FILE_CATEGORY_DEFAULTS: { ext: string; category: string }[] = Object.entries(EXTENSIONS).flatMap(([category, exts]) =>
  exts.map((ext) => ({ ext, category })),
);

export function sqlLiteral(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

export function insertRows(table: string, rows: Record<string, string | number | null>[]): string[] {
  return rows.map((row) => {
    const cols = Object.keys(row);
    const values = cols.map((c) => sqlLiteral(row[c] ?? null));
    return `INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${values.join(", ")})`;
  });
}
