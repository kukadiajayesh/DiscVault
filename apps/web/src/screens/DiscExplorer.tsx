import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { readDiscClassification } from "../ai/classification.js";
import { classifyDiscWithGemini, listGeminiModels } from "../ai/gemini.js";
import { getGeminiApiKey, getGeminiModel, setGeminiModel } from "../ai/gemini-key.js";
import type { FolderChild } from "../db/catalog.js";
import { vaultWorker } from "../db/rpc.js";
import { formatCount, formatDate, formatSizeKb } from "../ui/format.js";
import { ConfirmDialog, categoryColor, Meter } from "../ui/primitives.js";

type Tab = "browse" | "overview" | "activity";

function joinPath(parts: string[]): string {
  return parts.join("/");
}

/** §8 screen 6: disc header + Browse (lazy folder tree) / Overview / Activity tabs. */
export default function DiscExplorer() {
  const params = useParams({ strict: false }) as { no?: string; _splat?: string };
  const discNo = Number(params.no);
  const currentPath = params._splat ?? "";
  const crumbs = currentPath ? currentPath.split("/") : [];
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>("browse");
  const [selectedFile, setSelectedFile] = useState<FolderChild | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState(() => getGeminiModel());
  const geminiApiKey = getGeminiApiKey();
  const aiModelsQuery = useQuery({
    queryKey: ["gemini-models", geminiApiKey],
    queryFn: () => listGeminiModels(geminiApiKey as string),
    enabled: !!geminiApiKey,
    staleTime: 5 * 60 * 1000,
  });
  const aiModels = aiModelsQuery.data ?? [];

  const discQuery = useQuery({ queryKey: ["disc", discNo], queryFn: () => vaultWorker().getDisc(discNo) });
  const entriesQuery = useQuery({
    queryKey: ["disc-folder", discNo, currentPath],
    queryFn: () => vaultWorker().listFolder(discNo, currentPath),
  });
  const catQuery = useQuery({
    queryKey: ["disc-categories", discNo],
    queryFn: () => vaultWorker().categoryBreakdown(discNo),
    enabled: tab === "overview",
  });
  const extQuery = useQuery({
    queryKey: ["disc-extensions", discNo],
    queryFn: () => vaultWorker().extensionBreakdown(discNo),
    enabled: tab === "overview",
  });
  const largestQuery = useQuery({
    queryKey: ["disc-largest", discNo],
    queryFn: () => vaultWorker().largestFiles(discNo),
    enabled: tab === "overview",
  });

  useEffect(() => {
    setNotes(discQuery.data?.notes ?? "");
  }, [discQuery.data?.notes]);

  const goPath = (path: string) => {
    setSelectedFile(null);
    if (!path) navigate({ to: "/discs/$no", params: { no: String(discNo) } });
    else navigate({ to: "/discs/$no/browse/$", params: { no: String(discNo), _splat: path } });
  };

  const saveNotes = async () => {
    if (notes === null || notes === discQuery.data?.notes) return;
    await vaultWorker().setDiscNotes(discNo, notes);
    await queryClient.invalidateQueries({ queryKey: ["disc", discNo] });
  };

  const doDelete = async () => {
    await vaultWorker().deleteDisc(discNo);
    setConfirmDelete(false);
    navigate({ to: "/discs" });
  };

  const analyzeWithAi = async () => {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      setAiError("Add a Gemini API key in Settings → AI first.");
      return;
    }
    setAnalyzing(true);
    setAiError(null);
    try {
      const summary = await vaultWorker().discAiSummary(discNo);
      if (!summary) throw new Error("disc not found");
      const model = aiModel.trim() || getGeminiModel();
      const classification = await classifyDiscWithGemini(apiKey, summary, model);
      await vaultWorker().saveDiscClassification(discNo, classification);
      setGeminiModel(model);
      await queryClient.invalidateQueries({ queryKey: ["disc", discNo] });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  };

  const d = discQuery.data;
  const aiClassification = readDiscClassification(d?.meta ?? null);
  const capKb = /9$/.test(d?.media_type ?? "") ? 8_500_000 : 4_700_000;
  const pct = d && d.total_kb > 0 ? Math.min(100, Math.round((d.total_kb / capKb) * 100)) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          flex: "none",
          padding: "16px 24px 0",
          borderBottom: "1px solid var(--dv-border)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <button
          type="button"
          onClick={() => navigate({ to: "/discs" })}
          style={{
            alignSelf: "flex-start",
            border: 0,
            background: "transparent",
            cursor: "pointer",
            font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
            color: "var(--dv-text-3)",
            padding: 0,
          }}
        >
          ← Disc library
        </button>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <span
              style={{
                padding: "8px 14px",
                borderRadius: 11,
                background: "var(--dv-text)",
                color: "var(--dv-bg)",
                font: "700 24px/1 'JetBrains Mono', monospace",
              }}
            >
              #{discNo}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
              <span style={{ font: "700 19px/1.2 'Instrument Sans', system-ui, sans-serif" }}>
                {d?.title ?? d?.label ?? (discQuery.isLoading ? "Loading…" : "Untitled")}
              </span>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  font: "400 12px/1 'JetBrains Mono', monospace",
                  color: "var(--dv-text-2)",
                }}
              >
                <span>{d?.media_type ?? "—"}</span>
                {d && (
                  <span
                    style={{
                      display: "inline-flex",
                      padding: "1px 7px",
                      borderRadius: 99,
                      background: "var(--dv-off-soft)",
                      color: "var(--dv-text-2)",
                      font: "500 11px/1.6 'Instrument Sans', system-ui, sans-serif",
                    }}
                  >
                    {d.status}
                  </span>
                )}
              </div>
              {d && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, width: 220 }}>
                  <span style={{ flex: 1 }}>
                    <Meter pct={pct} />
                  </span>
                  <span className="dv-mono" style={{ fontSize: 10, color: "var(--dv-text-3)" }}>
                    {pct}%
                  </span>
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => navigate({ to: "/scan", search: { disc: discNo } as never })}
              style={{
                minHeight: 34,
                padding: "0 13px",
                border: "1px solid var(--dv-border-2)",
                borderRadius: 8,
                background: "var(--dv-bg-sub)",
                font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
                cursor: "pointer",
              }}
            >
              Re-scan
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              style={{
                minHeight: 34,
                padding: "0 13px",
                border: "1px solid var(--dv-err)",
                borderRadius: 8,
                background: "transparent",
                color: "var(--dv-err)",
                font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
                cursor: "pointer",
              }}
            >
              Delete
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["browse", "overview", "activity"] as Tab[]).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTab(t)}
              style={{
                minHeight: 32,
                padding: "0 13px",
                border: 0,
                borderBottom: `2px solid ${tab === t ? "var(--dv-accent)" : "transparent"}`,
                background: "transparent",
                color: tab === t ? "var(--dv-accent)" : "var(--dv-text-2)",
                font: "500 13px/1 'Instrument Sans', system-ui, sans-serif",
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === "browse" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div
              style={{
                flex: "none",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 16px",
                borderBottom: "1px solid var(--dv-border)",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                <button type="button" onClick={() => goPath("")} style={crumbStyle}>
                  (root) /
                </button>
                {crumbs.map((c, i) => (
                  <button
                    type="button"
                    key={joinPath(crumbs.slice(0, i + 1))}
                    onClick={() => goPath(joinPath(crumbs.slice(0, i + 1)))}
                    style={crumbStyle}
                  >
                    {c} /
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              {(entriesQuery.data ?? []).map((e) => (
                <button
                  type="button"
                  key={`${e.kind}:${e.kind === "folder" ? e.folder_id : e.file_id}`}
                  onClick={() => (e.kind === "folder" ? goPath(joinPath([...crumbs, e.name])) : setSelectedFile(e))}
                  style={{
                    display: "flex",
                    width: "100%",
                    alignItems: "center",
                    gap: 10,
                    height: "var(--dv-row)",
                    padding: "0 16px",
                    border: 0,
                    borderBottom: "1px solid var(--dv-border)",
                    background: "transparent",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  {e.kind === "folder" ? (
                    <>
                      <span
                        style={{
                          width: 14,
                          textAlign: "center",
                          font: "400 13px/1 'JetBrains Mono', monospace",
                          color: "var(--dv-text-3)",
                        }}
                      >
                        ▸
                      </span>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          font: "500 13px/1 'Instrument Sans', system-ui, sans-serif",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {e.name}
                      </span>
                    </>
                  ) : (
                    <>
                      <span style={{ width: 7, height: 7, flex: "none", borderRadius: 2, background: categoryColor("other") }} />
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          font: "400 13px/1 'Instrument Sans', system-ui, sans-serif",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {e.name}
                      </span>
                      <span className="dv-mono" style={{ fontSize: 11, color: "var(--dv-text-2)" }}>
                        {formatSizeKb(e.size_kb)}
                      </span>
                      <span className="dv-mono" style={{ fontSize: 11, color: "var(--dv-text-3)", width: 80, textAlign: "right" }}>
                        {formatDate(e.created)}
                      </span>
                    </>
                  )}
                </button>
              ))}
              {entriesQuery.data?.length === 0 && (
                <div style={{ padding: 24, font: "400 13px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
                  This folder is empty.
                </div>
              )}
            </div>
          </div>
          <aside style={{ width: 270, flex: "none", borderLeft: "1px solid var(--dv-border)", overflow: "auto", padding: 16 }}>
            {selectedFile && selectedFile.kind === "file" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 9, height: 9, flex: "none", borderRadius: 3, background: categoryColor("other") }} />
                  <span style={{ font: "600 14px/1.3 'Instrument Sans', system-ui, sans-serif", wordBreak: "break-word" }}>
                    {selectedFile.name}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, font: "400 12px/1.5 'JetBrains Mono', monospace" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--dv-text-3)" }}>Size</span>
                    <span>{formatSizeKb(selectedFile.size_kb)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--dv-text-3)" }}>Date</span>
                    <span>{formatDate(selectedFile.created)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--dv-text-3)" }}>Type</span>
                    <span>{selectedFile.ext ?? "—"}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingTop: 4 }}>
                    <span style={{ color: "var(--dv-text-3)" }}>Path</span>
                    <span style={{ wordBreak: "break-all", color: "var(--dv-text-2)" }}>{selectedFile.rel_path}</span>
                  </div>
                </div>
              </div>
            ) : (
              <span style={{ font: "400 13px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
                Select a file to see details.
              </span>
            )}
          </aside>
        </div>
      )}

      {tab === "overview" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <div
              style={{
                padding: 16,
                border: "1px solid var(--dv-border)",
                borderRadius: 11,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Category breakdown</span>
              {(catQuery.data ?? []).map((c) => (
                <div key={c.category} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, flex: "none", borderRadius: 2, background: categoryColor(c.category) }} />
                  <span style={{ flex: 1, font: "400 12px/1 'Instrument Sans', system-ui, sans-serif", textTransform: "capitalize" }}>
                    {c.category}
                  </span>
                  <span className="dv-mono" style={{ fontSize: 11, color: "var(--dv-text-3)" }}>
                    {formatCount(c.files)}
                  </span>
                </div>
              ))}
            </div>
            <div
              style={{
                padding: 16,
                border: "1px solid var(--dv-border)",
                borderRadius: 11,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Largest files</span>
              {(largestQuery.data ?? []).map((f) => (
                <div
                  key={f.file_id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    font: "400 12px/1.3 'Instrument Sans', system-ui, sans-serif",
                  }}
                >
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  <span className="dv-mono" style={{ flex: "none", color: "var(--dv-text-3)" }}>
                    {formatSizeKb(f.size_kb)}
                  </span>
                </div>
              ))}
            </div>
            <div
              style={{
                padding: 16,
                border: "1px solid var(--dv-border)",
                borderRadius: 11,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Extensions</span>
              {(extQuery.data ?? []).map((e) => (
                <div
                  key={e.ext}
                  style={{ display: "flex", justifyContent: "space-between", font: "400 12px/1 'JetBrains Mono', monospace" }}
                >
                  <span>{e.ext || "(none)"}</span>
                  <span style={{ color: "var(--dv-text-3)" }}>{formatCount(e.files)}</span>
                </div>
              ))}
            </div>
            <div
              style={{
                padding: 16,
                border: "1px solid var(--dv-border)",
                borderRadius: 11,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>AI classification</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {aiModels.length > 0 ? (
                    <select
                      value={aiModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      disabled={analyzing}
                      title="Gemini model to use for this analysis"
                      style={{
                        width: 148,
                        minHeight: 26,
                        padding: "0 6px",
                        border: "1px solid var(--dv-border-2)",
                        borderRadius: 7,
                        background: "var(--dv-bg-sub)",
                        font: "400 11px/1 'JetBrains Mono', monospace",
                      }}
                    >
                      {!aiModels.some((m) => m.name === aiModel) && <option value={aiModel}>{aiModel}</option>}
                      {aiModels.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={aiModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      disabled={analyzing}
                      title="Gemini model to use for this analysis"
                      style={{
                        width: 128,
                        minHeight: 26,
                        padding: "0 8px",
                        border: "1px solid var(--dv-border-2)",
                        borderRadius: 7,
                        background: "var(--dv-bg-sub)",
                        font: "400 11px/1 'JetBrains Mono', monospace",
                      }}
                    />
                  )}
                  <button
                    type="button"
                    onClick={analyzeWithAi}
                    disabled={analyzing}
                    style={{
                      minHeight: 26,
                      padding: "0 10px",
                      border: "1px solid var(--dv-border-2)",
                      borderRadius: 7,
                      background: "var(--dv-bg-sub)",
                      font: "500 11px/1 'Instrument Sans', system-ui, sans-serif",
                      cursor: analyzing ? "default" : "pointer",
                      opacity: analyzing ? 0.6 : 1,
                    }}
                  >
                    {analyzing ? "Analyzing…" : aiClassification ? "Re-analyze" : "Analyze with AI"}
                  </button>
                </div>
              </div>
              {aiClassification ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ font: "600 13px/1.3 'Instrument Sans', system-ui, sans-serif" }}>{aiClassification.label}</span>
                  <span style={{ font: "400 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)" }}>
                    {aiClassification.summary}
                  </span>
                  <span className="dv-mono" style={{ fontSize: 10, color: "var(--dv-text-3)" }}>
                    {aiClassification.confidence} confidence · {formatDate(aiClassification.analyzedAt)}
                  </span>
                </div>
              ) : (
                <span style={{ font: "400 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
                  Not analyzed yet — suggests a category from this disc's folder and file names via Gemini.
                </span>
              )}
              {aiError && (
                <span style={{ font: "400 11px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-err)" }}>{aiError}</span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Notes</span>
            <textarea
              value={notes ?? ""}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="Notes about this disc…"
              style={{
                minHeight: 110,
                padding: 12,
                border: "1px solid var(--dv-border)",
                borderRadius: 10,
                background: "var(--dv-bg-sub)",
                outline: "none",
                font: "400 13px/1.5 'JetBrains Mono', monospace",
                resize: "vertical",
              }}
            />
          </div>
        </div>
      )}

      {tab === "activity" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "20px 24px" }}>
          <span style={{ font: "400 13px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
            No activity recorded yet. Scan and edit history will appear here.
          </span>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete disc #${discNo}?`}
          description="This removes the disc and everything in it from this device. It also deletes it from your account the next time you sync."
          matchText={String(discNo)}
          matchLabel={String(discNo)}
          confirmLabel="Delete disc"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

const crumbStyle = {
  border: 0,
  background: "transparent",
  cursor: "pointer",
  padding: "2px 4px",
  font: "400 12px/1 'JetBrains Mono', monospace",
  color: "var(--dv-text-2)",
} as const;
