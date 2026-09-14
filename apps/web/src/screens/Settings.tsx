import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type ChangeEvent, type ReactNode, useRef, useState } from "react";
import { signOut as authSignOut } from "../account/auth-client.js";
import { apiRequest } from "../account/session.js";
import { type Preferences, usePreferences } from "../app/preferences.js";
import { useSession } from "../app/session.js";
import { useTheme } from "../app/theme.js";
import type { ArchivePreview } from "../archive/import.js";
import { vaultWorker } from "../db/rpc.js";
import { initials } from "../ui/format.js";
import { ConfirmDialog } from "../ui/primitives.js";

const CATEGORIES = ["video", "audio", "image", "document", "archive", "software", "other"];

type Tab = "account" | "preferences" | "categories" | "import" | "operator";
const TABS: { id: Tab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "preferences", label: "Preferences" },
  { id: "categories", label: "Categories" },
  { id: "import", label: "Import & export" },
  { id: "operator", label: "Operator" },
];

/** §8 screen 9: account, preferences, categories, import/export and (for operators) admin controls. */
export default function Settings() {
  const params = useParams({ strict: false }) as { _splat?: string };
  const tab = (TABS.find((t) => t.id === params._splat)?.id ?? "account") as Tab;
  const { account } = useSession();

  const visibleTabs = TABS.filter((t) => t.id !== "operator" || account?.operator);

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <aside
        style={{
          width: 190,
          flex: "none",
          borderRight: "1px solid var(--dv-border)",
          padding: "18px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {visibleTabs.map((t) => (
          <Link
            key={t.id}
            to="/settings/$"
            params={{ _splat: t.id }}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              minHeight: 32,
              padding: "0 10px",
              borderRadius: 7,
              textAlign: "left",
              textDecoration: "none",
              background: tab === t.id ? "var(--dv-accent-soft)" : "transparent",
              color: tab === t.id ? "var(--dv-accent)" : "var(--dv-text-2)",
              font: "500 13px/1 'Instrument Sans', system-ui, sans-serif",
            }}
          >
            {t.label}
          </Link>
        ))}
      </aside>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "22px 26px 56px" }}>
        {tab === "account" && <AccountTab />}
        {tab === "preferences" && <PreferencesTab />}
        {tab === "categories" && <CategoriesTab />}
        {tab === "import" && <ImportExportTab />}
        {tab === "operator" && account?.operator && <OperatorTab />}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <span style={{ font: "700 18px/1.2 'Instrument Sans', system-ui, sans-serif" }}>{children}</span>;
}

function AccountTab() {
  const { account, signOut } = useSession();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!account) return null;

  const doSignOut = async () => {
    await authSignOut();
    navigate({ to: "/login" });
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await apiRequest("DELETE", "/account", { confirmEmail: account.user.email });
      await signOut();
      navigate({ to: "/login" });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 560 }}>
      <SectionTitle>Account</SectionTitle>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 16, border: "1px solid var(--dv-border)", borderRadius: 12 }}>
        <span
          style={{
            width: 48,
            height: 48,
            flex: "none",
            borderRadius: "50%",
            background: "var(--dv-accent)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: "600 17px/1 'Instrument Sans', system-ui, sans-serif",
          }}
        >
          {initials(account.user.name, account.user.email)}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ font: "600 15px/1.2 'Instrument Sans', system-ui, sans-serif" }}>{account.user.name ?? account.user.email}</span>
          <span className="dv-mono" style={{ fontSize: 12, color: "var(--dv-text-3)" }}>
            {account.user.email}
          </span>
        </div>
        <span
          style={{
            marginLeft: "auto",
            padding: "3px 9px",
            borderRadius: 99,
            background: "var(--dv-off-soft)",
            color: "var(--dv-text-3)",
            font: "500 11px/1.5 'Instrument Sans', system-ui, sans-serif",
            whiteSpace: "nowrap",
          }}
        >
          Managed by Google
        </span>
      </div>
      <button
        type="button"
        onClick={doSignOut}
        style={{
          alignSelf: "flex-start",
          minHeight: 34,
          padding: "0 13px",
          border: "1px solid var(--dv-border-2)",
          borderRadius: 8,
          background: "var(--dv-bg-sub)",
          font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
          cursor: "pointer",
        }}
      >
        Sign out
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--dv-err)", borderRadius: 12 }}>
        <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-err)" }}>Danger zone</span>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          disabled={deleting}
          style={{
            alignSelf: "flex-start",
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
          Delete my account and catalog
        </button>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete your account?"
          description="This deletes your catalog and every device's copy of it. This can't be undone."
          matchText={account.user.email}
          matchLabel={account.user.email}
          confirmLabel="Delete account"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ font: "400 13px/1 'Instrument Sans', system-ui, sans-serif" }}>{label}</span>
      {children}
    </div>
  );
}

const selectStyle = {
  height: 32,
  padding: "0 8px",
  border: "1px solid var(--dv-border)",
  borderRadius: 7,
  background: "var(--dv-bg-sub)",
  font: "400 12px/1 'Instrument Sans', system-ui, sans-serif",
} as const;
const checkStyle = { width: 15, height: 15, accentColor: "var(--dv-accent)" } as const;

function PreferencesTab() {
  const { theme, setTheme } = useTheme();
  const { prefs, setPref } = usePreferences();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560 }}>
      <SectionTitle>Preferences</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Row label="Theme">
          <select value={theme} onChange={(e) => setTheme(e.target.value as "light" | "dark")} style={selectStyle}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Row>
        <Row label="Size units">
          <select
            value={prefs.sizeUnits}
            onChange={(e) => setPref("sizeUnits", e.target.value as Preferences["sizeUnits"])}
            style={selectStyle}
          >
            <option value="decimal">Decimal (GB)</option>
            <option value="binary">Binary (GiB)</option>
          </select>
        </Row>
        <Row label="Date format">
          <select
            value={prefs.dateFormat}
            onChange={(e) => setPref("dateFormat", e.target.value as Preferences["dateFormat"])}
            style={selectStyle}
          >
            <option value="iso">YYYY-MM-DD</option>
            <option value="us">MM/DD/YYYY</option>
            <option value="long">DD Mon YYYY</option>
          </select>
        </Row>
        <Row label="Default search scope">
          <select
            value={prefs.defaultSearchScope}
            onChange={(e) => setPref("defaultSearchScope", e.target.value as Preferences["defaultSearchScope"])}
            style={selectStyle}
          >
            <option>Files</option>
            <option>Folders</option>
            <option>Both</option>
          </select>
        </Row>
        <Row label="Show drive letter">
          <input
            type="checkbox"
            checked={prefs.showDriveLetter}
            onChange={(e) => setPref("showDriveLetter", e.target.checked)}
            style={checkStyle}
          />
        </Row>
        <Row label="Lite mode (smaller search index)">
          <input type="checkbox" checked={prefs.liteMode} onChange={(e) => setPref("liteMode", e.target.checked)} style={checkStyle} />
        </Row>
        <Row label="Local-only mode (sync off)">
          <input type="checkbox" checked={prefs.localOnly} onChange={(e) => setPref("localOnly", e.target.checked)} style={checkStyle} />
        </Row>
        <Row label="Sync on Wi-Fi only">
          <input type="checkbox" checked={prefs.wifiOnly} onChange={(e) => setPref("wifiOnly", e.target.checked)} style={checkStyle} />
        </Row>
      </div>
    </div>
  );
}

function CategoriesTab() {
  const queryClient = useQueryClient();
  const mapQuery = useQuery({ queryKey: ["ext-category-map"], queryFn: () => vaultWorker().extensionCategoryMap() });
  const countsQuery = useQuery({ queryKey: ["ext-counts"], queryFn: () => vaultWorker().allExtensionCounts() });

  const mapped = (countsQuery.data ?? []).filter((e) => e.ext && mapQuery.data?.[e.ext]);
  const unmapped = (countsQuery.data ?? []).filter((e) => e.ext && !mapQuery.data?.[e.ext]);

  const setCategory = async (ext: string, category: string) => {
    await vaultWorker().setCategoryOverride(ext, category);
    await queryClient.invalidateQueries({ queryKey: ["ext-category-map"] });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 640 }}>
      <SectionTitle>Categories</SectionTitle>
      <div style={{ border: "1px solid var(--dv-border)", borderRadius: 11, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            padding: "0 14px",
            height: 30,
            alignItems: "center",
            background: "var(--dv-bg-sub)",
            borderBottom: "1px solid var(--dv-border)",
            font: "500 10px/1 'JetBrains Mono', monospace",
            letterSpacing: ".07em",
            textTransform: "uppercase",
            color: "var(--dv-text-3)",
          }}
        >
          <span>Extension</span>
          <span>Category</span>
        </div>
        {mapped.slice(0, 40).map((e) => (
          <div
            key={e.ext}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              padding: "0 14px",
              height: 34,
              alignItems: "center",
              borderBottom: "1px solid var(--dv-border)",
            }}
          >
            <span className="dv-mono" style={{ fontSize: 12 }}>
              .{e.ext}
            </span>
            <select
              value={mapQuery.data?.[e.ext]}
              onChange={(ev) => setCategory(e.ext, ev.target.value)}
              style={{ ...selectStyle, height: 28, textTransform: "capitalize" }}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c} style={{ textTransform: "capitalize" }}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {unmapped.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Unmapped extensions</span>
          {unmapped.slice(0, 15).map((e) => (
            <div
              key={e.ext}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 0",
                borderBottom: "1px solid var(--dv-border)",
                font: "400 12px/1 'JetBrains Mono', monospace",
              }}
            >
              <span>{e.ext || "(none)"}</span>
              <span style={{ color: "var(--dv-text-3)" }}>{e.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type ImportStage = "idle" | "reading" | "preview" | "importing" | "done" | "error";

function ImportExportTab() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<ImportStage>("idle");
  const [preview, setPreview] = useState<ArchivePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [exporting, setExporting] = useState(false);

  const pick = () => fileInput.current?.click();

  const onChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setStage("reading");
    setError(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      setBytes(buf);
      const p = await vaultWorker().previewArchive(buf);
      setPreview(p);
      setStage("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that archive");
      setStage("error");
    }
  };

  const doImport = async () => {
    if (!bytes || !preview) return;
    setStage("importing");
    try {
      const resolutions = Object.fromEntries(preview.collisions.map((n: number) => [n, "skip" as const]));
      await vaultWorker().importArchive(bytes, resolutions);
      setStage("done");
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStage("error");
    }
  };

  const exportDvault = async () => {
    setExporting(true);
    try {
      const { zip } = await vaultWorker().exportArchive();
      const blob = new Blob([new Uint8Array(zip)], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `discvault-export-${new Date().toISOString().slice(0, 10)}.dvault`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 640 }}>
      <SectionTitle>Import & export</SectionTitle>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={pick}
          disabled={stage === "reading" || stage === "importing"}
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
          Import archive (.dvault)
        </button>
        <input ref={fileInput} type="file" accept=".dvault" onChange={onChosen} style={{ display: "none" }} />
        <button
          type="button"
          onClick={exportDvault}
          disabled={exporting}
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
          {exporting ? "Building…" : "Export as .dvault"}
        </button>
      </div>
      <div style={{ height: 1, background: "var(--dv-border)" }} />
      {stage === "idle" && (
        <span style={{ font: "400 13px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)" }}>
          Import brings discs, folders and files into your own catalog only — it never touches anyone else's data.
        </span>
      )}
      {stage === "reading" && (
        <div
          style={{ display: "flex", alignItems: "center", gap: 10, padding: 14, border: "1px solid var(--dv-border)", borderRadius: 10 }}
        >
          <span className="dv-mono" style={{ fontSize: 14, color: "var(--dv-accent)" }}>
            ◐
          </span>
          <span style={{ font: "400 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Validating archive…</span>
        </div>
      )}
      {stage === "preview" && preview && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, border: "1px solid var(--dv-border)", borderRadius: 10 }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {[
              { label: "discs", value: preview.counts.discs },
              { label: "folders", value: preview.counts.folders },
              { label: "files", value: preview.counts.files },
              { label: "missing numbers", value: preview.missing_disc_numbers.length, color: "var(--dv-warn)" },
              { label: "invalid dates", value: preview.invalid_dates, color: "var(--dv-warn)" },
              {
                label: "disc-number collisions",
                value: preview.collisions.length,
                color: preview.collisions.length ? "var(--dv-warn)" : "var(--dv-ok)",
              },
            ].map((s) => (
              <div key={s.label}>
                <span style={{ display: "block", font: "700 18px/1.2 'JetBrains Mono', monospace", color: s.color }}>{s.value}</span>
                <span style={{ font: "400 11px/1 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>{s.label}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={doImport}
            style={{
              alignSelf: "flex-start",
              minHeight: 32,
              padding: "0 13px",
              border: 0,
              borderRadius: 8,
              background: "var(--dv-accent)",
              color: "#fff",
              font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
              cursor: "pointer",
            }}
          >
            Import
          </button>
        </div>
      )}
      {stage === "importing" && (
        <div
          style={{ display: "flex", alignItems: "center", gap: 10, padding: 14, border: "1px solid var(--dv-border)", borderRadius: 10 }}
        >
          <span className="dv-mono" style={{ fontSize: 14, color: "var(--dv-accent)" }}>
            ◐
          </span>
          <span style={{ font: "400 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Importing…</span>
        </div>
      )}
      {stage === "done" && (
        <span style={{ font: "500 13px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-ok)" }}>Import complete.</span>
      )}
      {stage === "error" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: 14,
            border: "1px solid var(--dv-err)",
            borderRadius: 10,
            background: "var(--dv-err-soft)",
          }}
        >
          <span className="dv-mono" style={{ fontSize: 14, color: "var(--dv-err)" }}>
            ✕
          </span>
          <span style={{ flex: 1, font: "500 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-err)" }}>{error}</span>
        </div>
      )}
    </div>
  );
}

function OperatorTab() {
  const queryClient = useQueryClient();
  const usageQuery = useQuery({
    queryKey: ["ops-usage"],
    queryFn: () =>
      apiRequest<{ users: number; vaults: number; signupMode: "invite" | "open" | "closed"; maxUsers: number }>("GET", "/ops/usage"),
  });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);

  const setSignupMode = async (signupMode: "invite" | "open" | "closed") => {
    await apiRequest("PUT", "/ops/config", { signupMode });
    await queryClient.invalidateQueries({ queryKey: ["ops-usage"] });
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    const result = await apiRequest<{ invited: string }>("POST", "/ops/invites", { email: inviteEmail });
    setInviteStatus(`Invited ${result.invited}`);
    setInviteEmail("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 640 }}>
      <SectionTitle>Operator</SectionTitle>
      <span style={{ font: "400 12px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
        No access to other users' data — only account and usage controls.
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Sign-up mode</span>
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: 2,
            border: "1px solid var(--dv-border)",
            borderRadius: 9,
            background: "var(--dv-bg-sub)",
            width: "fit-content",
          }}
        >
          {(["invite", "open", "closed"] as const).map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => setSignupMode(m)}
              style={{
                minHeight: 30,
                padding: "0 13px",
                border: 0,
                borderRadius: 7,
                cursor: "pointer",
                font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
                background: usageQuery.data?.signupMode === m ? "var(--dv-bg)" : "transparent",
                color: usageQuery.data?.signupMode === m ? "var(--dv-text)" : "var(--dv-text-3)",
                textTransform: "capitalize",
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 280 }}>
        <span style={{ font: "400 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Users</span>
        <span className="dv-mono" style={{ fontSize: 13 }}>
          {usageQuery.data ? `${usageQuery.data.users} of ${usageQuery.data.maxUsers} max` : "…"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Invite a user</span>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="someone@example.com"
            style={{
              flex: 1,
              height: 34,
              padding: "0 10px",
              border: "1px solid var(--dv-border)",
              borderRadius: 8,
              background: "var(--dv-bg-sub)",
              outline: "none",
              font: "400 13px/1 'JetBrains Mono', monospace",
            }}
          />
          <button
            type="button"
            onClick={sendInvite}
            style={{
              minHeight: 34,
              padding: "0 13px",
              border: 0,
              borderRadius: 8,
              background: "var(--dv-accent)",
              color: "#fff",
              font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
              cursor: "pointer",
            }}
          >
            Invite
          </button>
        </div>
        {inviteStatus && (
          <span className="dv-mono" style={{ fontSize: 11, color: "var(--dv-ok)" }}>
            {inviteStatus}
          </span>
        )}
      </div>
    </div>
  );
}
