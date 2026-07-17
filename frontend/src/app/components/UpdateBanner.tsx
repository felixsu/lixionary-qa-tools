"use client";

import React, { useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";

// Renders the "update available" prompt once useUpdateChecker (see
// ../utils/useUpdateChecker.ts, the shared source of truth also driving the
// sidebar's manual check button) finds a newer signed build.
export default function UpdateBanner({ update, version }: { update: any; version: string }) {
  const [updating, setUpdating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [dismissedVersion, setDismissedVersion] = useState("");

  const onUpdate = async () => {
    if (!update || updating) return;
    setUpdating(true);
    setErrorMsg("");
    try {
      await update.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e: any) {
      console.error("Update failed:", e);
      setErrorMsg(e?.message || String(e));
      setUpdating(false);
    }
  };

  // A dismissal only hides the specific version the user dismissed — if the
  // hourly check later finds a newer one, the banner reappears instead of
  // staying silently hidden forever.
  if (!version || version === dismissedVersion) return null;

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
        onClick={() => setDismissedVersion(version)}
        disabled={updating}
        className="h-7 w-7 rounded-md hover:bg-white/15 flex items-center justify-center transition-colors flex-shrink-0"
        title="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
