// Pure logic for the backend-monitoring panel: four independent signals
// (Tauri IPC, Python sidecar, local SQLite store, cloud VPS backend). No
// React here — BackendStatusContext.tsx owns the polling loop and state.

import { isTauri } from "../utils/tauri";

export type SignalStatus = "ok" | "degraded" | "error" | "unavailable";

export interface SignalResult {
  status: SignalStatus;
  detail: string;
  checkedAt: string;
}

function result(status: SignalStatus, detail: string): SignalResult {
  return { status, detail, checkedAt: new Date().toISOString() };
}

async function fetchOk(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Signal 1 groundwork: one shared Tauri round-trip, reused by signals 1 & 2 ---

export type SidecarProcessInvokeResult =
  | { kind: "not-tauri" }
  | { kind: "ipc-error" }
  | { kind: "ok"; alive: boolean };

/** Invokes the sidecar_process_alive Rust command (frontend/src-tauri/src/lib.rs).
 * A successful round-trip proves the Tauri IPC bridge itself works — there's no
 * other "ready" event to key off (the window shows as soon as it's built). The
 * returned `alive` bool is the sidecar child process's OS-level status. */
export async function invokeSidecarProcessAlive(): Promise<SidecarProcessInvokeResult> {
  if (!isTauri()) return { kind: "not-tauri" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const alive = await invoke<boolean>("sidecar_process_alive");
    return { kind: "ok", alive };
  } catch {
    return { kind: "ipc-error" };
  }
}

// --- Signal 1: Tauri readiness ---

export function checkTauriReadiness(invokeResult: SidecarProcessInvokeResult): SignalResult {
  switch (invokeResult.kind) {
    case "not-tauri":
      return result("unavailable", "Running in a browser tab, not the desktop app.");
    case "ipc-error":
      return result("error", "Tauri IPC bridge isn't responding.");
    case "ok":
      return result("ok", "Tauri IPC bridge is responding.");
  }
}

// --- Signal 2: Python sidecar load ---

export async function checkSidecarLoad(
  invokeResult: SidecarProcessInvokeResult,
  localApiUrl: string
): Promise<SignalResult> {
  if (invokeResult.kind === "not-tauri") {
    return result("unavailable", "The sidecar only runs inside the desktop app.");
  }

  const processAlive = invokeResult.kind === "ok" ? invokeResult.alive : null;
  if (processAlive === false) {
    return result("error", "Sidecar process isn't running — try restarting the app.");
  }

  const httpOk = await fetchOk(`${localApiUrl}/health`, 3000);
  if (httpOk) {
    return result("ok", "Sidecar is responding.");
  }

  // Process is alive (or we couldn't confirm via a broken invoke) but HTTP
  // isn't up yet — this is the expected state for the first minute or so of a
  // fresh launch while bootstrap_sidecar.py sets up its venv/pip/playwright,
  // not a failure.
  return result("degraded", "Sidecar is starting up (first launch can take a few minutes).");
}

// --- Signal 3: local database ---

export async function checkLocalDatabase(
  sidecarSignal: SignalResult,
  localApiUrl: string
): Promise<SignalResult> {
  if (sidecarSignal.status === "unavailable") {
    return result("unavailable", "The local database only runs inside the desktop app.");
  }
  if (sidecarSignal.status === "error" || sidecarSignal.status === "degraded") {
    // Same root cause as signal 2 — don't double-report it as a second failure.
    return result("unavailable", "Can't check yet — waiting on the sidecar.");
  }

  try {
    const res = await fetch(`${localApiUrl}/api/local-store/device-id`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (!data.deviceId) throw new Error();
    return result("ok", "Local database is functional.");
  } catch {
    return result("error", "Local database isn't responding.");
  }
}

// --- Signal 4: VPS backend ---

export async function checkVpsBackend(vpsApiUrl: string): Promise<SignalResult> {
  try {
    const res = await fetch(`${vpsApiUrl}/`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error();
    return result("ok", "Cloud backend is reachable.");
  } catch {
    return result("error", "Cloud backend is unreachable.");
  }
}
