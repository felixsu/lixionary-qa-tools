"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Cpu, Server, Database, Cloud, Check, AlertTriangle, XCircle, MinusCircle, Loader2 } from "lucide-react";
import { useBackendStatus } from "../context/BackendStatusContext";
import type { SignalResult, SignalStatus } from "../context/backendStatus";
import { useNowTick } from "../utils/useNowTick";

// Deliberately narrower than "checking" | SignalStatus: summarize() below
// never emits "unavailable" (it's treated as neutral/expected, not a status
// worth summarizing as good or bad), so the type reflects that guarantee
// instead of forcing an unreachable switch case everywhere this is consumed.
type Summary = "checking" | "ok" | "degraded" | "error";

const SIGNAL_META: { key: "tauri" | "sidecar" | "localDb" | "vps"; label: string; icon: typeof Cpu }[] = [
  { key: "tauri", label: "Tauri shell", icon: Cpu },
  { key: "sidecar", label: "Local sidecar", icon: Server },
  { key: "localDb", label: "Local database", icon: Database },
  { key: "vps", label: "Cloud backend", icon: Cloud },
];

// "unavailable" (e.g. web-only mode, where Tauri/sidecar/DB legitimately don't
// apply) is deliberately excluded from "worst status" — it's expected, not bad.
function summarize(signals: (SignalResult | null)[]): Summary {
  if (signals.some((s) => s === null)) return "checking";
  const statuses = signals.map((s) => s!.status);
  if (statuses.includes("error")) return "error";
  if (statuses.includes("degraded")) return "degraded";
  return "ok";
}

function summaryLabel(summary: Summary, errorCount: number): string {
  switch (summary) {
    case "checking": return "Checking…";
    case "ok": return "All systems normal";
    case "degraded": return "Starting up";
    case "error": return errorCount === 1 ? "1 issue" : `${errorCount} issues`;
  }
}

function dotClass(summary: Summary): string {
  switch (summary) {
    case "checking": return "bg-mute animate-pulse";
    case "ok": return "bg-sage";
    case "degraded": return "bg-amber-500";
    case "error": return "bg-danger";
  }
}

function rowIcon(status: SignalStatus) {
  switch (status) {
    case "ok": return <Check className="h-3.5 w-3.5 text-sage flex-shrink-0" />;
    case "degraded": return <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />;
    case "error": return <XCircle className="h-3.5 w-3.5 text-danger flex-shrink-0" />;
    case "unavailable": return <MinusCircle className="h-3.5 w-3.5 text-mute flex-shrink-0" />;
  }
}

function formatRelativeTime(iso: string, now: number): string {
  if (!now) return "";
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function BackendStatusIndicator({ compact = false }: { compact?: boolean }) {
  const { tauri, sidecar, localDb, vps, refresh } = useBackendStatus();
  const signals = { tauri, sidecar, localDb, vps };
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const nowTick = useNowTick(15000);

  const summary = summarize([tauri, sidecar, localDb, vps]);
  const errorCount = [tauri, sidecar, localDb, vps].filter((s) => s?.status === "error").length;

  useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 6, left: r.left });
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const toggle = () => {
    if (!open) refresh();
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={triggerRef}
        onClick={toggle}
        title="Backend status"
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-panel text-mute hover:text-graphite"
      >
        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${dotClass(summary)}`} />
        {!compact && (
          <span className="text-[12px] truncate">{summaryLabel(summary, errorCount)}</span>
        )}
      </button>

      {open && coords &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: "fixed", top: coords.top, left: coords.left }}
            className="z-[100] w-72 rounded-xl border border-line bg-cream py-2 shadow-lg shadow-ink/10 animate-[fadeUp_0.12s_ease-out]"
          >
            <div className="px-3.5 pb-2 mb-1 border-b border-line">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-mute">Backend status</span>
            </div>
            {SIGNAL_META.map(({ key, label, icon: Icon }) => {
              const signal = signals[key];
              return (
                <div key={key} className="flex items-start gap-2.5 px-3.5 py-1.5">
                  <Icon className="h-3.5 w-3.5 text-stone flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12.5px] font-medium text-ink">{label}</span>
                      {signal ? rowIcon(signal.status) : <Loader2 className="h-3.5 w-3.5 text-mute animate-spin flex-shrink-0" />}
                    </div>
                    <p className="m-0 text-[11px] text-stone leading-snug">{signal ? signal.detail : "Checking…"}</p>
                    {signal && (
                      <p className="m-0 text-[10px] text-mute">{formatRelativeTime(signal.checkedAt, nowTick)}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
