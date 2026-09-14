import type { SqlDb } from "@discvault/schema";
import { nowIso } from "./local-db.js";

/** Records a search for the dashboard's "recent searches" list. Local-only, never synced. */
export function recordSearch(db: SqlDb, query: string, resultCount: number): void {
  if (!query.trim()) return;
  db.run(`INSERT INTO search_history (query_json, result_count, at) VALUES (?, ?, ?)`, [
    JSON.stringify({ q: query }),
    resultCount,
    nowIso(),
  ]);
}

export interface RecentSearch {
  q: string;
  at: string;
}

/** Most recent distinct queries, newest first (§8: Dashboard "Recent searches"). */
export function recentSearches(db: SqlDb, limit = 8): RecentSearch[] {
  const rows = db.all<{ query_json: string; at: string }>(`SELECT query_json, at FROM search_history ORDER BY id DESC LIMIT 200`);
  const seen = new Set<string>();
  const out: RecentSearch[] = [];
  for (const row of rows) {
    let q: string;
    try {
      q = (JSON.parse(row.query_json) as { q: string }).q;
    } catch {
      continue;
    }
    if (!q || seen.has(q)) continue;
    seen.add(q);
    out.push({ q, at: row.at });
    if (out.length >= limit) break;
  }
  return out;
}
