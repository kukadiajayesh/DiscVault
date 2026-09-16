import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type KeyboardEvent, type UIEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { buildModelFallbackChain } from "../ai/analyze.js";
import {
  cancelBulkAnalyze,
  getSnapshot as getBulkAnalyzeSnapshot,
  startBulkAnalyze,
  subscribe as subscribeBulkAnalyze,
} from "../ai/bulk-analyze.js";
import { listGeminiModels } from "../ai/gemini.js";
import { getGeminiApiKey, getGeminiModel } from "../ai/gemini-key.js";
import type { DiscListItem } from "../db/catalog.js";
import { vaultWorker } from "../db/rpc.js";
import { formatCount, formatDate, formatSizeKb } from "../ui/format.js";
import { Button, Meter, Pill } from "../ui/primitives.js";

type SortKey = "no" | "added" | "scanned" | "pct";

function statusTone(status: string): "ok" | "warn" | "off" {
  if (status === "available") return "ok";
  if (status === "on_loan") return "warn";
  return "off";
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** §8 screen 5: table or grid of every disc, with jump-to-#, filters and sort. */
export default function Discs() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const discsQuery = useQuery({ queryKey: ["discs-recent"], queryFn: () => vaultWorker().listDiscs() });
  const missingQuery = useQuery({ queryKey: ["missing-discs"], queryFn: () => vaultWorker().missingDiscNumbers() });
  const analyzedQuery = useQuery({ queryKey: ["disc-nos-with-ai-items"], queryFn: () => vaultWorker().discNosWithAiItems() });
  const analyzedNos = useMemo(() => new Set(analyzedQuery.data ?? []), [analyzedQuery.data]);
  const geminiApiKey = getGeminiApiKey();
  const aiModelsQuery = useQuery({
    queryKey: ["gemini-models", geminiApiKey],
    queryFn: () => listGeminiModels(geminiApiKey as string),
    enabled: !!geminiApiKey,
    staleTime: 5 * 60 * 1000,
  });

  const [view, setViewState] = useState<"table" | "grid">(() => {
    return (sessionStorage.getItem("discvault:discs:view") as "table" | "grid") ?? "table";
  });
  const [jump, setJumpState] = useState(() => {
    return sessionStorage.getItem("discvault:discs:jump") ?? "";
  });
  const [status, setStatusState] = useState(() => {
    return sessionStorage.getItem("discvault:discs:status") ?? "Any status";
  });
  const [sort, setSortState] = useState<SortKey>(() => {
    return (sessionStorage.getItem("discvault:discs:sort") as SortKey) ?? "no";
  });
  const bulkAnalyze = useSyncExternalStore(subscribeBulkAnalyze, getBulkAnalyzeSnapshot);
  const bulkProgress = bulkAnalyze.progress;
  const [keyError, setKeyError] = useState<string | null>(null);
  const bulkError = keyError ?? bulkAnalyze.error;

  const containerRef = useRef<HTMLDivElement>(null);
  const hasRestoredScroll = useRef(false);

  const setStatus = (val: string) => {
    setStatusState(val);
    sessionStorage.setItem("discvault:discs:status", val);
    sessionStorage.setItem("discvault:discs:scrollPosition", "0");
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  };

  const setSort = (val: SortKey) => {
    setSortState(val);
    sessionStorage.setItem("discvault:discs:sort", val);
    sessionStorage.setItem("discvault:discs:scrollPosition", "0");
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  };

  const setView = (val: "table" | "grid") => {
    setViewState(val);
    sessionStorage.setItem("discvault:discs:view", val);
    sessionStorage.setItem("discvault:discs:scrollPosition", "0");
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  };

  const setJump = (val: string) => {
    setJumpState(val);
    sessionStorage.setItem("discvault:discs:jump", val);
  };

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    sessionStorage.setItem("discvault:discs:scrollPosition", String(e.currentTarget.scrollTop));
  };

  const statuses = useMemo(() => {
    const set = new Set<string>();
    for (const d of discsQuery.data ?? []) set.add(d.status);
    return [...set].sort();
  }, [discsQuery.data]);

  const rows = useMemo(() => {
    let list = discsQuery.data ?? [];
    if (status !== "Any status") list = list.filter((d) => d.status === status);
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sort === "added") return 0; // added_at isn't tracked separately from updated_at yet
      if (sort === "scanned") return (b.scanned_at ?? "").localeCompare(a.scanned_at ?? "");
      if (sort === "pct") return b.total_kb - a.total_kb;
      return a.disc_no - b.disc_no;
    });
    return sorted;
  }, [discsQuery.data, status, sort]);

  useEffect(() => {
    if (view) {
      hasRestoredScroll.current = false;
    }
  }, [view]);

  useEffect(() => {
    if (view && !hasRestoredScroll.current && containerRef.current && rows.length > 0) {
      const saved = sessionStorage.getItem("discvault:discs:scrollPosition");
      if (saved) {
        containerRef.current.scrollTop = Number(saved);
      }
      hasRestoredScroll.current = true;
    }
  }, [rows, view]);

  const onJumpKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const n = Number(jump);
    if (!Number.isFinite(n)) return;
    navigate({ to: "/discs/$no", params: { no: String(n) } });
  };

  const markRetired = async (discNo: number) => {
    await vaultWorker().setDiscStatus(discNo, "retired");
    await queryClient.invalidateQueries({ queryKey: ["missing-discs"] });
    await queryClient.invalidateQueries({ queryKey: ["discs-recent"] });
  };

  /**
   * Hands every currently-listed disc that hasn't been analyzed yet to the app-level bulk-analyze
   * queue (ai/bulk-analyze.ts), which throttles to one disc every 5 minutes and keeps running even
   * if this screen unmounts — the queue is a module singleton, not component state.
   */
  const analyzeAllWithAi = () => {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      setKeyError("Add a Gemini API key in Settings → AI first.");
      return;
    }
    setKeyError(null);
    const targets = rows.filter((d) => !analyzedNos.has(d.disc_no)).map((d) => ({ discNo: d.disc_no, hasTitle: !!d.title }));
    if (targets.length === 0) return;
    const models = buildModelFallbackChain(getGeminiModel(), aiModelsQuery.data ?? []);
    void startBulkAnalyze(targets, { apiKey, models });
  };

  const capacityPct = (d: DiscListItem): number => {
    // No stored disc capacity yet; approximate against the media type's nominal size (4.7GB/8.5GB).
    const capKb = /9$/.test(d.media_type ?? "") ? 8_500_000 : 4_700_000;
    return d.total_kb > 0 ? Math.min(100, (d.total_kb / capKb) * 100) : 0;
  };

  const unanalyzedCount = rows.filter((d) => !analyzedNos.has(d.disc_no)).length;

  return (
    <div
      style={{
        padding: "22px 24px 0",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <span style={{ font: "700 20px/1.2 'Instrument Sans', system-ui, sans-serif", letterSpacing: "-.02em" }}>
          Disc library {discsQuery.data ? `· ${formatCount(discsQuery.data.length)}` : ""}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              height: 32,
              padding: "0 4px 0 10px",
              border: "1px solid var(--dv-border)",
              borderRadius: 8,
              background: "var(--dv-bg-sub)",
            }}
          >
            <span className="dv-mono" style={{ fontSize: 11, color: "var(--dv-text-3)" }}>
              Jump to #
            </span>
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              onKeyDown={onJumpKey}
              placeholder="116"
              style={{ width: 48, border: 0, background: "transparent", outline: "none", font: "400 13px/1 'JetBrains Mono', monospace" }}
            />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
            <option>Any status</option>
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={selectStyle}>
            <option value="no">Sort: Disc #</option>
            <option value="scanned">Sort: Last scanned</option>
            <option value="pct">Sort: Size</option>
          </select>
          {bulkProgress ? (
            <Button variant="secondary" onClick={cancelBulkAnalyze}>
              {bulkProgress.waiting ? `Waiting for #${bulkProgress.discNo}` : `Analyzing #${bulkProgress.discNo}`} ({bulkProgress.done}/
              {bulkProgress.total}) — Cancel
            </Button>
          ) : (
            unanalyzedCount > 0 && (
              <Button variant="secondary" onClick={analyzeAllWithAi}>
                Analyze {unanalyzedCount === rows.length ? "all" : `${unanalyzedCount}`} with AI
              </Button>
            )
          )}
          <div
            style={{
              display: "flex",
              gap: 2,
              padding: 2,
              border: "1px solid var(--dv-border)",
              borderRadius: 8,
              background: "var(--dv-bg-sub)",
            }}
          >
            {(["table", "grid"] as const).map((v) => (
              <button
                type="button"
                key={v}
                onClick={() => setView(v)}
                style={{
                  minHeight: 28,
                  padding: "0 11px",
                  border: 0,
                  borderRadius: 6,
                  cursor: "pointer",
                  font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
                  background: view === v ? "var(--dv-bg)" : "transparent",
                  color: view === v ? "var(--dv-text)" : "var(--dv-text-2)",
                  textTransform: "capitalize",
                }}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {bulkError && (
        <span style={{ font: "400 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-err)" }}>{bulkError}</span>
      )}

      {view === "table" ? (
        <div
          ref={containerRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            minHeight: 0,
            border: "1px solid var(--dv-border)",
            borderRadius: 11,
            overflow: "auto",
            marginBottom: 24,
          }}
        >
          <div style={{ minWidth: 828 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "64px 1.3fr 74px 64px 64px 70px 110px 92px",
                gap: 10,
                alignItems: "center",
                padding: "0 14px",
                height: 32,
                background: "var(--dv-bg-sub)",
                borderBottom: "1px solid var(--dv-border)",
                font: "500 10px/1 'JetBrains Mono', monospace",
                letterSpacing: ".07em",
                textTransform: "uppercase",
                color: "var(--dv-text-3)",
                position: "sticky",
                top: 0,
                zIndex: 1,
              }}
            >
              <span>Disc</span>
              <span>Title</span>
              <span>Media</span>
              <span>Files</span>
              <span>Folders</span>
              <span style={{ textAlign: "right" }}>Size</span>
              <span>% full</span>
              <span>Scanned</span>
            </div>
            {rows.map((d) => {
              const pct = capacityPct(d);
              return (
                <button
                  type="button"
                  key={d.disc_no}
                  onClick={() => navigate({ to: "/discs/$no", params: { no: String(d.disc_no) } })}
                  style={{
                    display: "grid",
                    width: "100%",
                    gridTemplateColumns: "64px 1.3fr 74px 64px 64px 70px 110px 92px",
                    gap: 10,
                    alignItems: "center",
                    padding: "0 14px",
                    height: "var(--dv-row)",
                    border: 0,
                    borderBottom: "1px solid var(--dv-border)",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      padding: "2px 7px",
                      borderRadius: 5,
                      background: "var(--dv-accent-soft)",
                      color: "var(--dv-accent)",
                      font: "700 12px/1.3 'JetBrains Mono', monospace",
                      width: "fit-content",
                    }}
                  >
                    #{d.disc_no}
                  </span>
                  <span
                    style={{
                      minWidth: 0,
                      font: "500 13px/1.3 'Instrument Sans', system-ui, sans-serif",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {d.title ?? d.label ?? "Untitled"}
                  </span>
                  <span className="dv-mono" style={{ fontSize: 11, color: "var(--dv-text-2)" }}>
                    {d.media_type ?? "—"}
                  </span>
                  <span className="dv-mono" style={{ fontSize: 12, color: "var(--dv-text-2)" }}>
                    {formatCount(d.file_count)}
                  </span>
                  <span className="dv-mono" style={{ fontSize: 12, color: "var(--dv-text-2)" }}>
                    {formatCount(d.folder_count)}
                  </span>
                  <span style={{ textAlign: "right" }} className="dv-mono">
                    {formatSizeKb(d.total_kb)}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ flex: 1 }}>
                      <Meter pct={pct} />
                    </span>
                    <span className="dv-mono" style={{ fontSize: 10, color: "var(--dv-text-3)", flex: "none" }}>
                      {Math.round(pct)}%
                    </span>
                  </span>
                  <span className="dv-mono" style={{ fontSize: 11, color: "var(--dv-text-3)" }}>
                    {d.scanned_at ? formatDate(d.scanned_at) : "Never"}
                  </span>
                </button>
              );
            })}
            {(missingQuery.data ?? []).map((n) => (
              <div
                key={n}
                style={{
                  display: "grid",
                  gridTemplateColumns: "64px 1.3fr 74px 64px 64px 70px 110px 92px",
                  gap: 10,
                  alignItems: "center",
                  padding: "0 14px",
                  height: "var(--dv-row)",
                  borderBottom: "1px solid var(--dv-border)",
                  color: "var(--dv-text-3)",
                  background: "var(--dv-bg-sub)",
                }}
              >
                <span
                  style={{
                    padding: "2px 7px",
                    borderRadius: 5,
                    border: "1px dashed var(--dv-border-2)",
                    font: "700 12px/1.3 'JetBrains Mono', monospace",
                    width: "fit-content",
                  }}
                >
                  #{n}
                </span>
                <span style={{ font: "400 13px/1.3 'Instrument Sans', system-ui, sans-serif", fontStyle: "italic" }}>Never scanned</span>
                <span />
                <span />
                <span />
                <span />
                <span />
                <button
                  type="button"
                  onClick={() => markRetired(n)}
                  style={{
                    minHeight: 26,
                    padding: "0 10px",
                    border: "1px solid var(--dv-border-2)",
                    borderRadius: 7,
                    background: "var(--dv-bg)",
                    font: "500 11px/1 'Instrument Sans', system-ui, sans-serif",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    width: "fit-content",
                  }}
                >
                  Mark retired
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div ref={containerRef} onScroll={handleScroll} style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
            {rows.map((d) => {
              const pct = capacityPct(d);
              return (
                <button
                  type="button"
                  key={d.disc_no}
                  onClick={() => navigate({ to: "/discs/$no", params: { no: String(d.disc_no) } })}
                  style={{
                    textAlign: "left",
                    border: "1px solid var(--dv-border)",
                    borderRadius: 12,
                    padding: 16,
                    background: "var(--dv-bg-sub)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span
                      style={{
                        padding: "4px 9px",
                        borderRadius: 7,
                        background: "var(--dv-text)",
                        color: "var(--dv-bg)",
                        font: "700 15px/1 'JetBrains Mono', monospace",
                      }}
                    >
                      #{d.disc_no}
                    </span>
                    <Pill label={statusLabel(d.status)} tone={statusTone(d.status)} />
                  </div>
                  <span
                    style={{
                      font: "600 14px/1.3 'Instrument Sans', system-ui, sans-serif",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {d.title ?? d.label ?? "Untitled"}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ flex: 1 }}>
                      <Meter pct={pct} />
                    </span>
                    <span className="dv-mono" style={{ fontSize: 10, color: "var(--dv-text-3)" }}>
                      {formatSizeKb(d.total_kb)}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }} className="dv-mono">
                    <span style={{ fontSize: 11, color: "var(--dv-text-3)" }}>{d.media_type ?? "—"}</span>
                    <span style={{ fontSize: 11, color: "var(--dv-text-3)" }}>{formatCount(d.file_count)} files</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const selectStyle = {
  height: 32,
  padding: "0 8px",
  border: "1px solid var(--dv-border)",
  borderRadius: 8,
  background: "var(--dv-bg-sub)",
  font: "400 12px/1 'Instrument Sans', system-ui, sans-serif",
} as const;
