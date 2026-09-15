import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { DiscContentType } from "../ai/classification.js";
import type { DiscItemWithSource } from "../db/disc-items.js";
import { vaultWorker } from "../db/rpc.js";
import { formatDate } from "../ui/format.js";
import { GenreIcon, type IconKind } from "../ui/genre-icon.js";
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {CONTENT_TYPES.map((ct) => (
          <CategoryCard
            key={ct}
            label={CONTENT_TYPE_LABEL[ct]}
            kind="title"
            count={counts.get(ct) ?? 0}
            onClick={() => navigate({ to: "/titles/$type", params: { type: ct } })}
          />
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {genreCounts.map((g) => (
              <CategoryCard
                key={g.genre}
                label={g.genre}
                kind="genre"
                count={g.count}
                onClick={() => navigate({ to: "/titles/genre/$genre", params: { genre: g.genre } })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** One browsable bucket (content type or genre): icon tile, name with its title count, and a chevron. */
function CategoryCard({ label, kind, count, onClick }: { label: string; kind: IconKind; count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="dv-category-card" data-empty={count === 0 || undefined}>
      <span className="dv-category-card__icon">
        <GenreIcon name={label} type={kind} size={18} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
        <span
          title={label}
          style={{
            font: "600 14px/1.2 'Instrument Sans', system-ui, sans-serif",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <span style={{ font: "400 12px/1.2 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
          <span className="dv-mono" style={{ color: "var(--dv-text-2)" }}>
            {count}
          </span>{" "}
          {count === 1 ? "title" : "titles"}
        </span>
      </span>
      <svg
        className="dv-category-card__chevron"
        viewBox="0 0 24 24"
        width={16}
        height={16}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
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
  const [viewMode, setViewMode] = useState<"list" | "grid">(
    () => (localStorage.getItem("discvault:titles-view-mode") as "list" | "grid") || "grid",
  );

  const changeViewMode = (mode: "list" | "grid") => {
    setViewMode(mode);
    localStorage.setItem("discvault:titles-view-mode", mode);
  };

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ font: "700 19px/1.2 'Instrument Sans', system-ui, sans-serif" }}>{heading}</span>
          <div
            style={{
              display: "flex",
              gap: 4,
              background: "var(--dv-bg-sub)",
              padding: 3,
              borderRadius: 8,
              border: "1px solid var(--dv-border)",
            }}
          >
            <button
              type="button"
              onClick={() => changeViewMode("list")}
              style={{
                border: 0,
                background: viewMode === "list" ? "var(--dv-bg)" : "transparent",
                color: viewMode === "list" ? "var(--dv-text)" : "var(--dv-text-3)",
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "'Instrument Sans', system-ui, sans-serif",
                transition: "all 0.1s ease",
              }}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => changeViewMode("grid")}
              style={{
                border: 0,
                background: viewMode === "grid" ? "var(--dv-bg)" : "transparent",
                color: viewMode === "grid" ? "var(--dv-text)" : "var(--dv-text-3)",
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "'Instrument Sans', system-ui, sans-serif",
                transition: "all 0.1s ease",
              }}
            >
              Grid
            </button>
          </div>
        </div>
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
            <div style={viewMode === "grid" ? gridContainerStyle : listContainerStyle}>
              {groupItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setDrawerItem(item)}
                  style={viewMode === "grid" ? itemGridStyle : itemRowStyle}
                >
                  <ItemPreviewImage
                    itemId={item.id}
                    imageUrl={item.imageUrl}
                    style={viewMode === "grid" ? itemGridThumbnailStyle : itemThumbnailStyle}
                    contentType={item.contentType}
                  />
                  <div style={viewMode === "grid" ? itemGridContentStyle : itemRowContentStyle}>
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
                  {viewMode === "list" && <span style={discBadgeStyle}>#{item.discNo}</span>}
                  {viewMode === "grid" && <span style={gridDiscBadgeStyle}>#{item.discNo}</span>}
                </button>
              ))}
            </div>
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
            <ItemPreviewImage
              itemId={drawerItem.id}
              imageUrl={drawerItem.imageUrl}
              style={drawerImageStyle}
              contentType={drawerItem.contentType}
            />
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

const gridContainerStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(135px, 1fr))",
  gap: 16,
  padding: "12px 4px",
} as const;

const listContainerStyle = {
  display: "flex",
  flexDirection: "column" as const,
} as const;

const itemGridStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 8,
  padding: "10px 10px 14px",
  borderRadius: 12,
  border: "1px solid var(--dv-border)",
  background: "var(--dv-bg-sub)",
  textAlign: "left" as const,
  cursor: "pointer",
  position: "relative" as const,
  minWidth: 0,
} as const;

const itemGridThumbnailStyle = {
  width: "100%",
  aspectRatio: "2 / 3",
  borderRadius: 8,
  objectFit: "cover" as const,
  background: "var(--dv-bg)",
} as const;

const itemGridContentStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 4,
  minWidth: 0,
} as const;

const gridDiscBadgeStyle = {
  position: "absolute" as const,
  top: 16,
  right: 16,
  padding: "2px 6px",
  borderRadius: 4,
  background: "rgba(0, 0, 0, 0.7)",
  backdropFilter: "blur(4px)",
  color: "var(--dv-accent)",
  font: "700 10px/1.3 'JetBrains Mono', monospace",
} as const;

const itemRowContentStyle = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column" as const,
  gap: 4,
} as const;

const itemRowStyle = {
  display: "flex",
  width: "100%",
  alignItems: "center",
  gap: 16,
  minHeight: 80,
  padding: "8px 4px",
  border: 0,
  borderBottom: "1px solid var(--dv-border)",
  background: "transparent",
  textAlign: "left",
  cursor: "pointer",
} as const;

const itemThumbnailStyle = {
  width: 64,
  height: 64,
  flex: "none",
  borderRadius: 8,
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
