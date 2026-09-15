import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type ChangeEvent, type ReactNode, useRef, useState } from "react";
import { signOut as authSignOut } from "../account/auth-client.js";
import { apiRequest } from "../account/session.js";
import { listGeminiModels } from "../ai/gemini.js";
import {
  addGeminiApiKey,
  DEFAULT_GEMINI_MODEL,
  type GeminiApiKeyEntry,
  getActiveGeminiKeyId,
  getGeminiModel,
  listGeminiApiKeys,
  removeGeminiApiKey,
  setActiveGeminiKeyId,
  setGeminiModel,
} from "../ai/gemini-key.js";
import { type Preferences, usePreferences } from "../app/preferences.js";
import { useSession } from "../app/session.js";
import { useTheme } from "../app/theme.js";
import type { ArchivePreview } from "../archive/import.js";
import { vaultWorker } from "../db/rpc.js";
import {
  addRawgApiKey,
  getActiveRawgKeyId,
  listRawgApiKeys,
  type RawgApiKeyEntry,
  removeRawgApiKey,
  setActiveRawgKeyId,
} from "../images/rawg-key.js";
import {
  addTmdbApiKey,
  getActiveTmdbKeyId,
  listTmdbApiKeys,
  removeTmdbApiKey,
  setActiveTmdbKeyId,
  type TmdbApiKeyEntry,
} from "../images/tmdb-key.js";
import { initials } from "../ui/format.js";
import { Icon, type IconName } from "../ui/icons.js";
import { ConfirmDialog, Pill } from "../ui/primitives.js";

const CATEGORIES = ["video", "audio", "image", "document", "archive", "software", "other"];

type Tab = "account" | "preferences" | "categories" | "ai" | "import";
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "account", label: "Account", icon: "Account" },
  { id: "preferences", label: "Preferences", icon: "Preferences" },
  { id: "categories", label: "Categories", icon: "Categories" },
  { id: "ai", label: "AI", icon: "AI" },
  { id: "import", label: "Import & export", icon: "Import" },
];

/** §8 screen 9: account, preferences, categories and import/export. */
export default function Settings() {
  const params = useParams({ strict: false }) as { _splat?: string };
  const tab = (TABS.find((t) => t.id === params._splat)?.id ?? "account") as Tab;

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
        {TABS.map((t) => (
          <Link
            key={t.id}
            to="/settings/$"
            params={{ _splat: t.id }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
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
            <Icon name={t.icon} size={15} color="currentColor" />
            <span>{t.label}</span>
          </Link>
        ))}
      </aside>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "22px 26px 56px" }}>
        {tab === "account" && <AccountTab />}
        {tab === "preferences" && <PreferencesTab />}
        {tab === "categories" && <CategoriesTab />}
        {tab === "ai" && <AiTab />}
        {tab === "import" && <ImportExportTab />}
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

function maskApiKey(key: string): string {
  if (key.length <= 10) return "•".repeat(Math.max(key.length, 4));
  return `${key.slice(0, 6)}${"•".repeat(6)}${key.slice(-4)}`;
}

/**
 * Add/list/activate/remove rows for one provider's API keys (§ image preview shares this shape with
 * the Gemini key list above it — same "only the active one is ever used" model, own localStorage
 * namespace per provider).
 */
function ApiKeyManager({
  radioName,
  keys,
  activeId,
  keyPlaceholder,
  onAdd,
  onActivate,
  onRemove,
}: {
  radioName: string;
  keys: { id: string; label: string; key: string }[];
  activeId: string | null;
  keyPlaceholder: string;
  onAdd: (key: string, label: string) => void;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const addKey = () => {
    const trimmed = newKey.trim();
    if (!trimmed) return;
    onAdd(trimmed, newLabel);
    setNewLabel("");
    setNewKey("");
  };

  const copyKey = async (id: string, key: string) => {
    await navigator.clipboard.writeText(key);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {keys.length === 0 && (
        <span style={{ font: "400 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>No keys added yet.</span>
      )}
      {keys.map((k) => (
        <div
          key={k.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 10px",
            border: "1px solid var(--dv-border)",
            borderRadius: 8,
            background: k.id === activeId ? "var(--dv-accent-soft)" : "var(--dv-bg-sub)",
          }}
        >
          <input
            type="radio"
            name={radioName}
            checked={k.id === activeId}
            onChange={() => onActivate(k.id)}
            title="Make this the active key"
            style={checkStyle}
          />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span style={{ font: "500 12px/1.3 'Instrument Sans', system-ui, sans-serif" }}>{k.label}</span>
            <span className="dv-mono" style={{ fontSize: 11, color: "var(--dv-text-3)" }}>
              {maskApiKey(k.key)}
            </span>
          </div>
          {k.id === activeId && <Pill label="Active" tone="ok" />}
          <button
            type="button"
            onClick={() => copyKey(k.id, k.key)}
            title={copiedId === k.id ? "Copied" : "Copy this key"}
            style={{
              display: "flex",
              alignItems: "center",
              border: 0,
              background: "transparent",
              color: copiedId === k.id ? "var(--dv-ok)" : "var(--dv-text-3)",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <Icon name="Copy" size={14} color="currentColor" />
          </button>
          <button
            type="button"
            onClick={() => onRemove(k.id)}
            title="Remove this key"
            style={{ border: 0, background: "transparent", color: "var(--dv-text-3)", cursor: "pointer", font: "600 15px/1 sans-serif" }}
          >
            ×
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Label (optional)"
          autoComplete="off"
          style={{
            width: 140,
            height: 34,
            padding: "0 10px",
            border: "1px solid var(--dv-border)",
            borderRadius: 8,
            background: "var(--dv-bg-sub)",
            font: "400 12px/1 'Instrument Sans', system-ui, sans-serif",
          }}
        />
        <input
          type="password"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addKey()}
          placeholder={keyPlaceholder}
          autoComplete="off"
          style={{
            flex: 1,
            minWidth: 160,
            height: 34,
            padding: "0 10px",
            border: "1px solid var(--dv-border)",
            borderRadius: 8,
            background: "var(--dv-bg-sub)",
            font: "400 12px/1 'JetBrains Mono', monospace",
          }}
        />
        <button
          type="button"
          onClick={addKey}
          disabled={!newKey.trim()}
          style={{
            minHeight: 34,
            padding: "0 13px",
            border: 0,
            borderRadius: 8,
            background: "var(--dv-accent)",
            color: "#fff",
            font: "500 12px/1 'Instrument Sans', system-ui, sans-serif",
            cursor: newKey.trim() ? "pointer" : "default",
            opacity: newKey.trim() ? 1 : 0.5,
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function AiTab() {
  const [keys, setKeys] = useState<GeminiApiKeyEntry[]>(() => listGeminiApiKeys());
  const [activeId, setActiveId] = useState<string | null>(() => getActiveGeminiKeyId());
  const [model, setModel] = useState(() => getGeminiModel());
  const [saved, setSaved] = useState(false);

  const [tmdbKeys, setTmdbKeys] = useState<TmdbApiKeyEntry[]>(() => listTmdbApiKeys());
  const [tmdbActiveId, setTmdbActiveId] = useState<string | null>(() => getActiveTmdbKeyId());
  const [rawgKeys, setRawgKeys] = useState<RawgApiKeyEntry[]>(() => listRawgApiKeys());
  const [rawgActiveId, setRawgActiveId] = useState<string | null>(() => getActiveRawgKeyId());

  const refreshKeys = () => {
    setKeys(listGeminiApiKeys());
    setActiveId(getActiveGeminiKeyId());
  };

  const activateKey = (id: string) => {
    setActiveGeminiKeyId(id);
    setActiveId(id);
  };

  const deleteKey = (id: string) => {
    removeGeminiApiKey(id);
    refreshKeys();
  };

  const refreshTmdbKeys = () => {
    setTmdbKeys(listTmdbApiKeys());
    setTmdbActiveId(getActiveTmdbKeyId());
  };
  const refreshRawgKeys = () => {
    setRawgKeys(listRawgApiKeys());
    setRawgActiveId(getActiveRawgKeyId());
  };

  const activeKey = keys.find((k) => k.id === activeId)?.key ?? "";
  const modelsQuery = useQuery({
    queryKey: ["gemini-models", activeKey],
    queryFn: () => listGeminiModels(activeKey),
    enabled: activeKey.length > 10,
    staleTime: 5 * 60 * 1000,
  });
  const models = modelsQuery.data ?? [];

  const saveModel = () => {
    setGeminiModel(model.trim() || null);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560 }}>
      <SectionTitle>AI</SectionTitle>
      <span style={{ font: "400 13px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)" }}>
        Add a free Gemini API key to get an AI-suggested category for a disc (from its folder and file names — this app never sends file
        contents anywhere). Keys are stored only in this browser and sent only to Google's API, never synced or shared. Get one at{" "}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: "var(--dv-accent)" }}>
          aistudio.google.com/apikey
        </a>
        .
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Gemini API keys</span>
        <span style={{ font: "400 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
          Add as many as you like (e.g. a spare for when one hits its daily quota) — only the one marked active is ever used.
        </span>
        <ApiKeyManager
          radioName="active-gemini-key"
          keys={keys}
          activeId={activeId}
          keyPlaceholder="AIza…"
          onAdd={(key, label) => {
            addGeminiApiKey(key, label); // label is optional — addGeminiApiKey falls back to "Key N"
            refreshKeys();
          }}
          onActivate={activateKey}
          onRemove={deleteKey}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>Gemini model</span>
          <button
            type="button"
            onClick={saveModel}
            style={{
              minHeight: 26,
              padding: "0 10px",
              border: "1px solid var(--dv-border-2)",
              borderRadius: 7,
              background: "var(--dv-bg-sub)",
              font: "500 11px/1 'Instrument Sans', system-ui, sans-serif",
              cursor: "pointer",
            }}
          >
            {saved ? "Saved" : "Save"}
          </button>
        </div>
        {models.length > 0 ? (
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{
              width: "100%",
              height: 34,
              padding: "0 10px",
              border: "1px solid var(--dv-border)",
              borderRadius: 8,
              background: "var(--dv-bg-sub)",
              font: "400 12px/1 'JetBrains Mono', monospace",
            }}
          >
            {!models.some((m) => m.name === model) && <option value={model}>{model}</option>}
            {models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.displayName}
                {m.recommended ? " — Recommended" : ""}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={DEFAULT_GEMINI_MODEL}
            autoComplete="off"
            style={{
              width: "100%",
              height: 34,
              padding: "0 10px",
              border: "1px solid var(--dv-border)",
              borderRadius: 8,
              background: "var(--dv-bg-sub)",
              font: "400 12px/1 'JetBrains Mono', monospace",
            }}
          />
        )}
        <span style={{ font: "400 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
          {modelsQuery.isFetching
            ? "Loading the models your key can use…"
            : modelsQuery.isError
              ? `Couldn't load the model list (${modelsQuery.error instanceof Error ? modelsQuery.error.message : "unknown error"}) — enter a model id manually.`
              : activeKey.length <= 10
                ? "Add and activate an API key above to pick from the models it can use."
                : null}{" "}
          Defaults to {DEFAULT_GEMINI_MODEL}.
        </span>
      </div>

      <SectionTitle>Preview images</SectionTitle>
      <span style={{ font: "400 13px/1.5 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-2)" }}>
        Gemini can't browse the web, so it can't return a real cover image — these optional keys let identified items fetch one from a real
        catalog instead. Software and music covers come from Apple's iTunes catalog automatically, no key needed.
      </span>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>TMDB API keys (movies)</span>
        <span style={{ font: "400 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
          Used to fetch a poster after AI identifies a movie. Get a free one at{" "}
          <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer" style={{ color: "var(--dv-accent)" }}>
            themoviedb.org/settings/api
          </a>
          . This product uses the TMDB API but is not endorsed or certified by TMDB.
        </span>
        <ApiKeyManager
          radioName="active-tmdb-key"
          keys={tmdbKeys}
          activeId={tmdbActiveId}
          keyPlaceholder="TMDB API key"
          onAdd={(key, label) => {
            addTmdbApiKey(key, label);
            refreshTmdbKeys();
          }}
          onActivate={(id) => {
            setActiveTmdbKeyId(id);
            setTmdbActiveId(id);
          }}
          onRemove={(id) => {
            removeTmdbApiKey(id);
            refreshTmdbKeys();
          }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ font: "600 13px/1 'Instrument Sans', system-ui, sans-serif" }}>RAWG API keys (games)</span>
        <span style={{ font: "400 12px/1.4 'Instrument Sans', system-ui, sans-serif", color: "var(--dv-text-3)" }}>
          Used to fetch cover art after AI identifies a game. Get a free one at{" "}
          <a href="https://rawg.io/apidocs" target="_blank" rel="noreferrer" style={{ color: "var(--dv-accent)" }}>
            rawg.io/apidocs
          </a>
          . Game data provided by RAWG.
        </span>
        <ApiKeyManager
          radioName="active-rawg-key"
          keys={rawgKeys}
          activeId={rawgActiveId}
          keyPlaceholder="RAWG API key"
          onAdd={(key, label) => {
            addRawgApiKey(key, label);
            refreshRawgKeys();
          }}
          onActivate={(id) => {
            setActiveRawgKeyId(id);
            setRawgActiveId(id);
          }}
          onRemove={(id) => {
            removeRawgApiKey(id);
            refreshRawgKeys();
          }}
        />
      </div>
    </div>
  );
}

type ImportStage = "idle" | "reading" | "preview" | "importing" | "done" | "error";

function ImportExportTab() {
  const queryClient = useQueryClient();
  const { refreshStats } = useSession();
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
      await refreshStats();
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
