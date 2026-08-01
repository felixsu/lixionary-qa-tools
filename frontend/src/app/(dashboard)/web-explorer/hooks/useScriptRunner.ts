"use client";

import { useRef, useState } from "react";
import { useAppContext } from "../../../context/AppContext";
import { useWebExplorer } from "../../../context/WebExplorerContext";
import { useToast } from "../../../context/ToastContext";

// Cap the console buffer so a chatty script can't grow an unbounded string —
// every appended chunk re-renders the whole <pre>, which used to degrade the
// page on long runs. 200k chars ≈ a few thousand lines of scrollback.
const MAX_CONSOLE_CHARS = 200_000;
const TRUNCATION_MARKER = "…[earlier output truncated]\n";

const appendCapped = (prev: string, chunk: string): string => {
  const next = prev + chunk;
  if (next.length <= MAX_CONSOLE_CHARS) return next;
  return TRUNCATION_MARKER + next.slice(next.length - MAX_CONSOLE_CHARS);
};

/**
 * Streams a workspace script run into the execution console. The reader and
 * run/stop stay together: Stop cancels the client-side reader, then asks the
 * sidecar to terminate the subprocess. Deliberately no unmount cleanup — a
 * run left behind by navigation keeps draining into a detached closure, which
 * is the long-standing behavior.
 */
export function useScriptRunner({
  selectedWorkspaceFile,
  workspaceFileContent,
  cancelPendingSave,
}: {
  selectedWorkspaceFile: string;
  workspaceFileContent: string;
  cancelPendingSave: () => void;
}) {
  const { apiCall, apiFetch } = useAppContext();
  const { sessionId, inspectMode, handleToggleInspect } = useWebExplorer();
  const { showToast } = useToast();

  const [workspaceLogs, setWorkspaceLogs] = useState<string>("");
  const [isScriptRunning, setIsScriptRunning] = useState<boolean>(false);
  const activeReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const handleRunScript = async () => {
    if (!selectedWorkspaceFile || !sessionId) return;

    // Automatically turn off inspect mode if active
    if (inspectMode) {
      handleToggleInspect();
    }

    setIsScriptRunning(true);
    setWorkspaceLogs("");
    cancelPendingSave(); // run saves the file itself below
    try {
      await apiCall(`/api/workspace/files/${selectedWorkspaceFile}?session_id=${sessionId}`, {
        method: "POST",
        body: JSON.stringify({ content: workspaceFileContent }),
      });
    } catch (e) {
      console.warn("Failed to auto-save file before running", e);
    }
    try {
      // apiFetch (not apiCall): the run endpoint streams stdout, so we need
      // the raw Response; record=false keeps diagnostics from buffering it.
      const response = await apiFetch("/api/workspace/run", {
        method: "POST",
        body: JSON.stringify({ filename: selectedWorkspaceFile, session_id: sessionId }),
      }, false);
      if (!response.body) throw new Error("No response body available");
      const reader = response.body.getReader();
      activeReaderRef.current = reader;
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        setWorkspaceLogs((prev) => appendCapped(prev, decoder.decode(value, { stream: true })));
      }
    } catch (err: any) {
      setWorkspaceLogs((prev) => appendCapped(prev, `\nExecution Error: ${err.message}\n`));
    } finally {
      activeReaderRef.current = null;
      setIsScriptRunning(false);
    }
  };

  const handleStopScript = async () => {
    if (activeReaderRef.current) {
      try {
        await activeReaderRef.current.cancel();
      } catch (err) {
        console.warn("Failed to cancel active reader", err);
      }
      activeReaderRef.current = null;
    }
    if (!sessionId) return;
    try {
      await apiCall(`/api/workspace/stop?session_id=${sessionId}`, { method: "POST" });
    } catch (e: any) {
      showToast(`Failed to stop script: ${e.message}`, { type: "error" });
    }
  };

  return { workspaceLogs, setWorkspaceLogs, isScriptRunning, handleRunScript, handleStopScript };
}
