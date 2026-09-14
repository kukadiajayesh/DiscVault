import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useSession } from "../app/session.js";
import { vaultWorker } from "../db/rpc.js";
import { formatCount, formatSizeKb } from "../ui/format.js";
import { categoryColor } from "../ui/primitives.js";

function useDashboardData() {
  const missing = useQuery({ queryKey: ["missing-discs"], queryFn: () => vaultWorker().missingDiscNumbers() });
  const categories = useQuery({ queryKey: ["category-breakdown"], queryFn: () => vaultWorker().categoryBreakdown() });
  const mediaTypes = useQuery({ queryKey: ["media-type-breakdown"], queryFn: () => vaultWorker().mediaTypeBreakdown() });
  const discs = useQuery({ queryKey: ["discs-recent"], queryFn: () => vaultWorker().listDiscs() });
  const recentSearches = useQuery({ queryKey: ["recent-searches"], queryFn: () => vaultWorker().recentSearches(6) });
  return { missing, categories, mediaTypes, discs, recentSearches };
}

/** §8 screen 3: quick search, health alerts, catalog stats, mini charts, recent activity. */
export default function Dashboard() {
  const { stats } = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { missing, categories, mediaTypes, discs, recentSearches } = useDashboardData();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate({ to: "/search", search: { q } as never });
  };

  const empty = (stats?.discs ?? 0) === 0;
  const recentDiscs = [...(discs.data ?? [])].sort((a, b) => (b.scanned_at ?? "").localeCompare(a.scanned_at ?? "")).slice(0, 6);
  const maxCategory = Math.max(1, ...(categories.data ?? []).map((c) => c.files));
  const totalKb = mediaTypes.data?.reduce((sum, m) => sum + m.total_kb, 0) ?? 0;

  return (
    <div style={{ padding: "26px 24px 40px", display: "flex", flexDirection: "column", gap: 22, maxWidth: 1280 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        <span style={{ font: "700 22px/1.2 'Instrument Sans', system-ui, sans-serif", letterSpacing: "-.02em" }}>Which disc holds it?</span>
        <form
          onSubmit={submit}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            height: 52,
            padding: "0 16px",
            border: "1px solid var(--dv-border-2)",
            borderRadius: 11,
            background: "var(--dv-bg-sub)",
            boxShadow: "var(--dv-shadow)",
          }}
        >
          <svg viewBox="0 0 16 16" width={18} height={18} style={{ flex: "none", color: "var(--dv-text-3)" }} aria-hidden="true">
            <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="File name, folder, extension, disc number…"
            style={{
              flex: 1,
              minWidth: 0,
              border: 0,
              background: "transparent",
              outline: "none",
              font: "400 16px/1 'JetBrains Mono', monospace",
            }}
          />
          <button
            type="submit"
            style={{
              flex: "none",
              minHeight: 34,
              padding: "0 13px",
              border: 0,
              borderRadius: 8,
              background: "var(--dv-accent)",
              color: "#fff",
              font: "500 13px/1 'Instrument Sans', system-ui, sans-serif",
              cursor: "pointer",
            }}
          >
            Search
          </button>
        </form>
      </div>

      {empty ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            padding: "60px 24px",
            textAlign: "center",
            border: "1px dashed var(--dv-border-2)",
            borderRadius: 14,
          }}
        >
          <span style={{ font: "700 20px/1.2 'Instrument Sans', system-ui, sans-serif" }}>Your catalog is empty</span>
          <span style={{ font: "400 13px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)", maxWidth: 380 }}>
            Scan your first disc, or bring over a catalog you've already built on another device.
          </span>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => navigate({ to: "/scan" })}
              style={{
                minHeight: 40,
                padding: "0 18px",
                border: 0,
                borderRadius: 9,
                background: "var(--dv-accent)",
                color: "#fff",
                font: "600 13px/1 'Instrument Sans', system-ui, sans-serif",
                cursor: "pointer",
              }}
            >
              Scan your first disc
            </button>
            <button
              type="button"
              onClick={() => navigate({ to: "/setup" })}
              style={{
                minHeight: 40,
                padding: "0 18px",
                border: "1px solid var(--dv-border-2)",
                borderRadius: 9,
                background: "var(--dv-bg-sub)",
                font: "600 13px/1 'Instrument Sans', system-ui, sans-serif",
                cursor: "pointer",
              }}
            >
              Import archive
            </button>
          </div>
        </div>
      ) : (
        <>
          {(missing.data?.length ?? 0) > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 15px",
                border: "1px solid var(--dv-warn)",
                borderRadius: 10,
                background: "var(--dv-warn-soft)",
              }}
            >
              <span className="dv-mono" style={{ fontSize: 14, color: "var(--dv-warn)" }}>
                ⚠
              </span>
              <span
                style={{ flex: 1, minWidth: 0, font: "500 13px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-warn)" }}
              >
                {missing.data!.length} missing disc number{missing.data!.length === 1 ? "" : "s"}
              </span>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            {[
              { label: "Discs", value: formatCount(stats?.discs ?? 0) },
              { label: "Folders", value: formatCount(stats?.folders ?? 0) },
              { label: "Files", value: formatCount(stats?.files ?? 0) },
              { label: "Total size", value: formatSizeKb(stats?.totalKb) },
              {
                label: "Pending changes",
                value: formatCount(stats?.pendingChanges ?? 0),
                color: (stats?.pendingChanges ?? 0) > 0 ? "var(--dv-warn)" : undefined,
              },
              {
                label: "Missing numbers",
                value: formatCount(missing.data?.length ?? 0),
                color: (missing.data?.length ?? 0) > 0 ? "var(--dv-warn)" : undefined,
              },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  padding: "14px 15px",
                  border: "1px solid var(--dv-border)",
                  borderRadius: 11,
                  background: "var(--dv-bg-sub)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                }}
              >
                <span
                  style={{
                    font: "400 11px/1 'JetBrains Mono', monospace",
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    color: "var(--dv-text-3)",
                  }}
                >
                  {s.label}
                </span>
                <span
                  style={{ font: "700 24px/1.1 'JetBrains Mono', monospace", letterSpacing: "-.03em", color: s.color ?? "var(--dv-text)" }}
                >
                  {s.value}
                </span>
              </div>
            ))}
          </div>

          <div className="dv-dash-charts" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            <style>{"@media (max-width: 720px) { .dv-dash-charts { display: none !important; } }"}</style>
            <div
              style={{
                padding: 18,
                border: "1px solid var(--dv-border)",
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <span style={{ font: "600 14px/1 'Instrument Sans', system-ui, sans-serif" }}>Files by category</span>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 132 }}>
                {(categories.data ?? []).map((c) => (
                  <div
                    key={c.category}
                    style={{
                      flex: "1 1 0",
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      alignItems: "center",
                      gap: 6,
                      height: "100%",
                    }}
                  >
                    <span className="dv-mono" style={{ fontSize: 9, color: "var(--dv-text-3)", whiteSpace: "nowrap" }}>
                      {formatCount(c.files)}
                    </span>
                    <div
                      style={{
                        width: "100%",
                        height: `${Math.max(4, (c.files / maxCategory) * 100)}%`,
                        borderRadius: "4px 4px 0 0",
                        background: categoryColor(c.category),
                      }}
                    />
                    <span
                      style={{
                        font: "400 9.5px/1 'Instrument Sans', system-ui, sans-serif",
                        color: "var(--dv-text-2)",
                        whiteSpace: "nowrap",
                        textTransform: "capitalize",
                      }}
                    >
                      {c.category}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div
              style={{
                padding: 18,
                border: "1px solid var(--dv-border)",
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <span style={{ font: "600 14px/1 'Instrument Sans', system-ui, sans-serif" }}>Storage by media type</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {(mediaTypes.data ?? []).map((m) => (
                  <div key={m.media_type} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: "var(--dv-accent)", flex: "none" }} />
                    <span style={{ font: "500 13px/1 'Instrument Sans', system-ui, sans-serif", whiteSpace: "nowrap" }}>
                      {m.media_type}
                    </span>
                    <span className="dv-mono" style={{ fontSize: 12, color: "var(--dv-text-2)" }}>
                      {formatCount(m.discs)} discs · {formatSizeKb(m.total_kb)}
                    </span>
                  </div>
                ))}
                {totalKb > 0 && (
                  <span className="dv-mono" style={{ fontSize: 11, color: "var(--dv-text-3)" }}>
                    {formatSizeKb(totalKb)} total
                  </span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.35fr) minmax(0,1fr)", gap: 16 }}>
            <div style={{ border: "1px solid var(--dv-border)", borderRadius: 12, overflow: "hidden" }}>
              <div
                style={{
                  padding: "13px 16px",
                  borderBottom: "1px solid var(--dv-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ font: "600 14px/1 'Instrument Sans', system-ui, sans-serif" }}>Recently added or re-scanned</span>
              </div>
              {recentDiscs.length === 0 ? (
                <div style={{ padding: 16, font: "400 13px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
                  Nothing scanned yet.
                </div>
              ) : (
                recentDiscs.map((d) => (
                  <button
                    type="button"
                    key={d.disc_no}
                    onClick={() => navigate({ to: "/discs/$no", params: { no: String(d.disc_no) } })}
                    style={{
                      display: "flex",
                      width: "100%",
                      alignItems: "center",
                      gap: 12,
                      height: "var(--dv-row)",
                      padding: "0 16px",
                      border: 0,
                      borderBottom: "1px solid var(--dv-border)",
                      background: "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
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
                      #{d.disc_no}
                    </span>
                    <span
                      style={{
                        flex: "1 1 45%",
                        minWidth: 0,
                        font: "400 13px/1 'Instrument Sans', system-ui, sans-serif",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {d.title ?? d.label ?? `Disc ${d.disc_no}`}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div
                style={{
                  border: "1px solid var(--dv-border)",
                  borderRadius: 12,
                  padding: "15px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 11,
                }}
              >
                <span style={{ font: "600 14px/1 'Instrument Sans', system-ui, sans-serif" }}>Recent searches</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(recentSearches.data ?? []).length === 0 && (
                    <span style={{ font: "400 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
                      No searches yet.
                    </span>
                  )}
                  {(recentSearches.data ?? []).map((r) => (
                    <button
                      type="button"
                      key={r.q}
                      onClick={() => navigate({ to: "/search", search: { q: r.q } as never })}
                      style={{
                        minHeight: 28,
                        padding: "0 10px",
                        border: "1px solid var(--dv-border)",
                        borderRadius: 7,
                        background: "transparent",
                        font: "400 12px/1 'JetBrains Mono', monospace",
                        color: "var(--dv-text-2)",
                        cursor: "pointer",
                      }}
                    >
                      {r.q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
