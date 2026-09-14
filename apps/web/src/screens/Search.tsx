import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { vaultWorker } from "../db/rpc.js";
import type { FileHit, FolderHit } from "../db/search.js";
import { formatDate, formatSizeKb } from "../ui/format.js";
import { categoryColor, Overlay } from "../ui/primitives.js";

type Scope = "Files" | "Folders" | "Both";

interface Row {
  key: string;
  kind: "file" | "folder";
  id: number;
  disc: number;
  name: string;
  relPath: string;
  ext: string | null;
  sizeKb: number | null;
  created: string | null;
}

function toRow(kind: "file" | "folder", h: FileHit | FolderHit): Row {
  return {
    key: `${kind}:${"file_id" in h ? h.file_id : h.folder_id}`,
    kind,
    id: "file_id" in h ? h.file_id : h.folder_id,
    disc: h.disc_no,
    name: h.name,
    relPath: h.rel_path,
    ext: "ext" in h ? h.ext : null,
    sizeKb: h.size_kb,
    created: h.created,
  };
}

function highlight(name: string, query: string): [string, string, string] {
  const i = query ? name.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i < 0) return [name, "", ""];
  return [name.slice(0, i), name.slice(i, i + query.length), name.slice(i + query.length)];
}

function useInitialQuery(): string {
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  return typeof search.q === "string" ? search.q : "";
}

/** §8 screen 4, the most important screen: local, debounced substring search with filters and grouping. */
export default function Search() {
  const initialQ = useInitialQuery();
  const navigate = useNavigate();
  const [q, setQ] = useState(initialQ);
  const [debouncedQ, setDebouncedQ] = useState(initialQ);
  const [scope, setScope] = useState<Scope>("Files");
  const [groupByDisc, setGroupByDisc] = useState(false);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [discFrom, setDiscFrom] = useState("");
  const [discTo, setDiscTo] = useState("");
  const [sizeMin, setSizeMin] = useState("");
  const [sizeMax, setSizeMax] = useState("");
  const [drawerRow, setDrawerRow] = useState<Row | null>(null);
  const recorded = useRef<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    navigate({ to: ".", search: (prev) => ({ ...prev, q: debouncedQ || undefined }) as never, replace: true });
  }, [debouncedQ, navigate]);

  const filesQuery = useQuery({
    queryKey: ["search-files", debouncedQ],
    queryFn: () => vaultWorker().search(debouncedQ, { limit: 500 }),
    enabled: debouncedQ.length > 0 && scope !== "Folders",
  });
  const foldersQuery = useQuery({
    queryKey: ["search-folders", debouncedQ],
    queryFn: () => vaultWorker().searchFolders(debouncedQ, { limit: 500 }),
    enabled: debouncedQ.length > 0 && scope !== "Files",
  });
  const catMap = useQuery({ queryKey: ["ext-category-map"], queryFn: () => vaultWorker().extensionCategoryMap() });

  useEffect(() => {
    if (!debouncedQ || filesQuery.isLoading) return;
    if (recorded.current === debouncedQ) return;
    recorded.current = debouncedQ;
    void vaultWorker().recordSearch(debouncedQ, filesQuery.data?.length ?? 0);
  }, [debouncedQ, filesQuery.data, filesQuery.isLoading]);

  const categoryOf = useCallback((ext: string | null): string => (ext ? (catMap.data?.[ext] ?? "other") : "other"), [catMap.data]);

  const allRows = useMemo<Row[]>(() => {
    const files = scope === "Folders" ? [] : (filesQuery.data ?? []).map((h) => toRow("file", h));
    const folders = scope === "Files" ? [] : (foldersQuery.data ?? []).map((h) => toRow("folder", h));
    return [...files, ...folders];
  }, [filesQuery.data, foldersQuery.data, scope]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of allRows) counts.set(categoryOf(r.ext), (counts.get(categoryOf(r.ext)) ?? 0) + 1);
    return counts;
  }, [allRows, categoryOf]);

  const extCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of allRows) if (r.ext) counts.set(r.ext, (counts.get(r.ext) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [allRows]);

  const filteredRows = useMemo(() => {
    const from = discFrom ? Number(discFrom) : undefined;
    const to = discTo ? Number(discTo) : undefined;
    const min = sizeMin ? Number(sizeMin) * 1024 : undefined;
    const max = sizeMax ? Number(sizeMax) * 1024 : undefined;
    return allRows.filter((r) => {
      if (activeCategories.size > 0 && !activeCategories.has(categoryOf(r.ext))) return false;
      if (from !== undefined && r.disc < from) return false;
      if (to !== undefined && r.disc > to) return false;
      if (min !== undefined && (r.sizeKb ?? 0) < min) return false;
      if (max !== undefined && (r.sizeKb ?? 0) > max) return false;
      return true;
    });
  }, [allRows, activeCategories, discFrom, discTo, sizeMin, sizeMax, categoryOf]);

  const groups = useMemo(() => {
    if (!groupByDisc) return null;
    const byDisc = new Map<number, Row[]>();
    for (const r of filteredRows) {
      const list = byDisc.get(r.disc) ?? [];
      list.push(r);
      byDisc.set(r.disc, list);
    }
    return [...byDisc.entries()].sort((a, b) => a[0] - b[0]);
  }, [filteredRows, groupByDisc]);

  const toggleCategory = (cat: string) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const loading = (scope !== "Folders" && filesQuery.isLoading) || (scope !== "Files" && foldersQuery.isLoading);
  const noResults = debouncedQ.length > 0 && !loading && filteredRows.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          flex: "none",
          padding: "16px 20px 12px",
          borderBottom: "1px solid var(--dv-border)",
          display: "flex",
          flexDirection: "column",
          gap: 11,
          background: "var(--dv-bg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div
            style={{
              flex: 1,
              minWidth: 300,
              display: "flex",
              alignItems: "center",
              gap: 9,
              height: 38,
              padding: "0 12px",
              border: "1px solid var(--dv-border-2)",
              borderRadius: 9,
              background: "var(--dv-bg-sub)",
            }}
          >
            <svg viewBox="0 0 16 16" width={15} height={15} style={{ flex: "none", color: "var(--dv-text-3)" }} aria-hidden="true">
              <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="helsing"
              style={{
                flex: 1,
                minWidth: 0,
                border: 0,
                background: "transparent",
                outline: "none",
                font: "400 14px/1 'JetBrains Mono', monospace",
              }}
            />
          </div>
          <div
            style={{
              flex: "none",
              display: "flex",
              gap: 2,
              padding: 2,
              border: "1px solid var(--dv-border)",
              borderRadius: 9,
              background: "var(--dv-bg-sub)",
            }}
          >
            {(["Files", "Folders", "Both"] as Scope[]).map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setScope(s)}
                style={{
                  minHeight: 30,
                  padding: "0 13px",
                  border: 0,
                  borderRadius: 7,
                  cursor: "pointer",
                  font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
                  background: scope === s ? "var(--dv-bg)" : "transparent",
                  color: scope === s ? "var(--dv-text)" : "var(--dv-text-2)",
                  boxShadow: scope === s ? "var(--dv-shadow)" : "none",
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setGroupByDisc((g) => !g)}
            style={{
              flex: "none",
              minHeight: 34,
              padding: "0 12px",
              borderRadius: 8,
              border: `1px solid ${groupByDisc ? "var(--dv-accent)" : "var(--dv-border)"}`,
              background: groupByDisc ? "var(--dv-accent-soft)" : "var(--dv-bg-sub)",
              color: groupByDisc ? "var(--dv-accent)" : "var(--dv-text)",
              font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
              cursor: "pointer",
            }}
          >
            Group by disc
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ marginLeft: "auto", font: "400 12px/1 'JetBrains Mono', monospace", color: "var(--dv-text-3)" }}>
            {loading
              ? "Searching…"
              : debouncedQ
                ? `${filteredRows.length} result${filteredRows.length === 1 ? "" : "s"}`
                : "Type to search"}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <aside
          style={{
            width: 232,
            flex: "none",
            borderRight: "1px solid var(--dv-border)",
            background: "var(--dv-panel)",
            overflow: "auto",
            padding: "14px 14px 40px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span
              style={{
                font: "500 10px/1 'JetBrains Mono', monospace",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: "var(--dv-text-3)",
              }}
            >
              Category
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {[...categoryCounts.entries()].map(([cat, count]) => {
                const on = activeCategories.has(cat);
                return (
                  <button
                    type="button"
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      minHeight: 26,
                      padding: "0 8px",
                      border: `1px solid ${on ? categoryColor(cat) : "var(--dv-border)"}`,
                      borderRadius: 7,
                      background: on ? "var(--dv-accent-soft)" : "transparent",
                      color: "var(--dv-text)",
                      font: "500 11px/1 'Instrument Sans', system-ui, sans-serif",
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: 2, background: categoryColor(cat) }} />
                    {cat}
                    <span className="dv-mono" style={{ fontSize: 11, color: "var(--dv-text-3)" }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                font: "500 10px/1 'JetBrains Mono', monospace",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: "var(--dv-text-3)",
              }}
            >
              Extension
            </span>
            {extCounts.map(([ext, count]) => (
              <div
                key={ext}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  minHeight: 22,
                  font: "400 12px/1 'JetBrains Mono', monospace",
                  color: "var(--dv-text-2)",
                }}
              >
                <span>{ext || "(none)"}</span>
                <span style={{ color: "var(--dv-text-3)" }}>{count}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span
              style={{
                font: "500 10px/1 'JetBrains Mono', monospace",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: "var(--dv-text-3)",
              }}
            >
              Disc range
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <input value={discFrom} onChange={(e) => setDiscFrom(e.target.value)} placeholder="1" style={filterInputStyle} />
              <span style={{ font: "400 12px/1 'JetBrains Mono', monospace", color: "var(--dv-text-3)" }}>–</span>
              <input value={discTo} onChange={(e) => setDiscTo(e.target.value)} placeholder="321" style={filterInputStyle} />
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span
              style={{
                font: "500 10px/1 'JetBrains Mono', monospace",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: "var(--dv-text-3)",
              }}
            >
              Size (MB)
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input value={sizeMin} onChange={(e) => setSizeMin(e.target.value)} placeholder="0" style={filterInputStyle} />
              <span style={{ font: "400 12px/1 'JetBrains Mono', monospace", color: "var(--dv-text-3)" }}>–</span>
              <input value={sizeMax} onChange={(e) => setSizeMax(e.target.value)} placeholder="∞" style={filterInputStyle} />
            </div>
          </div>
        </aside>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", position: "relative", overflowX: "auto" }}>
          {debouncedQ.length === 0 ? (
            <div
              style={{
                padding: "74px 24px",
                textAlign: "center",
                color: "var(--dv-text-3)",
                font: "400 13px/1.5 'Instrument Sans', system-ui, sans-serif",
              }}
            >
              Start typing to search 345,000+ files, offline, in your browser.
            </div>
          ) : noResults ? (
            <div
              style={{ padding: "74px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 11, textAlign: "center" }}
            >
              <span style={{ font: "600 16px/1.2 'Instrument Sans', system-ui, sans-serif" }}>No files match this search</span>
              <span style={{ font: "400 13px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)", maxWidth: 420 }}>
                Nothing in the local index matches <span className="dv-mono">{debouncedQ}</span>.
              </span>
            </div>
          ) : (
            <div style={{ flex: 1, minWidth: 900, minHeight: 0, overflowY: "auto" }}>
              {!groups &&
                filteredRows.map((r) => {
                  const [pre, hit, post] = highlight(r.name, debouncedQ);
                  return (
                    <button
                      type="button"
                      key={r.key}
                      onClick={() => setDrawerRow(r)}
                      style={{
                        display: "grid",
                        width: "100%",
                        gridTemplateColumns: "minmax(180px,1.3fr) 224px minmax(150px,1.5fr) 86px 70px 98px",
                        alignItems: "center",
                        gap: 10,
                        padding: "0 16px",
                        height: "var(--dv-row)",
                        border: 0,
                        borderBottom: "1px solid var(--dv-border)",
                        background: "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{ width: 6, height: 6, flex: "none", borderRadius: 2, background: categoryColor(categoryOf(r.ext)) }}
                        />
                        <span
                          style={{
                            minWidth: 0,
                            font: "400 13px/1 'Instrument Sans', system-ui, sans-serif",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {pre}
                          {hit && (
                            <span style={{ background: "var(--dv-hl-bg)", color: "var(--dv-hl-text)", borderRadius: 2, padding: "0 1px" }}>
                              {hit}
                            </span>
                          )}
                          {post}
                        </span>
                      </span>
                      <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            flex: "none",
                            padding: "2px 7px",
                            borderRadius: 5,
                            background: "var(--dv-accent-soft)",
                            color: "var(--dv-accent)",
                            font: "700 12px/1.3 'JetBrains Mono', monospace",
                          }}
                        >
                          #{r.disc}
                        </span>
                      </span>
                      <span
                        style={{
                          minWidth: 0,
                          font: "400 11px/1 'JetBrains Mono', monospace",
                          color: "var(--dv-text-3)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.relPath}
                      </span>
                      <span style={{ textAlign: "right", font: "400 12px/1 'JetBrains Mono', monospace", color: "var(--dv-text-2)" }}>
                        {formatSizeKb(r.sizeKb)}
                      </span>
                      <span style={{ font: "400 11px/1 'JetBrains Mono', monospace", color: "var(--dv-text-3)" }}>
                        {r.ext ?? (r.kind === "folder" ? "dir" : "")}
                      </span>
                      <span style={{ font: "400 11px/1 'JetBrains Mono', monospace", color: "var(--dv-text-3)" }}>
                        {formatDate(r.created)}
                      </span>
                    </button>
                  );
                })}
              {groups?.map(([disc, rows]) => (
                <div key={disc}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      height: 34,
                      padding: "0 16px",
                      background: "var(--dv-panel)",
                      borderBottom: "1px solid var(--dv-border)",
                      position: "sticky",
                      top: 0,
                    }}
                  >
                    <span
                      style={{
                        flex: "none",
                        padding: "2px 7px",
                        borderRadius: 5,
                        background: "var(--dv-text)",
                        color: "var(--dv-bg)",
                        font: "700 12px/1.3 'JetBrains Mono', monospace",
                      }}
                    >
                      #{disc}
                    </span>
                    <span className="dv-mono" style={{ fontSize: 11, color: "var(--dv-text-3)" }}>
                      · {rows.length} match{rows.length === 1 ? "" : "es"}
                    </span>
                  </div>
                  {rows.map((r) => {
                    const [pre, hit, post] = highlight(r.name, debouncedQ);
                    return (
                      <button
                        type="button"
                        key={r.key}
                        onClick={() => setDrawerRow(r)}
                        style={{
                          display: "grid",
                          width: "100%",
                          gridTemplateColumns: "minmax(180px,1.5fr) minmax(150px,1.5fr) 86px 70px 98px",
                          alignItems: "center",
                          gap: 10,
                          padding: "0 16px",
                          height: "var(--dv-row)",
                          border: 0,
                          borderBottom: "1px solid var(--dv-border)",
                          background: "transparent",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            style={{ width: 6, height: 6, flex: "none", borderRadius: 2, background: categoryColor(categoryOf(r.ext)) }}
                          />
                          <span
                            style={{
                              minWidth: 0,
                              font: "400 13px/1 'Instrument Sans', system-ui, sans-serif",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {pre}
                            {hit && (
                              <span
                                style={{ background: "var(--dv-hl-bg)", color: "var(--dv-hl-text)", borderRadius: 2, padding: "0 1px" }}
                              >
                                {hit}
                              </span>
                            )}
                            {post}
                          </span>
                        </span>
                        <span
                          style={{
                            minWidth: 0,
                            font: "400 11px/1 'JetBrains Mono', monospace",
                            color: "var(--dv-text-3)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.relPath}
                        </span>
                        <span style={{ textAlign: "right", font: "400 12px/1 'JetBrains Mono', monospace", color: "var(--dv-text-2)" }}>
                          {formatSizeKb(r.sizeKb)}
                        </span>
                        <span style={{ font: "400 11px/1 'JetBrains Mono', monospace", color: "var(--dv-text-3)" }}>
                          {r.ext ?? (r.kind === "folder" ? "dir" : "")}
                        </span>
                        <span style={{ font: "400 11px/1 'JetBrains Mono', monospace", color: "var(--dv-text-3)" }}>
                          {formatDate(r.created)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
              <div style={{ padding: "10px 16px", font: "400 11px/1 'JetBrains Mono', monospace", color: "var(--dv-text-3)" }}>
                End of results{filteredRows.length >= 500 ? " · showing the first 500" : ""}
              </div>
            </div>
          )}
        </div>
      </div>

      {drawerRow && (
        <Overlay onClose={() => setDrawerRow(null)}>
          <button
            type="button"
            onClick={() => setDrawerRow(null)}
            style={{
              alignSelf: "flex-end",
              border: 0,
              background: "transparent",
              cursor: "pointer",
              font: "400 16px/1 'JetBrains Mono', monospace",
              color: "var(--dv-text-3)",
            }}
          >
            ✕
          </button>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                padding: "8px 14px",
                borderRadius: 11,
                background: "var(--dv-text)",
                color: "var(--dv-bg)",
                font: "700 26px/1 'JetBrains Mono', monospace",
                width: "fit-content",
              }}
            >
              #{drawerRow.disc}
            </span>
          </div>
          <span style={{ font: "700 18px/1.3 'Instrument Sans', system-ui, sans-serif", wordBreak: "break-word" }}>{drawerRow.name}</span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 11px",
              border: "1px solid var(--dv-border)",
              borderRadius: 9,
              background: "var(--dv-bg-sub)",
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 0,
                font: "400 12px/1.4 'JetBrains Mono', monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: "var(--dv-text-2)",
              }}
            >
              {drawerRow.relPath}
            </span>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(drawerRow.relPath)}
              style={{
                flex: "none",
                border: 0,
                background: "transparent",
                cursor: "pointer",
                font: "400 12px/1 'JetBrains Mono', monospace",
                color: "var(--dv-accent)",
              }}
            >
              Copy
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, font: "400 13px/1.6 'JetBrains Mono', monospace" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--dv-text-3)" }}>Size</span>
              <span>{formatSizeKb(drawerRow.sizeKb)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--dv-text-3)" }}>Date</span>
              <span>{formatDate(drawerRow.created)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--dv-text-3)" }}>Type</span>
              <span>{drawerRow.kind === "folder" ? "Folder" : (drawerRow.ext ?? "—")}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate({ to: "/discs/$no", params: { no: String(drawerRow.disc) } })}
            style={{
              alignSelf: "flex-start",
              minHeight: 36,
              padding: "0 14px",
              border: "1px solid var(--dv-border-2)",
              borderRadius: 8,
              background: "var(--dv-bg-sub)",
              font: "500 13px/1 'Instrument Sans', system-ui, sans-serif",
              cursor: "pointer",
            }}
          >
            Open disc #{drawerRow.disc}
          </button>
        </Overlay>
      )}
    </div>
  );
}

const filterInputStyle = {
  flex: 1,
  minWidth: 0,
  height: 30,
  padding: "0 8px",
  border: "1px solid var(--dv-border)",
  borderRadius: 7,
  background: "var(--dv-bg)",
  outline: "none",
  font: "400 12px/1 'JetBrains Mono', monospace",
} as const;
