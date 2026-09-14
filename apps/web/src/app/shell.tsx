import { Link, type LinkProps, useNavigate, useRouterState } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { signOut as authSignOut } from "../account/auth-client.js";
import { formatSizeKb, initials } from "../ui/format.js";
import { Icon, type IconName, SearchGlyph } from "../ui/icons.js";
import { SyncIndicator } from "../ui/primitives.js";
import { useSession } from "./session.js";

function useSignOut() {
  const navigate = useNavigate();
  return async () => {
    await authSignOut();
    navigate({ to: "/login" });
  };
}

const SETTINGS_LINK = { to: "/settings/$" as const, params: { _splat: "account" } };

interface NavItem {
  label: string;
  icon: IconName;
  to: LinkProps["to"];
  params?: Record<string, string>;
  badge?: string;
}

const NAV_PRIMARY: NavItem[] = [
  { label: "Dashboard", icon: "Dashboard", to: "/" },
  { label: "Search", icon: "Search", to: "/search" },
  { label: "Discs", icon: "Discs", to: "/discs" },
  { label: "Add disc", icon: "Add disc", to: "/scan" },
  { label: "Settings", icon: "Settings", ...SETTINGS_LINK },
];

// Position in the information architecture is set even though most of these screens are stubs
// until phase 4 (§8, items 8 and 10-14) — see the Stub screen.
const NAV_SECONDARY: NavItem[] = [
  { label: "Sync & storage", icon: "Sync", to: "/sync" },
  { label: "Duplicates", icon: "Duplicates", to: "/duplicates" },
  { label: "Statistics", icon: "Stats", to: "/stats" },
  { label: "Collections", icon: "Collections", to: "/collections" },
  { label: "Locations", icon: "Locations", to: "/locations" },
  { label: "Data health", icon: "Health", to: "/health" },
];

const PHONE_TABS: NavItem[] = [
  { label: "Home", icon: "Home", to: "/" },
  { label: "Search", icon: "Search", to: "/search" },
  { label: "Discs", icon: "Discs", to: "/discs" },
  { label: "More", icon: "More", ...SETTINGS_LINK },
];

function useIsActive(to: LinkProps["to"]): boolean {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const target = String(to);
  if (target === "/") return pathname === "/";
  // Nav items point at one path family each (e.g. every /settings/* tab), so a shared first
  // segment is enough to highlight the right entry.
  return pathname.split("/")[1] === target.split("/")[1];
}

function NavButton({ item }: { item: NavItem }) {
  const active = useIsActive(item.to);
  return (
    <Link
      to={item.to}
      params={item.params as never}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        minHeight: 32,
        padding: "0 9px",
        borderRadius: 7,
        textDecoration: "none",
        background: active ? "var(--dv-accent-soft)" : "transparent",
        color: active ? "var(--dv-accent)" : "var(--dv-text-2)",
        font: "500 13px/1 'Instrument Sans', system-ui, sans-serif",
      }}
    >
      <Icon name={item.icon} color={active ? "var(--dv-accent)" : "var(--dv-text-3)"} />
      <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
      {item.badge && (
        <span
          style={{
            flex: "none",
            padding: "1px 6px",
            borderRadius: 99,
            background: "var(--dv-off-soft)",
            color: "var(--dv-text-3)",
            font: "500 10px/1.6 'JetBrains Mono', monospace",
          }}
        >
          {item.badge}
        </span>
      )}
    </Link>
  );
}

function TopSearchBox({ compact = false }: { compact?: boolean }) {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate({ to: "/search", search: { q } as never });
  };
  return (
    <form
      onSubmit={submit}
      style={{
        flex: 1,
        maxWidth: compact ? undefined : 520,
        display: "flex",
        alignItems: "center",
        gap: 9,
        height: 32,
        padding: "0 10px",
        border: "1px solid var(--dv-border)",
        borderRadius: 8,
        background: "var(--dv-bg-sub)",
      }}
    >
      <SearchGlyph />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search files, folders and discs"
        style={{
          flex: 1,
          minWidth: 0,
          border: 0,
          background: "transparent",
          outline: "none",
          font: "400 13px/1 'JetBrains Mono', monospace",
        }}
      />
      <span
        style={{
          flex: "none",
          padding: "2px 5px",
          borderRadius: 5,
          border: "1px solid var(--dv-border-2)",
          font: "500 10px/1.4 'JetBrains Mono', monospace",
          color: "var(--dv-text-3)",
        }}
      >
        ⌘K
      </span>
    </form>
  );
}

function DesktopShell({ children }: { children: ReactNode }) {
  const { account, stats } = useSession();
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--dv-bg)" }}>
      <nav
        style={{
          width: 220,
          flex: "none",
          borderRight: "1px solid var(--dv-border)",
          background: "var(--dv-panel)",
          display: "flex",
          flexDirection: "column",
          padding: "12px 10px",
          gap: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 8px 14px" }}>
          <svg viewBox="0 0 32 32" width={21} height={21} aria-hidden="true">
            <circle cx="16" cy="16" r="14.5" fill="none" stroke="var(--dv-text)" strokeWidth="1.8" />
            <circle cx="16" cy="16" r="4" fill="none" stroke="var(--dv-text)" strokeWidth="1.8" />
          </svg>
          <span style={{ font: "700 15px/1 'Instrument Sans', system-ui, sans-serif", letterSpacing: "-.01em" }}>DiscVault</span>
        </div>
        {NAV_PRIMARY.map((item) => (
          <NavButton key={item.label} item={item} />
        ))}
        <div style={{ height: 1, background: "var(--dv-border)", margin: "8px 2px" }} />
        {NAV_SECONDARY.map((item) => (
          <NavButton key={item.label} item={item} />
        ))}
        <div
          style={{
            marginTop: "auto",
            padding: "10px 9px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            borderTop: "1px solid var(--dv-border)",
          }}
        >
          <span className="dv-mono" style={{ fontSize: 11, lineHeight: 1.4, color: "var(--dv-text-3)" }}>
            {stats ? `${stats.discs.toLocaleString()} discs · ${formatSizeKb(stats.totalKb)}` : "Loading catalog…"}
          </span>
          {stats && stats.pendingChanges > 0 && (
            <span className="dv-mono" style={{ fontSize: 11, lineHeight: 1.4, color: "var(--dv-warn)" }}>
              {stats.pendingChanges} change{stats.pendingChanges === 1 ? "" : "s"} pending
            </span>
          )}
        </div>
      </nav>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            height: 52,
            flex: "none",
            borderBottom: "1px solid var(--dv-border)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 16px",
            background: "var(--dv-bg)",
          }}
        >
          <TopSearchBox />
          <SyncStatusPill />
          <Link
            to="/scan"
            style={{
              marginLeft: "auto",
              minHeight: 30,
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "0 12px",
              borderRadius: 7,
              background: "var(--dv-accent)",
              color: "#fff",
              textDecoration: "none",
              font: "500 13px/1 'Instrument Sans', system-ui, sans-serif",
            }}
          >
            ＋ Add disc
          </Link>
          <AccountMenu />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

function AccountMenu() {
  const { account } = useSession();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={account ? `${account.user.name ?? account.user.email} · ${account.user.email}` : "Account"}
        style={{
          width: 30,
          height: 30,
          flex: "none",
          borderRadius: "50%",
          border: 0,
          background: "var(--dv-accent)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          font: "600 11px/1 'Instrument Sans', system-ui, sans-serif",
        }}
      >
        {account ? initials(account.user.name, account.user.email) : "…"}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 10,
            minWidth: 170,
            padding: 5,
            border: "1px solid var(--dv-border)",
            borderRadius: 10,
            background: "var(--dv-panel)",
            boxShadow: "0 8px 24px rgba(0,0,0,.12)",
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          <Link
            to={SETTINGS_LINK.to}
            params={SETTINGS_LINK.params}
            onClick={() => setOpen(false)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minHeight: 32,
              padding: "0 9px",
              borderRadius: 7,
              textDecoration: "none",
              color: "var(--dv-text-2)",
              font: "500 13px/1 'Instrument Sans', system-ui, sans-serif",
            }}
          >
            <Icon name="Settings" size={15} color="var(--dv-text-3)" />
            Account settings
          </Link>
          <button
            type="button"
            onClick={signOut}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minHeight: 32,
              padding: "0 9px",
              border: 0,
              borderRadius: 7,
              background: "transparent",
              textAlign: "left",
              color: "var(--dv-text-2)",
              cursor: "pointer",
              font: "500 13px/1 'Instrument Sans', system-ui, sans-serif",
            }}
          >
            <Icon name="Logout" size={15} color="var(--dv-text-3)" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function SyncStatusPill() {
  const { online, stats } = useSession();
  const state = !online ? "offline" : stats && stats.pendingChanges > 0 ? "pending" : "synced";
  return (
    <Link to="/sync" style={{ textDecoration: "none" }}>
      <SyncIndicator state={state} pending={stats?.pendingChanges ?? 0} />
    </Link>
  );
}

function MobileShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "var(--dv-bg)" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          padding: "14px 14px 10px",
          background: "var(--dv-bg)",
          borderBottom: "1px solid var(--dv-border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span style={{ font: "700 17px/1 'Instrument Sans', system-ui, sans-serif", letterSpacing: "-.01em" }}>DiscVault</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <SyncStatusPill />
          <MobileSignOutButton />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: "14px 14px 96px", overflow: "auto" }}>{children}</div>
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "6px 6px calc(6px + env(safe-area-inset-bottom, 0px))",
          background: "var(--dv-bg)",
          borderTop: "1px solid var(--dv-border)",
          display: "flex",
        }}
      >
        {PHONE_TABS.map((tab) => (
          <PhoneTab key={tab.label} tab={tab} />
        ))}
      </div>
    </div>
  );
}

function MobileSignOutButton() {
  const signOut = useSignOut();
  return (
    <button
      type="button"
      onClick={signOut}
      title="Sign out"
      aria-label="Sign out"
      style={{
        width: 30,
        height: 30,
        flex: "none",
        border: 0,
        borderRadius: "50%",
        background: "transparent",
        color: "var(--dv-text-3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      <Icon name="Logout" size={18} />
    </button>
  );
}

function PhoneTab({ tab }: { tab: NavItem }) {
  const active = useIsActive(tab.to);
  return (
    <Link
      to={tab.to}
      params={tab.params as never}
      style={{
        flex: 1,
        minHeight: 50,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        textDecoration: "none",
        color: active ? "var(--dv-accent)" : "var(--dv-text-3)",
      }}
    >
      <Icon name={tab.icon} size={22} />
      <span style={{ font: "500 10px/1 'Instrument Sans', system-ui, sans-serif" }}>{tab.label}</span>
    </Link>
  );
}

function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return phone;
}

/** App shell on every in-app screen (§8): desktop gets a left nav, phones a bottom tab bar. */
export function AppShell({ children }: { children: ReactNode }) {
  const phone = usePhoneLayout();
  return phone ? <MobileShell>{children}</MobileShell> : <DesktopShell>{children}</DesktopShell>;
}
