"use client";

import { useRef, useState } from "react";
import { useAppContext } from "../../../context/AppContext";
import { useWebExplorer } from "../../../context/WebExplorerContext";
import { useToast } from "../../../context/ToastContext";

const LOCAL_API_URL = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:8484';

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
  const { token, apiCall } = useAppContext();
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
      const response = await fetch(`${LOCAL_API_URL}/api/workspace/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename: selectedWorkspaceFile, session_id: sessionId }),
      });
      if (!response.body) throw new Error("No response body available");
      const reader = response.body.getReader();
      activeReaderRef.current = reader;
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        setWorkspaceLogs((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (err: any) {
      setWorkspaceLogs((prev) => prev + `\nExecution Error: ${err.message}\n`);
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
