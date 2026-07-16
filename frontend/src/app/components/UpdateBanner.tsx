"use client";

import React, { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { isTauri } from "../utils/tauri";

// Checks GitHub releases (latest.json) for a newer signed build on app start.
// Renders nothing outside the Tauri desktop app.
export default function UpdateBanner() {
  const [updateRef, setUpdateRef] = useState<any>(null);
  const [version, setVersion] = useState("");
  const [updating, setUpdating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!cancelled && update) {
          setUpdateRef(update);
          setVersion(update.version);
        }
      } catch (e) {
        // Offline or endpoint unreachable — never block the app over updates
        console.warn("Update check failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onUpdate = async () => {
    if (!updateRef || updating) return;
    setUpdating(true);
    setErrorMsg("");
    try {
      await updateRef.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e: any) {
      console.error("Update failed:", e);
      setErrorMsg(e?.message || String(e));
      setUpdating(false);
    }
  };

  if (!version || dismissed) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-clay text-white text-[13px] flex-shrink-0">
      <Download className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1 truncate">
        {errorMsg
          ? `Update failed: ${errorMsg}`
          : `Version ${version} is available.`}
      </span>
      <button
        onClick={onUpdate}
        disabled={updating}
        className="h-7 px-3 bg-white/15 hover:bg-white/25 rounded-md font-medium transition-colors disabled:opacity-60 flex items-center gap-1.5 flex-shrink-0"
      >
        {updating ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Installing…
          </>
        ) : errorMsg ? (
          "Retry"
        ) : (
          "Update & restart"
        )}
      </button>
      <button
        onClick={() => setDismissed(true)}
        disabled={updating}
        className="h-7 w-7 rounded-md hover:bg-white/15 flex items-center justify-center transition-colors flex-shrink-0"
        title="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
