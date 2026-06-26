"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Cpu, Send, Globe, Database, Key, LogOut, ChevronDown } from "lucide-react";
import { useAppContext } from "../context/AppContext";

type NavEntry =
  | { type: "section"; label: string }
  | { type: "item"; href: string; icon: typeof Send; label: string; badge?: "env" };

const NAV: NavEntry[] = [
  { type: "section", label: "QA Tools" },
  { type: "item", href: "/api-explorer", icon: Send, label: "API explorer" },
  { type: "item", href: "/web-explorer", icon: Globe, label: "Web explorer" },
  { type: "section", label: "Configuration" },
  { type: "item", href: "/environments", icon: Database, label: "Environments", badge: "env" },
  { type: "item", href: "/auth-functions", icon: Key, label: "Auth functions" },
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
  } = useAppContext();

  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isLoadingAuth && !token) {
      router.replace("/login");
    }
  }, [token, isLoadingAuth, router]);

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

  const getHeaderTitle = () => {
    switch (pathname) {
      case "/api-explorer":
        return "API Automation Engine";
      case "/web-explorer":
        return "Web automation & POM generator";
      case "/environments":
        return "Variable environments";
      case "/auth-functions":
        return "Self-refreshing auth functions";
      default:
        return "Lixionary Workspace";
    }
  };

  const showEnvPill = pathname === "/api-explorer" || pathname === "/web-explorer";
  const userInitial = (user?.name || user?.email || "D").charAt(0).toUpperCase();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-cream text-ink font-sans">

      {/* Sidebar */}
      <aside className="w-[236px] flex-shrink-0 flex flex-col bg-cream border-r border-line">
        {/* Brand */}
        <div className="h-14 flex items-center gap-2.5 px-4 bg-ink-900 flex-shrink-0">
          <div className="h-7 w-7 rounded-md bg-clay flex items-center justify-center flex-shrink-0">
            <Cpu className="h-4 w-4 text-cream" />
          </div>
          <span className="text-sm font-semibold text-cream">Lixionary</span>
          <span className="ml-auto text-[11px] text-cream/35">Explorer</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5 overflow-y-auto">
          {NAV.map((entry, i) => {
            if (entry.type === "section") {
              return (
                <div
                  key={`sec-${i}`}
                  className={`px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-mute ${
                    i === 0 ? "pt-2" : "pt-3.5"
                  }`}
                >
                  {entry.label}
                </div>
              );
            }
            const Icon = entry.icon;
            const active = isActive(entry.href);
            return (
              <Link
                key={entry.href}
                href={entry.href}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-panel"
                style={{
                  background: active ? "var(--color-hover)" : "transparent",
                  borderLeft: `3px solid ${active ? "var(--color-clay)" : "transparent"}`,
                }}
              >
                <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${active ? "text-clay" : "text-stone"}`} />
                <span className={`flex-1 text-[13px] ${active ? "font-medium text-clay" : "text-graphite"}`}>
                  {entry.label}
                </span>
                {entry.badge === "env" && environments.length > 0 && (
                  <span className="font-mono text-[11px] bg-chip text-stone px-1.5 py-0.5 rounded-full">
                    {environments.length}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User block */}
        <div className="p-3 border-t border-line flex items-center gap-2.5 flex-shrink-0">
          <div className="h-8 w-8 rounded-full bg-chip flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-semibold text-graphite">{userInitial}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-ink truncate">{user?.name || "Developer"}</div>
            <div className="text-[11px] text-mute truncate">{user?.email || "developer@lixionary.com"}</div>
          </div>
          <button
            onClick={handleLogout}
            title="Logout"
            className="p-1.5 rounded-lg text-mute hover:text-danger hover:bg-danger-soft transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
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
              <div className="relative flex items-center gap-1.5 bg-cream border border-line rounded-lg pl-3 pr-2 py-1.5 hover:bg-panel transition-colors">
                <div className="h-1.5 w-1.5 rounded-full bg-sage" />
                <select
                  value={selectedEnvId}
                  onChange={(e) => setSelectedEnvId(e.target.value)}
                  className="appearance-none bg-transparent pr-5 text-[13px] font-medium text-ink outline-none cursor-pointer"
                >
                  <option value="">No environment</option>
                  {environments.map((env) => (
                    <option key={env.id} value={env.id}>{env.name}</option>
                  ))}
                </select>
                <ChevronDown className="h-3.5 w-3.5 text-stone pointer-events-none absolute right-2" />
              </div>
            </>
          )}
        </header>

        {/* Content */}
        <main className="flex-1 overflow-hidden relative">
          {children}
        </main>
      </div>
    </div>
  );
}
