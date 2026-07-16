"use client";

import { useEffect, useState } from "react";
import { isTauri } from "./tauri";

/** The desktop app's version, read from tauri.conf.json via Tauri's core API
 * at runtime. Empty outside Tauri (dev/browser), since there's no packaged
 * version to report there. */
export function useAppVersion(): string {
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const v = await getVersion();
        if (!cancelled) setVersion(v);
      } catch (e) {
        console.warn("Failed to read app version:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return version;
}
