"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { FlowRunSummary } from "../utils/flowRunner";

const LOCAL_API_URL = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:8484';

const POLL_INTERVAL_MS = 5_000;

export interface FlowRunMeta {
  runId: string;
  flowLocalId: string;
  flowName: string;
  environmentLocalId: string | null;
  environmentName: string | null;
  source: "user" | "mcp";
  status: "running" | "success" | "failed" | "cancelled";
  nodeCount: number;
  startedAt: string;
  durationMs: number | null;
  avgDurationMs: number | null;
  hasReport: boolean;
}

export interface FlowRunDetail extends FlowRunMeta {
  summary: FlowRunSummary | null;
}

export interface RegisterRunPayload {
  flowLocalId: string;
  flowName: string;
  environmentLocalId: string | null;
  environmentName: string | null;
  nodeCount: number;
  summary: FlowRunSummary;
}

interface FlowRunsContextType {
  runs: FlowRunMeta[];
  activeRuns: FlowRunMeta[];
  refresh: () => void;
  registerRun: (payload: RegisterRunPayload) => Promise<void>;
  fetchRun: (runId: string) => Promise<FlowRunDetail | null>;
}

const FlowRunsContext = createContext<FlowRunsContextType | undefined>(undefined);

// Polls the sidecar's flow-run history so Home can list past executions and
// both Home and API Studio can show MCP-triggered (agent) runs that are
// executing in the background — those run entirely server-side, so polling is
// the only way the UI learns about them.
export function FlowRunsProvider({ children }: { children: React.ReactNode }) {
  const [runs, setRuns] = useState<FlowRunMeta[]>([]);
  const inFlightRef = useRef(false);

  const refresh = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch(`${LOCAL_API_URL}/api/flow-runs?limit=20`);
      if (!res.ok) return;
      setRuns(await res.json());
    } catch {
      // Sidecar unreachable — keep last-known list; BackendStatusContext
      // already surfaces sidecar connectivity issues elsewhere.
    } finally {
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    const handleVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, []);

  const registerRun = async (payload: RegisterRunPayload) => {
    try {
      await fetch(`${LOCAL_API_URL}/api/flow-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      refresh();
    } catch {
      // History is best-effort — a failed registration must never surface as
      // a run failure to the user.
    }
  };

  const fetchRun = async (runId: string): Promise<FlowRunDetail | null> => {
    try {
      const res = await fetch(`${LOCAL_API_URL}/api/flow-runs/${runId}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  const activeRuns = runs.filter((r) => r.status === "running");

  return (
    <FlowRunsContext.Provider value={{ runs, activeRuns, refresh, registerRun, fetchRun }}>
      {children}
    </FlowRunsContext.Provider>
  );
}

export function useFlowRuns(): FlowRunsContextType {
  const ctx = useContext(FlowRunsContext);
  if (!ctx) throw new Error("useFlowRuns must be used within a FlowRunsProvider");
  return ctx;
}
