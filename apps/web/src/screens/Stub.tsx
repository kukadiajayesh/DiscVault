import { useNavigate } from "@tanstack/react-router";

/**
 * §8: screens 10-14 (Duplicates, Statistics, Collections, Locations, Data health) are phase 4,
 * after the MVP — see PENDING.md. The nav entry, its position in the information architecture and
 * its route are set, so each can be designed and built next without moving anything else.
 */
export default function Stub({ title }: { title: string }) {
  const navigate = useNavigate();
  return (
    <div style={{ padding: "80px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
      <span style={{ font: "600 17px/1.2 'Instrument Sans', system-ui, sans-serif" }}>{title}</span>
      <span style={{ font: "400 13px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)", maxWidth: 420 }}>
        Not part of this batch. The nav entry, its counts and its position in the information architecture are set, so it can be designed
        next without moving anything else.
      </span>
      <button
        type="button"
        onClick={() => navigate({ to: "/" })}
        style={{
          marginTop: 6,
          minHeight: 34,
          padding: "0 14px",
          border: "1px solid var(--dv-border-2)",
          borderRadius: 8,
          background: "var(--dv-bg-sub)",
          font: "500 13px/1 'Instrument Sans', system-ui, sans-serif",
          cursor: "pointer",
        }}
      >
        Back to Dashboard
      </button>
    </div>
  );
}
