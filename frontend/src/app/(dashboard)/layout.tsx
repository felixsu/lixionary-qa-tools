"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Cpu, Send, Globe, Database, Key, User, LogOut } from "lucide-react";
import { useAppContext } from "../context/AppContext";

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
    handleLogout
  } = useAppContext();

  const pathname = usePathname();
  const router = useRouter();

  // If not logged in, redirect to login page
  useEffect(() => {
    if (!isLoadingAuth && !token) {
      router.replace("/login");
    }
  }, [token, isLoadingAuth, router]);

  if (isLoadingAuth || !token) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex flex-col items-center gap-4">
          <svg className="animate-spin h-8 w-8 text-indigo-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-sm font-medium">Authenticating Workspace Session...</p>
        </div>
      </div>
    );
  }

  // Helper to determine active route highlighting
  const isActive = (path: string) => pathname === path;

  // Title for Header
  const getHeaderTitle = () => {
    switch (pathname) {
      case "/api-explorer":
        return "API Automation Engine";
      case "/web-explorer":
        return "Web Automation & POM Generator";
      case "/environments":
        return "Workspace Environments";
      case "/auth-functions":
        return "Dynamic Authentication Hooks";
      default:
        return "Lixionary Workspace";
    }
  };

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      
      {/* Sidebar Panel */}
      <aside className="w-64 flex-shrink-0 border-r border-slate-800/80 bg-slate-900/60 flex flex-col justify-between">
        <div>
          {/* Logo */}
          <div className="h-16 flex items-center gap-3 px-6 border-b border-slate-800/80">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 shadow-md shadow-indigo-500/20">
              <Cpu className="h-5 w-5 text-white" />
            </div>
            <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
              Lixionary
            </span>
          </div>

          {/* Navigation Menu */}
          <nav className="mt-6 px-4 space-y-1.5">
            <Link
              href="/api-explorer"
              className={`flex items-center gap-3 px-4 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${
                isActive("/api-explorer")
                  ? "bg-indigo-600/10 border border-indigo-500/30 text-indigo-400"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
              }`}
            >
              <Send className="h-4 w-4" />
              API Automation Explorer
            </Link>

            <Link
              href="/web-explorer"
              className={`flex items-center gap-3 px-4 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${
                isActive("/web-explorer")
                  ? "bg-indigo-600/10 border border-indigo-500/30 text-indigo-400"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
              }`}
            >
              <Globe className="h-4 w-4" />
              Web Explorer & POM
            </Link>

            <Link
              href="/environments"
              className={`flex items-center gap-3 px-4 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${
                isActive("/environments")
                  ? "bg-indigo-600/10 border border-indigo-500/30 text-indigo-400"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
              }`}
            >
              <Database className="h-4 w-4" />
              Environments ({environments.length})
            </Link>

            <Link
              href="/auth-functions"
              className={`flex items-center gap-3 px-4 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${
                isActive("/auth-functions")
                  ? "bg-indigo-600/10 border border-indigo-500/30 text-indigo-400"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
              }`}
            >
              <Key className="h-4 w-4" />
              Auth Hook Functions
            </Link>
          </nav>
        </div>

        {/* User Info Block */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-900/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="h-9 w-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
                <User className="h-4 w-4 text-slate-400" />
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-semibold text-slate-200 truncate">{user?.name}</p>
                <p className="text-[10px] text-slate-500 truncate">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Logout"
            >
              <LogOut className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Workspace Frame */}
      <div className="flex-grow flex flex-col overflow-hidden">
        
        {/* Header Block */}
        <header className="h-16 flex items-center justify-between px-8 border-b border-slate-800/80 bg-slate-900/20 backdrop-blur-md">
          <h2 className="text-lg font-bold tracking-tight text-slate-200">
            {getHeaderTitle()}
          </h2>

          {/* Context Selector */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Env:</span>
              <select
                value={selectedEnvId}
                onChange={(e) => setSelectedEnvId(e.target.value)}
                className="bg-slate-900/80 border border-slate-850 hover:border-slate-700 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 text-slate-300"
              >
                <option value="">No Active Environment</option>
                {environments.map(env => (
                  <option key={env.id} value={env.id}>{env.name}</option>
                ))}
              </select>
            </div>
          </div>
        </header>

        {/* Dynamic Route Content */}
        <main className="flex-grow overflow-hidden relative">
          {children}
        </main>
      </div>
    </div>
  );
}
