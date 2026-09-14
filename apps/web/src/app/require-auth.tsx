import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { useSession } from "./session.js";

/** Every in-app route (§8 "App shell on every screen") needs a signed-in session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, error, retry } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "signed-out") navigate({ to: "/login" });
  }, [status, navigate]);

  if (status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dv-text-3)" }}>
        <span style={{ font: "500 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Loading DiscVault…</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}
      >
        <span style={{ font: "600 15px/1.2 'Instrument Sans', system-ui, sans-serif" }}>Couldn't reach DiscVault</span>
        {error && (
          <span
            style={{
              maxWidth: 480,
              padding: "0 16px",
              textAlign: "center",
              overflowWrap: "anywhere",
              color: "var(--dv-text-3)",
              font: "400 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {error}
          </span>
        )}
        <button
          type="button"
          onClick={retry}
          style={{
            minHeight: 36,
            padding: "0 14px",
            border: 0,
            borderRadius: 8,
            background: "var(--dv-accent)",
            color: "#fff",
            font: "500 13px/1 'Instrument Sans', system-ui, sans-serif",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (status === "signed-out") return null;

  return <>{children}</>;
}
