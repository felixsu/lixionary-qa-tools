"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  SignalResult,
  invokeSidecarProcessAlive,
  checkTauriReadiness,
  checkSidecarLoad,
  checkLocalDatabase,
  checkVpsBackend,
} from "./backendStatus";

const VPS_API_URL = process.env.NEXT_PUBLIC_VPS_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'http://localhost:8000' : 'https://qa-tools-api.lixionary.com');
const LOCAL_API_URL = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:8484';

const POLL_INTERVAL_MS = 20_000;

interface BackendStatusContextType {
  tauri: SignalResult | null; // null = first check hasn't completed yet
  sidecar: SignalResult | null;
  localDb: SignalResult | null;
  vps: SignalResult | null;
  refresh: () => void;
}

const BackendStatusContext = createContext<BackendStatusContextType | undefined>(undefined);

// Mounted at the root layout (not inside AppProvider/the dashboard) so all
// four signals — including "is the sidecar even up" — are visible on the
// login screen too, which is exactly where sidecar-startup-lag issues have
// historically caused silent, confusing sign-in failures.
export function BackendStatusProvider({ children }: { children: React.ReactNode }) {
  const [tauri, setTauri] = useState<SignalResult | null>(null);
  const [sidecar, setSidecar] = useState<SignalResult | null>(null);
  const [localDb, setLocalDb] = useState<SignalResult | null>(null);
  const [vps, setVps] = useState<SignalResult | null>(null);
  const inFlightRef = useRef(false);

  const runChecks = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      // Sequenced, not Promise.all'd: sidecar's status depends on the shared
      // Tauri invoke, and the local-db check deliberately depends on the
      // sidecar's outcome (so a down sidecar doesn't also get double-reported
      // as a separate DB failure). VPS is independent, runs alongside DB.
      const invokeResult = await invokeSidecarProcessAlive();
      setTauri(checkTauriReadiness(invokeResult));

      const sidecarResult = await checkSidecarLoad(invokeResult, LOCAL_API_URL);
      setSidecar(sidecarResult);

      const [dbResult, vpsResult] = await Promise.all([
        checkLocalDatabase(sidecarResult, LOCAL_API_URL),
        checkVpsBackend(VPS_API_URL),
      ]);
      setLocalDb(dbResult);
      setVps(vpsResult);
    } finally {
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    runChecks();
    const interval = setInterval(runChecks, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <BackendStatusContext.Provider value={{ tauri, sidecar, localDb, vps, refresh: runChecks }}>
      {children}
    </BackendStatusContext.Provider>
  );
}

export function useBackendStatus(): BackendStatusContextType {
  const ctx = useContext(BackendStatusContext);
  if (!ctx) throw new Error("useBackendStatus must be used within a BackendStatusProvider");
  return ctx;
}
