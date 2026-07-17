"use client";

import { useEffect, useRef, useState } from "react";
import { isTauri } from "./tauri";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Checks GitHub releases (latest.json) for a newer signed build: once on
 * mount, every hour thereafter, and on demand via checkNow(). Single source
 * of truth shared by UpdateBanner (install prompt) and the manual check
 * button in the sidebar, since both need to reflect the same in-flight
 * update object. No-op outside the Tauri desktop app. */
export function useUpdateChecker() {
  const [update, setUpdate] = useState<any>(null);
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [justChecked, setJustChecked] = useState(false);
  const inFlightRef = useRef(false);

  const checkNow = async () => {
    if (!isTauri() || inFlightRef.current) return;
    inFlightRef.current = true;
    setChecking(true);
    setCheckError("");
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const result = await check();
      if (result) {
        setUpdate(result);
        setVersion(result.version);
      } else {
        setJustChecked(true);
        setTimeout(() => setJustChecked(false), 2000);
      }
    } catch (e: any) {
      // Offline or endpoint unreachable — never block the app over updates
      console.warn("Update check failed:", e);
      setCheckError(e?.message || String(e));
    } finally {
      setChecking(false);
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    checkNow();
    const interval = setInterval(checkNow, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { update, version, checking, checkError, justChecked, checkNow };
}
