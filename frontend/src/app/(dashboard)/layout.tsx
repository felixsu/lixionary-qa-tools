"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Send, Globe, Database, Key, LogOut, ChevronDown, PanelLeftClose, PanelLeftOpen, Shield, Users, BookOpen, NotebookPen, Fingerprint, FolderOpen, Cloud, CloudOff, RefreshCw, AlertTriangle, Workflow } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import Dropdown from "../components/Dropdown";
import UpdateBanner from "../components/UpdateBanner";
import SyncConflictModal from "../components/SyncConflictModal";
import BackendStatusIndicator from "../components/BackendStatusIndicator";
import { useNowTick } from "../utils/useNowTick";
import { useAppVersion } from "../utils/useAppVersion";

type NavEntry =
  | { type: "section"; label: string }
  | { type: "item"; href: string; icon: typeof Send; label: string; badge?: "env" }
  | { type: "group"; href: string; icon: typeof Send; label: string; children: { href: string; label: string }[] };

const NAV: NavEntry[] = [
  { type: "section", label: "QA Tools" },
  { type: "item", href: "/api-explorer", icon: Send, label: "API explorer" },
  { type: "item", href: "/api-studio", icon: Workflow, label: "API Studio" },
  { type: "item", href: "/web-explorer", icon: Globe, label: "Web explorer" },
  { type: "item", href: "/nv-common-lib-explorer", icon: FolderOpen, label: "NV Common Lib Explorer" },
  { type: "section", label: "Configuration" },
  { type: "item", href: "/environments", icon: Database, label: "Environments", badge: "env" },
  { type: "item", href: "/auth-functions", icon: Key, label: "Auth functions" },
  { type: "item", href: "/browser-profiles", icon: Fingerprint, label: "Browser profiles" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    token,
    user,
    isLoadingAuth,
    environments,
    selectedEnvId,
    setSelectedEnvId,
    handleLogout,
    userGuides,
    isOnline,
    lastSyncAt,
    syncStatus,
    syncConflicts,
    triggerSync,
  } = useAppContext();

  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const collapsed = searchParams.get("sidebar") === "collapsed";

  const toggleSidebar = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (collapsed) {
      params.delete("sidebar");
    } else {
      params.set("sidebar", "collapsed");
    }
    window.history.replaceState(null, "", `?${params.toString()}`);
    // Force re-render via a shallow router replace so useSearchParams picks up the change.
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    if (!isLoadingAuth && !token) {
      router.replace("/login");
    }
  }, [token, isLoadingAuth, router]);

  // Drives the "Synced Xm ago" label.
  const nowTick = useNowTick(15000);
  const appVersion = useAppVersion();

  if (isLoadingAuth || !token) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-cream text-ink">
         <div className="flex flex-col items-center gap-4">
          <div
            className="h-8 w-8 rounded-full border-2 border-line border-t-clay"
            style={{ animation: "spin 0.8s linear infinite" }}
          />
          <p className="text-sm font-medium text-stone">Authenticating workspace session…</p>
        </div>
      </div>
    );
  }

  const isActive = (path: string) => pathname === path;

  const formatRelativeTime = (iso: string | null, now: number): string => {
    if (!iso || !now) return "never";
    const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
    if (seconds < 10) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const getHeaderTitle = () => {
    if (pathname === "/user-guides/detail") {
      const guideId = searchParams.get("id");
      const guide = userGuides.find((g) => g.id === guideId);
      return guide ? guide.title : "User guide";
    }
    switch (pathname) {
      case "/user-guides":
        return "User guides";
      case "/user-guide-admin":
        return "User guide studio";
      case "/api-explorer":
        return "API Automation Engine";
      case "/api-studio":
        return "API Studio";
      case "/web-explorer":
        return "Web automation & POM generator";
      case "/nv-common-lib-explorer":
        return "NV Common Lib Explorer";
      case "/environments":
        return "Variable environments";
      case "/auth-functions":
        return "Self-refreshing auth functions";
      case "/browser-profiles":
        return "Browser session profiles";
      case "/admin-console":
        return "Admin console";
      case "/user-management":
        return "User management";
      default:
        return "Lixionary Workspace";
    }
  };

  const showEnvPill = pathname === "/api-explorer" || pathname === "/api-studio" || pathname === "/web-explorer";
  const userInitial = (user?.name || user?.email || "D").charAt(0).toUpperCase();

  const sidebarNavItems: NavEntry[] = [
    ...NAV,
    {
      type: "group",
      href: "/user-guides",
      icon: BookOpen,
      label: "User guide",
      children: userGuides.map((g) => ({ href: `/user-guides/detail?id=${g.id}`, label: g.title })),
    },
  ];
  if (user?.role === "admin") {
    sidebarNavItems.push(
      { type: "section", label: "Administration" },
      { type: "item", href: "/admin-console", icon: Shield, label: "Admin console" },
      { type: "item", href: "/user-management", icon: Users, label: "User management" },
      { type: "item", href: "/user-guide-admin", icon: NotebookPen, label: "User guide studio" }
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-cream text-ink font-sans">

      {/* Sidebar */}
      <aside
        className="flex-shrink-0 flex flex-col bg-cream border-r border-line transition-all duration-200"
        style={{ width: collapsed ? 52 : 236 }}
      >
        {/* Brand */}
        <button
          onClick={toggleSidebar}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="w-full h-14 flex items-center gap-2.5 px-3 bg-cream border-b border-line flex-shrink-0 overflow-hidden hover:bg-panel transition-colors"
        >
          <Image
            src="/logo.png"
            alt="Lixionary"
            width={28}
            height={28}
            className="h-7 w-7 rounded-md flex-shrink-0"
          />
          {!collapsed && (
            <>
              <span className="text-sm font-semibold text-ink whitespace-nowrap">Lixionary</span>
              <span className="ml-auto text-[11px] text-mute whitespace-nowrap">Explorer</span>
            </>
          )}
        </button>

        {/* Nav */}
        <nav className="flex-1 px-1.5 py-3 flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden">
          {sidebarNavItems.map((entry, i) => {
            if (entry.type === "section") {
              if (collapsed) return null;
              return (
                <div
                  key={`sec-${i}`}
                  className={`px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-mute whitespace-nowrap ${
                    i === 0 ? "pt-2" : "pt-3.5"
                  }`}
                >
                  {entry.label}
                </div>
              );
            }
            if (entry.type === "group") {
              const Icon = entry.icon;
              const active = isActive(entry.href);
              const expanded = pathname.startsWith(entry.href);
              return (
                <div key={entry.href} className="flex flex-col gap-0.5">
                  <Link
                    href={entry.href}
                    title={collapsed ? entry.label : undefined}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-panel"
                    style={{
                      background: active ? "var(--color-hover)" : "transparent",
                      borderLeft: `3px solid ${active ? "var(--color-clay)" : "transparent"}`,
                      justifyContent: collapsed ? "center" : undefined,
                    }}
                  >
                    <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${active ? "text-clay" : "text-stone"}`} />
                    {!collapsed && (
                      <>
                        <span className={`flex-1 text-[13px] whitespace-nowrap ${active ? "font-medium text-clay" : "text-graphite"}`}>
                          {entry.label}
                        </span>
                        <ChevronDown
                          className={`h-3.5 w-3.5 flex-shrink-0 text-mute transition-transform ${expanded ? "" : "-rotate-90"}`}
                        />
                      </>
                    )}
                  </Link>
                  {expanded && !collapsed &&
                    entry.children.map((child) => {
                      const childActive = child.href.includes("?")
                        ? (pathname === child.href.split("?")[0] && searchParams.get("id") === new URLSearchParams(child.href.split("?")[1]).get("id"))
                        : pathname === child.href;
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className="flex items-center rounded-lg py-1.5 pr-2 pl-[34px] transition-colors hover:bg-panel"
                          style={{
                            background: childActive ? "var(--color-hover)" : "transparent",
                            borderLeft: `3px solid ${childActive ? "var(--color-clay)" : "transparent"}`,
                          }}
                        >
                          <span className={`text-[12.5px] truncate ${childActive ? "font-medium text-clay" : "text-stone"}`}>
                            {child.label}
                          </span>
                        </Link>
                      );
                    })}
                </div>
              );
            }
            const Icon = entry.icon;
            const active = isActive(entry.href);
            return (
              <Link
                key={entry.href}
                href={entry.href}
                title={collapsed ? entry.label : undefined}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-panel"
                style={{
                  background: active ? "var(--color-hover)" : "transparent",
                  borderLeft: `3px solid ${active ? "var(--color-clay)" : "transparent"}`,
                  justifyContent: collapsed ? "center" : undefined,
                  paddingLeft: collapsed ? undefined : undefined,
                }}
              >
                <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${active ? "text-clay" : "text-stone"}`} />
                {!collapsed && (
                  <>
                    <span className={`flex-1 text-[13px] whitespace-nowrap ${active ? "font-medium text-clay" : "text-graphite"}`}>
                      {entry.label}
                    </span>
                    {entry.badge === "env" && environments.length > 0 && (
                      <span className="font-mono text-[11px] bg-chip text-stone px-1.5 py-0.5 rounded-full">
                        {environments.length}
                      </span>
                    )}
                  </>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User block + collapse toggle */}
        <div className="p-2 border-t border-line flex flex-col gap-1 flex-shrink-0">
          {/* Collapse toggle */}
          <button
            onClick={toggleSidebar}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex items-center gap-2.5 rounded-lg px-2 py-2 w-full transition-colors hover:bg-panel text-mute hover:text-graphite"
            style={{ justifyContent: collapsed ? "center" : undefined }}
          >
            {collapsed
              ? <PanelLeftOpen className="h-3.5 w-3.5 flex-shrink-0" />
              : <PanelLeftClose className="h-3.5 w-3.5 flex-shrink-0" />}
            {!collapsed && <span className="text-[13px]">Collapse</span>}
          </button>

          {/* Sync status */}
          <button
            onClick={() => triggerSync()}
            disabled={syncStatus === "syncing"}
            title={
              collapsed
                ? (syncConflicts.length > 0
                    ? `${syncConflicts.length} sync conflict(s) — click to sync now`
                    : !isOnline
                      ? "Offline — click to retry"
                      : `Synced ${formatRelativeTime(lastSyncAt, nowTick)} — click to sync now`)
                : "Sync now"
            }
            className="flex items-center gap-2.5 rounded-lg px-2 py-2 w-full transition-colors hover:bg-panel text-mute hover:text-graphite disabled:cursor-wait"
            style={{ justifyContent: collapsed ? "center" : undefined }}
          >
            {syncStatus === "syncing" ? (
              <RefreshCw className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />
            ) : syncConflicts.length > 0 ? (
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
            ) : !isOnline ? (
              <CloudOff className="h-3.5 w-3.5 flex-shrink-0 text-danger" />
            ) : (
              <Cloud className="h-3.5 w-3.5 flex-shrink-0" />
            )}
            {!collapsed && (
              <span className="text-[13px] truncate">
                {syncStatus === "syncing"
                  ? "Syncing…"
                  : syncConflicts.length > 0
                    ? `${syncConflicts.length} conflict${syncConflicts.length === 1 ? "" : "s"}`
                    : !isOnline
                      ? "Offline"
                      : `Synced ${formatRelativeTime(lastSyncAt, nowTick)}`}
              </span>
            )}
          </button>

          {/* Backend status */}
          <div style={{ display: "flex", justifyContent: collapsed ? "center" : undefined }}>
            <BackendStatusIndicator compact={collapsed} />
          </div>

          {/* User row */}
          <div
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 overflow-hidden"
            style={{ justifyContent: collapsed ? "center" : undefined }}
          >
            <div
              title={collapsed ? (user?.name || user?.email || "Developer") : undefined}
              className="h-8 w-8 rounded-full bg-chip flex items-center justify-center flex-shrink-0"
            >
              <span className="text-xs font-semibold text-graphite">{userInitial}</span>
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-ink truncate">{user?.name || "Developer"}</div>
                  <div className="text-[11px] text-mute truncate">{user?.email || "developer@lixionary.com"}</div>
                </div>
                <button
                  onClick={handleLogout}
                  title="Logout"
                  className="p-1.5 rounded-lg text-mute hover:text-danger hover:bg-danger-soft transition-colors flex-shrink-0"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            )}
          </div>

          {!collapsed && appVersion && (
            <div className="text-center text-[11px] text-mute/70">v{appVersion}</div>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 flex items-center gap-4 px-6 bg-cream border-b border-line flex-shrink-0">
          <h1 className="flex-1 m-0 font-serif text-[22px] font-medium tracking-[-0.3px] text-ink">
            {getHeaderTitle()}
          </h1>

          {showEnvPill && (
            <>
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">
                Active env
              </span>
              <Dropdown
                value={selectedEnvId}
                onChange={setSelectedEnvId}
                align="right"
                options={[
                  { value: "", label: "No environment" },
                  ...environments.map((env) => ({ value: env.id, label: env.name })),
                ]}
                className="flex items-center gap-1.5 bg-cream border border-line rounded-lg pl-3 pr-2 py-1.5 text-[13px] font-medium text-ink outline-none cursor-pointer transition-colors hover:bg-panel"
                renderTrigger={(selected, open) => (
                  <>
                    <div className="h-1.5 w-1.5 rounded-full bg-sage" />
                    <span className="text-ink">{selected?.label ?? "No environment"}</span>
                    <ChevronDown className={`h-3.5 w-3.5 text-stone transition-transform ${open ? "rotate-180" : ""}`} />
                  </>
                )}
              />
            </>
          )}
        </header>

        <UpdateBanner />

        {/* Content */}
        <main className="flex-1 overflow-hidden relative">
          {children}
        </main>
      </div>

      <SyncConflictModal />
    </div>
  );
}
