"use client";

import React, { useState } from "react";
import { AlertTriangle, X, Laptop, Cloud } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import type { SyncConflict } from "../context/syncEngine";

const ENTITY_LABEL: Record<SyncConflict["entityType"], string> = {
  environment: "Environment",
  auth_function: "Auth function",
  browser_profile: "Browser profile",
  collection: "Collection",
};

function conflictTitle(conflict: SyncConflict): string {
  return conflict.local.payload?.name || conflict.cloud.payload?.name || "Untitled";
}

function shortDevice(id: string | null): string {
  if (!id || id === "unknown") return "unknown device";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "unknown time";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function ConflictCard({
  conflict,
  onResolve,
}: {
  conflict: SyncConflict;
  onResolve: (conflict: SyncConflict, choice: "local" | "cloud") => Promise<void>;
}) {
  const [resolving, setResolving] = useState<"local" | "cloud" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChoice = async (choice: "local" | "cloud") => {
    setResolving(choice);
    setError(null);
    try {
      await onResolve(conflict, choice);
    } catch (e: any) {
      setError(e.message || "Failed to resolve conflict");
      setResolving(null);
    }
  };

  return (
    <div className="border border-line rounded-xl overflow-hidden bg-cream">
      <div className="px-4 py-2.5 border-b border-line bg-panel flex items-center gap-2">
        <span className="font-mono text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-chip text-stone flex-shrink-0">
          {ENTITY_LABEL[conflict.entityType]}
        </span>
        <span className="text-[13px] font-medium text-ink truncate">{conflictTitle(conflict)}</span>
      </div>

      <div className="grid grid-cols-2 divide-x divide-line">
        <div className="p-3.5 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-stone uppercase tracking-wide">
            <Laptop className="h-3 w-3" /> This device
          </div>
          <div className="text-[11px] text-mute font-mono">
            {formatWhen(conflict.local.updatedAt)}
            {conflict.local.deviceId ? ` · ${shortDevice(conflict.local.deviceId)}` : ""}
          </div>
          <button
            onClick={() => handleChoice("local")}
            disabled={resolving !== null}
            className="h-8 px-3 rounded-lg text-[12px] font-medium bg-clay hover:bg-clay-dark text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {resolving === "local" ? "Applying…" : "Keep this version"}
          </button>
        </div>

        <div className="p-3.5 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-stone uppercase tracking-wide">
            <Cloud className="h-3 w-3" /> Cloud{conflict.cloud.deleted ? " (deleted)" : ""}
          </div>
          <div className="text-[11px] text-mute font-mono">
            {formatWhen(conflict.cloud.updatedAt)}
            {conflict.cloud.deviceId ? ` · ${shortDevice(conflict.cloud.deviceId)}` : ""}
          </div>
          <button
            onClick={() => handleChoice("cloud")}
            disabled={resolving !== null}
            className="h-8 px-3 rounded-lg text-[12px] font-medium bg-cream border border-line hover:bg-panel text-graphite transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {resolving === "cloud" ? "Applying…" : conflict.cloud.deleted ? "Accept deletion" : "Keep cloud version"}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3.5 pb-3 text-[11px] text-danger">{error}</div>
      )}
    </div>
  );
}

export default function SyncConflictModal() {
  const { syncConflicts, resolveSyncConflict } = useAppContext();
  // Tracks the conflict count as of the last dismissal — derived (not a
  // useEffect-driven) so a later sync pass that changes the count re-surfaces
  // the modal instead of hiding new conflicts silently.
  const [dismissedAtCount, setDismissedAtCount] = useState<number | null>(null);
  const dismissed = dismissedAtCount !== null && dismissedAtCount === syncConflicts.length;

  if (syncConflicts.length === 0 || dismissed) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      style={{ background: "rgba(20,20,19,0.5)", backdropFilter: "blur(2px)" }}
    >
      <div
        className="bg-cream rounded-2xl shadow-[0_24px_48px_-12px_rgba(20,20,19,0.18)] flex flex-col w-full"
        style={{ maxWidth: 640, maxHeight: "85vh" }}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-line flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <div>
              <h2 className="m-0 font-serif text-xl font-medium text-ink">
                {syncConflicts.length === 1 ? "Sync conflict" : `${syncConflicts.length} sync conflicts`}
              </h2>
              <p className="m-0 text-[12.5px] text-stone">
                Changed on this device and in the cloud since the last sync. Pick which version to keep.
              </p>
            </div>
          </div>
          <button
            onClick={() => setDismissedAtCount(syncConflicts.length)}
            className="h-8 w-8 rounded-lg border border-line flex items-center justify-center hover:bg-panel transition-colors flex-shrink-0"
            title="Review later"
          >
            <X className="h-4 w-4 text-graphite" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3">
          {syncConflicts.map((conflict) => (
            <ConflictCard
              key={`${conflict.entityType}:${conflict.localId}`}
              conflict={conflict}
              onResolve={resolveSyncConflict}
            />
          ))}
        </div>

        <div className="px-6 py-4 border-t border-line flex-shrink-0">
          <p className="m-0 text-[11.5px] text-mute">
            Unresolved conflicts are safe to leave — nothing is overwritten until you choose, and they&apos;ll reappear next sync.
          </p>
        </div>
      </div>
    </div>
  );
}
