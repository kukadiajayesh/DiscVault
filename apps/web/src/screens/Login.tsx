import { useState } from "react";
import { signInWithGoogle } from "../account/auth-client.js";

const GOOGLE_G = (
  <svg viewBox="0 0 18 18" width={18} height={18} aria-hidden="true">
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
    />
    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
    <path
      fill="#EA4335"
      d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
    />
  </svg>
);

/** §8 screen 1: Google-only sign-in. First sign-in also creates the account and an empty vault (§3.3). */
export default function Login() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setPending(true);
    setError(null);
    try {
      await signInWithGoogle("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setPending(false);
    }
  };

  return (
    <div
      className="dv-login-grid"
      style={{ minHeight: "100vh", background: "var(--dv-bg)", display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}
    >
      <style>
        {
          "@media (max-width: 780px) { .dv-login-art { display: none !important; } .dv-login-grid { grid-template-columns: 1fr !important; } }"
        }
      </style>
      <div className="dv-login-grid-cell" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "56px 40px" }}>
        <div style={{ width: "100%", maxWidth: 376, display: "flex", flexDirection: "column", gap: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg viewBox="0 0 32 32" width={26} height={26} aria-hidden="true">
              <circle cx="16" cy="16" r="14.5" fill="none" stroke="var(--dv-text)" strokeWidth="1.6" />
              <circle cx="16" cy="16" r="4" fill="none" stroke="var(--dv-text)" strokeWidth="1.6" />
            </svg>
            <span style={{ font: "700 19px/1 'Instrument Sans', system-ui, sans-serif", letterSpacing: "-.01em" }}>DiscVault</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ font: "700 32px/1.1 'Instrument Sans', system-ui, sans-serif", letterSpacing: "-.025em" }}>
              Find any file on any disc, even offline
            </span>
            <span style={{ font: "400 15px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)" }}>
              Your scanned disc listings, searchable in milliseconds. Every result tells you which disc holds the file and where that disc
              is.
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            <button
              type="button"
              onClick={go}
              disabled={pending}
              style={{
                alignSelf: "flex-start",
                minHeight: 44,
                display: "flex",
                alignItems: "center",
                gap: 11,
                background: "#fff",
                border: "1px solid #dadce0",
                borderRadius: 9,
                cursor: pending ? "default" : "pointer",
                padding: "0 20px 0 14px",
                boxShadow: "0 1px 2px rgba(60,64,67,.16)",
                opacity: pending ? 0.7 : 1,
              }}
            >
              {GOOGLE_G}
              <span style={{ font: "500 14px/1 'Instrument Sans', system-ui, sans-serif", color: "#3c4043" }}>
                {pending ? "Opening Google…" : "Continue with Google"}
              </span>
            </button>
            {error && (
              <span style={{ font: "500 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-err)" }}>{error}</span>
            )}
            <span style={{ font: "400 12px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
              Your catalog is private to your Google account. Nobody else can search it.
            </span>
          </div>
        </div>
      </div>
      <div
        className="dv-login-art"
        style={{
          background: "var(--dv-panel)",
          borderLeft: "1px solid var(--dv-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 40,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "relative", width: 320, height: 320, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg viewBox="0 0 320 320" width={320} height={320} aria-hidden="true">
            <circle cx="160" cy="160" r="150" fill="none" stroke="var(--dv-border-2)" strokeWidth="1.5" />
            <circle cx="160" cy="160" r="120" fill="none" stroke="var(--dv-border)" strokeWidth="1" />
            <circle cx="160" cy="160" r="92" fill="none" stroke="var(--dv-border)" strokeWidth="1" />
            <circle cx="160" cy="160" r="40" fill="none" stroke="var(--dv-border-2)" strokeWidth="1.5" />
            <circle cx="160" cy="160" r="17" fill="var(--dv-panel)" stroke="var(--dv-border-2)" strokeWidth="1.5" />
            <path d="M160 10a150 150 0 0 1 130 75" stroke="var(--dv-accent)" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          </svg>
          <span
            style={{
              position: "absolute",
              bottom: 34,
              right: 6,
              padding: "7px 13px",
              borderRadius: 9,
              background: "var(--dv-text)",
              color: "var(--dv-bg)",
              font: "700 22px/1 'JetBrains Mono', monospace",
              boxShadow: "var(--dv-shadow)",
            }}
          >
            #116
          </span>
          <span
            style={{ position: "absolute", bottom: 8, right: 6, font: "400 12px/1 'JetBrains Mono', monospace", color: "var(--dv-text-3)" }}
          >
            Wallet 1, page 5
          </span>
        </div>
      </div>
    </div>
  );
}
