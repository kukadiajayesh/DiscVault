/**
 * Catalog paths are stored relative to the disc, with `/` separators and no drive letter:
 * `G:\Movies\Constantine\cd1.avi` → `Movies/Constantine/cd1.avi`.
 */
export function toRelPath(fullPath: string): string {
  return fullPath
    .replace(/^[A-Za-z]:/, "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export function joinRelPath(parent: string | null | undefined, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/** Lower-cased extension without the dot, or null when the name has none. */
export function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/;

/**
 * A catalog date is valid when it is a real calendar date, not before 1980 and not after
 * `notAfter` (the moment the pack was built). Legacy data contains values like `1900-01-00`.
 */
export function isValidCatalogDate(value: string | null | undefined, notAfter: string): boolean {
  if (!value) return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (year < 1980 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  return date.getTime() <= Date.parse(notAfter);
}
