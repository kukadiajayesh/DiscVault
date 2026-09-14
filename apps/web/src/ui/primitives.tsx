import { type ButtonHTMLAttributes, type CSSProperties, type ReactNode, useState } from "react";

/** Category keys used throughout the catalog (packages/schema seeds.ts CATEGORIES). */
export type CategoryKey = "video" | "audio" | "image" | "document" | "archive" | "software" | "other";

export function categoryColor(category: string): string {
  const key = (category || "other") as CategoryKey;
  const known: Record<CategoryKey, string> = {
    video: "var(--dv-cat-video)",
    audio: "var(--dv-cat-audio)",
    image: "var(--dv-cat-image)",
    document: "var(--dv-cat-document)",
    archive: "var(--dv-cat-archive)",
    software: "var(--dv-cat-software)",
    other: "var(--dv-cat-other)",
  };
  return known[key] ?? known.other;
}

export function CategoryDot({ category, size = 7 }: { category: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, flex: "none", borderRadius: 2, background: categoryColor(category), display: "inline-block" }}
    />
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariantStyle: Record<ButtonVariant, CSSProperties> = {
  primary: { border: 0, background: "var(--dv-accent)", color: "#fff" },
  secondary: { border: "1px solid var(--dv-border)", background: "var(--dv-bg-sub)", color: "var(--dv-text)" },
  ghost: { border: 0, background: "transparent", color: "var(--dv-text-2)" },
  danger: { border: "1px solid var(--dv-err)", background: "transparent", color: "var(--dv-err)" },
};

export function Button({
  variant = "secondary",
  style,
  children,
  ...rest
}: { variant?: ButtonVariant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      style={{
        minHeight: 36,
        padding: "0 14px",
        borderRadius: 8,
        cursor: "pointer",
        font: "500 13px/1 'Instrument Sans', system-ui, sans-serif",
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        ...buttonVariantStyle[variant],
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** The "#116" badge used everywhere a disc number is referenced. */
export function DiscBadge({ n, size = "sm" }: { n: number; size?: "sm" | "lg" }) {
  const lg = size === "lg";
  return (
    <span
      style={{
        flex: "none",
        padding: lg ? "6px 11px" : "3px 7px",
        borderRadius: lg ? 9 : 6,
        background: "var(--dv-accent-soft)",
        color: "var(--dv-accent)",
        font: `700 ${lg ? 17 : 12}px/1.2 'JetBrains Mono', monospace`,
      }}
    >
      #{n}
    </span>
  );
}

type Tone = "neutral" | "ok" | "warn" | "err" | "info" | "off";

const PILL_TONES: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: "var(--dv-accent-soft)", fg: "var(--dv-accent)" },
  ok: { bg: "var(--dv-ok-soft)", fg: "var(--dv-ok)" },
  warn: { bg: "var(--dv-warn-soft)", fg: "var(--dv-warn)" },
  err: { bg: "var(--dv-err-soft)", fg: "var(--dv-err)" },
  info: { bg: "var(--dv-info-soft)", fg: "var(--dv-info)" },
  off: { bg: "var(--dv-off-soft)", fg: "var(--dv-off)" },
};

export function Pill({ label, tone = "neutral", dot }: { label: ReactNode; tone?: Tone; dot?: string }) {
  const t = PILL_TONES[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flex: "none",
        padding: "2px 8px",
        borderRadius: 99,
        background: t.bg,
        color: t.fg,
        font: "500 11px/1.4 'JetBrains Mono', monospace",
      }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: 2, background: dot }} />}
      {label}
    </span>
  );
}

export function StatTile({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div
      style={{
        padding: 12,
        border: "1px solid var(--dv-border)",
        borderRadius: 11,
        background: "var(--dv-bg-sub)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span style={{ font: "700 20px/1 'JetBrains Mono', monospace", letterSpacing: "-.02em", color: color ?? "var(--dv-text)" }}>
        {value}
      </span>
      <span style={{ font: "400 11px/1.3 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>{label}</span>
    </div>
  );
}

export type SyncState = "synced" | "syncing" | "offline" | "pending" | "conflict" | "error";

export function SyncIndicator({ state, pending = 0 }: { state: SyncState; pending?: number }) {
  const map: Record<SyncState, { glyph: string; label: string; color: string }> = {
    synced: { glyph: "●", label: "Synced", color: "var(--dv-ok)" },
    syncing: { glyph: "◐", label: "Syncing…", color: "var(--dv-info)" },
    offline: { glyph: "○", label: "Offline", color: "var(--dv-text-3)" },
    pending: { glyph: "▲", label: `${pending} pending`, color: "var(--dv-warn)" },
    conflict: { glyph: "⚠", label: "Conflict", color: "var(--dv-err)" },
    error: { glyph: "⚠", label: "Sync failed", color: "var(--dv-err)" },
  };
  const m = map[state];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
        color: m.color,
      }}
    >
      <span className="dv-mono" aria-hidden="true">
        {m.glyph}
      </span>
      {m.label}
    </span>
  );
}

export function Meter({ pct, height = 6 }: { pct: number; height?: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ height, borderRadius: 99, background: "var(--dv-border)", overflow: "hidden" }}>
      <div style={{ width: `${clamped}%`, height: "100%", background: "var(--dv-accent)" }} />
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div
      style={{
        padding: "40px 20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 9,
        textAlign: "center",
        border: "1px dashed var(--dv-border-2)",
        borderRadius: 12,
      }}
    >
      <span style={{ font: "600 15px/1.2 'Instrument Sans', system-ui, sans-serif" }}>{title}</span>
      {description && (
        <span style={{ font: "400 13px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)", maxWidth: 420 }}>
          {description}
        </span>
      )}
      {action && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        font: "500 11px/1 'JetBrains Mono', monospace",
        letterSpacing: ".09em",
        textTransform: "uppercase",
        color: "var(--dv-text-3)",
      }}
    >
      {children}
    </span>
  );
}

/** Overlay used for both the desktop side drawer and the mobile bottom sheet (§8 overlays). */
export function Overlay({ onClose, side = "right", children }: { onClose: () => void; side?: "right" | "bottom"; children: ReactNode }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        justifyContent: side === "right" ? "flex-end" : "center",
        alignItems: side === "bottom" ? "flex-end" : "stretch",
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{ position: "absolute", inset: 0, border: 0, padding: 0, background: "rgba(0,0,0,.32)", cursor: "default" }}
      />
      <div
        style={{
          position: "relative",
          width: side === "right" ? 380 : "100%",
          maxWidth: side === "right" ? "92vw" : undefined,
          maxHeight: side === "bottom" ? "80vh" : undefined,
          height: side === "right" ? "100%" : undefined,
          background: "var(--dv-bg)",
          borderRadius: side === "bottom" ? "18px 18px 0 0" : 0,
          borderLeft: side === "right" ? "1px solid var(--dv-border)" : undefined,
          boxShadow: "var(--dv-shadow)",
          display: "flex",
          flexDirection: "column",
          padding: 24,
          gap: 16,
          overflow: "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Destructive-action confirm (§8 overlay E): the user must type `matchText` exactly before the
 * confirm button is enabled (disc number, or the account email for account deletion).
 */
export function ConfirmDialog({
  title,
  description,
  matchText,
  matchLabel,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  matchText: string;
  matchLabel: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Overlay onClose={onCancel} side="bottom">
      <span style={{ font: "700 16px/1.2 'Instrument Sans', system-ui, sans-serif" }}>{title}</span>
      <span style={{ font: "400 13px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)" }}>{description}</span>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ font: "500 12px/1 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)" }}>
          Type <span className="dv-mono">{matchLabel}</span> to confirm
        </span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{
            height: 38,
            padding: "0 11px",
            border: "1px solid var(--dv-border)",
            borderRadius: 8,
            background: "var(--dv-bg-sub)",
            outline: "none",
            font: "400 13px/1 'JetBrains Mono', monospace",
          }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" disabled={value !== matchText} onClick={onConfirm} style={{ opacity: value === matchText ? 1 : 0.5 }}>
          {confirmLabel}
        </Button>
      </div>
    </Overlay>
  );
}
