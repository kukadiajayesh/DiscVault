import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { DiscContentType } from "../ai/classification.js";
import type { DiscItemWithSource } from "../db/disc-items.js";
import { vaultWorker } from "../db/rpc.js";
import { formatDate } from "../ui/format.js";
import { ItemPreviewImage } from "../ui/item-preview-image.js";
import { Overlay, SectionLabel } from "../ui/primitives.js";

const CONTENT_TYPES: DiscContentType[] = ["game", "movie", "software", "music", "mixed", "other"];

const CONTENT_TYPE_LABEL: Record<DiscContentType, string> = {
  game: "Games",
  movie: "Movies",
  software: "Software",
  music: "Songs",
  mixed: "Mixed",
  other: "Other",
};

/** Buckets items by a key, "Other"/empty last — used to nest one browsing dimension inside another. */
function groupItemsBy(items: DiscItemWithSource[], keyOf: (item: DiscItemWithSource) => string): [string, DiscItemWithSource[]][] {
  const groups = new Map<string, DiscItemWithSource[]>();
  for (const item of items) {
    const key = keyOf(item) || "Other";
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)));
}

/**
 * A virtual library of AI-identified items (§ AI: disc identification), browsed either by the fixed
 * content type or by one of the AI's own free-form genre tags — the AI invents genres per item, so
 * this library discovers what categories exist rather than assuming a fixed list.
 */
export default function Titles() {
  const params = useParams({ strict: false }) as { type?: string; genre?: string };
  if (params.genre) return <TitlesByGenre genre={params.genre} />;
  const type = params.type as DiscContentType | undefined;
  return type ? <TitlesByType type={type} /> : <TitlesCategories />;
}

function TitlesCategories() {
  const navigate = useNavigate();
  const countsQuery = useQuery({ queryKey: ["disc-item-type-counts"], queryFn: () => vaultWorker().discItemTypeCounts() });
  const counts = new Map((countsQuery.data ?? []).map((c) => [c.contentType, c.count]));
  const genreCountsQuery = useQuery({ queryKey: ["disc-item-genre-counts"], queryFn: () => vaultWorker().discItemGenreCounts() });
  const genreCounts = genreCountsQuery.data ?? [];

  return (
    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
      <span style={{ font: "700 19px/1.2 'Instrument Sans', system-ui, sans-serif" }}>Titles</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
        {CONTENT_TYPES.map((ct) => (
          <button type="button" key={ct} onClick={() => navigate({ to: "/titles/$type", params: { type: ct } })} style={categoryCardStyle}>
            <span style={{ font: "600 14px/1.2 'Instrument Sans', system-ui, sans-serif" }}>{CONTENT_TYPE_LABEL[ct]}</span>
            <span className="dv-mono" style={{ fontSize: 22, fontWeight: 700 }}>
              {counts.get(ct) ?? 0}
            </span>
          </button>
        ))}
      </div>
      {(countsQuery.data ?? []).length === 0 && !countsQuery.isLoading && (
        <span style={{ font: "400 13px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
          Nothing identified yet — use "Analyze with AI" on a disc's Overview tab to find games, movies, software and music on it.
        </span>
      )}
      {genreCounts.length > 0 && (
        <>
          <SectionLabel>Genres</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
            {genreCounts.map((g) => (
              <button
                type="button"
                key={g.genre}
                onClick={() => navigate({ to: "/titles/genre/$genre", params: { genre: g.genre } })}
                style={categoryCardStyle}
              >
                <span style={{ font: "600 14px/1.2 'Instrument Sans', system-ui, sans-serif" }}>{g.genre}</span>
                <span className="dv-mono" style={{ fontSize: 22, fontWeight: 700 }}>
                  {g.count}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TitlesByType({ type }: { type: DiscContentType }) {
  const itemsQuery = useQuery({ queryKey: ["disc-items-by-type", type], queryFn: () => vaultWorker().discItemsByType(type) });
  return (
    <TitlesGroupPage
      heading={CONTENT_TYPE_LABEL[type]}
      emptyMessage={`Nothing identified as ${CONTENT_TYPE_LABEL[type].toLowerCase()} yet.`}
      itemsQuery={itemsQuery}
      groupKey={(item) => item.genres[0] ?? ""}
      groupLabel={(genre) => `${CONTENT_TYPE_LABEL[type]} · ${genre}`}
    />
  );
}

function TitlesByGenre({ genre }: { genre: string }) {
  const itemsQuery = useQuery({ queryKey: ["disc-items-by-genre", genre], queryFn: () => vaultWorker().discItemsByGenre(genre) });
  return (
    <TitlesGroupPage
      heading={genre}
      emptyMessage={`Nothing identified as ${genre} yet.`}
      itemsQuery={itemsQuery}
      groupKey={(item) => CONTENT_TYPE_LABEL[item.contentType]}
      groupLabel={(type) => `${genre} · ${type}`}
    />
  );
}

/** Shared "back / heading / grouped item list / detail drawer" shell for both browsing dimensions. */
function TitlesGroupPage({
  heading,
  emptyMessage,
  itemsQuery,
  groupKey,
  groupLabel,
}: {
  heading: string;
  emptyMessage: string;
  itemsQuery: { data?: DiscItemWithSource[]; isLoading: boolean };
  groupKey: (item: DiscItemWithSource) => string;
  groupLabel: (key: string) => string;
}) {
  const navigate = useNavigate();
  const [drawerItem, setDrawerItem] = useState<DiscItemWithSource | null>(null);
  const items = itemsQuery.data ?? [];
  const groups = groupItemsBy(items, groupKey);

  const openOnDisc = (item: DiscItemWithSource) => {
    if (!item.path) navigate({ to: "/discs/$no", params: { no: String(item.discNo) } });
    else navigate({ to: "/discs/$no/browse/$", params: { no: String(item.discNo), _splat: item.path } });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ flex: "none", padding: "16px 24px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        <button
          type="button"
          onClick={() => navigate({ to: "/titles" })}
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
          ← Titles
        </button>
        <span style={{ font: "700 19px/1.2 'Instrument Sans', system-ui, sans-serif" }}>{heading}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "12px 24px 24px" }}>
        {items.length === 0 && !itemsQuery.isLoading && (
          <span style={{ font: "400 13px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>{emptyMessage}</span>
        )}
        {groups.map(([key, groupItems]) => (
          <div key={key}>
            {groups.length > 1 && (
              <div
                style={{
                  padding: "14px 4px 6px",
                  font: "600 11px/1 'JetBrains Mono', monospace",
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "var(--dv-text-3)",
                }}
              >
                {groupLabel(key)}
              </div>
            )}
            {groupItems.map((item) => (
              <button type="button" key={item.id} onClick={() => setDrawerItem(item)} style={itemRowStyle}>
                <ItemPreviewImage itemId={item.id} imageUrl={item.imageUrl} style={itemThumbnailStyle} />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span
                    style={{
                      font: "600 13px/1.3 'Instrument Sans', system-ui, sans-serif",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.title ?? item.label}
                  </span>
                  <span className="dv-mono" style={{ fontSize: 11, color: "var(--dv-text-3)" }}>
                    {[item.platform, item.year].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <span style={discBadgeStyle}>#{item.discNo}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {drawerItem && (
        <Overlay onClose={() => setDrawerItem(null)}>
          <button
            type="button"
            onClick={() => setDrawerItem(null)}
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
            <ItemPreviewImage itemId={drawerItem.id} imageUrl={drawerItem.imageUrl} style={drawerImageStyle} />
            <span
              style={{
                padding: "1px 8px",
                borderRadius: 99,
                background: "var(--dv-off-soft)",
                font: "500 11px/1.6 'Instrument Sans', system-ui, sans-serif",
                textTransform: "capitalize",
                width: "fit-content",
              }}
            >
              {drawerItem.contentType}
            </span>
            <span style={{ font: "700 18px/1.3 'Instrument Sans', system-ui, sans-serif", wordBreak: "break-word" }}>
              {drawerItem.title ?? drawerItem.label}
            </span>
          </div>
          {drawerItem.title && (
            <span className="dv-mono" style={{ fontSize: 12, color: "var(--dv-text-3)" }}>
              {[drawerItem.platform, drawerItem.year, drawerItem.developer ?? drawerItem.publisher].filter(Boolean).join(" · ")}
            </span>
          )}
          <span style={{ font: "400 13px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)" }}>
            {drawerItem.title ? drawerItem.description : drawerItem.summary}
          </span>
          {drawerItem.genres.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {drawerItem.genres.map((genre) => (
                <button
                  type="button"
                  key={genre}
                  onClick={() => {
                    setDrawerItem(null);
                    navigate({ to: "/titles/genre/$genre", params: { genre } });
                  }}
                  style={genrePillStyle}
                >
                  {genre}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, font: "400 13px/1.6 'JetBrains Mono', monospace" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--dv-text-3)" }}>Source disc</span>
              <span>
                #{drawerItem.discNo} — {drawerItem.discTitle ?? drawerItem.discLabel ?? "Untitled"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--dv-text-3)" }}>Confidence</span>
              <span>
                {drawerItem.confidence} · {formatDate(drawerItem.analyzedAt)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openOnDisc(drawerItem)}
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
            Open on disc #{drawerItem.discNo}
          </button>
        </Overlay>
      )}
    </div>
  );
}

const categoryCardStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 18,
  border: "1px solid var(--dv-border)",
  borderRadius: 12,
  background: "var(--dv-bg-sub)",
  cursor: "pointer",
  textAlign: "left",
} as const;

const itemRowStyle = {
  display: "flex",
  width: "100%",
  alignItems: "center",
  gap: 12,
  minHeight: 52,
  padding: "8px 4px",
  border: 0,
  borderBottom: "1px solid var(--dv-border)",
  background: "transparent",
  textAlign: "left",
  cursor: "pointer",
} as const;

const itemThumbnailStyle = {
  width: 40,
  height: 40,
  flex: "none",
  borderRadius: 6,
  objectFit: "cover",
  background: "var(--dv-bg-sub)",
} as const;

const drawerImageStyle = {
  width: "100%",
  maxHeight: 220,
  borderRadius: 10,
  objectFit: "cover",
  background: "var(--dv-bg-sub)",
} as const;

const discBadgeStyle = {
  flex: "none",
  padding: "2px 7px",
  borderRadius: 5,
  background: "var(--dv-accent-soft)",
  color: "var(--dv-accent)",
  font: "700 12px/1.3 'JetBrains Mono', monospace",
} as const;

const genrePillStyle = {
  padding: "3px 9px",
  borderRadius: 99,
  border: "1px solid var(--dv-border-2)",
  background: "var(--dv-bg-sub)",
  color: "var(--dv-text-2)",
  font: "500 11px/1.4 'Instrument Sans', system-ui, sans-serif",
  cursor: "pointer",
} as const;
