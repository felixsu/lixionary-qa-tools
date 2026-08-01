"use client";

import { useEffect, useRef, useState } from "react";
import { useAppContext } from "../../../context/AppContext";
import { useWebExplorer } from "../../../context/WebExplorerContext";
import { useToast } from "../../../context/ToastContext";
import { confirmDialog } from "../../../utils/confirmDialog";
import { MAIN_FILE, RECORDING_FILE, isReadOnlyFile } from "../lib/workspaceFiles";

export interface WorkspaceFileEntry {
  name: string;
  size: number;
  updatedAt: string;
}

/**
 * Workspace file list, selection, content, and the auto-save machinery.
 *
 * The auto-save state lives in refs (not state) so the debounced callback and
 * flush-on-switch never act on stale values captured in an earlier render's
 * closure. This moves as one atomic unit — the sequencing guarantees
 * (cancelPendingSave before run/reset/delete, flushPendingSave before loading
 * a newly selected file, save-chain ordering of POSTs) are load-bearing.
 */
export function useWorkspaceFiles({ onFilesRefreshed }: { onFilesRefreshed?: () => void } = {}) {
  const { apiCall } = useAppContext();
  const { sessionId, isRecording, handleStartRecording, handleStopRecording } = useWebExplorer();
  const { showToast } = useToast();

  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileEntry[]>([]);
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<string>("");
  const [workspaceFileContent, setWorkspaceFileContent] = useState<string>("");
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState<boolean>(false);

  // Auto-save machinery: refs so the debounced callback and flush-on-switch
  // never act on stale state captured in an earlier render's closure.
  const contentRef = useRef<string>("");
  const dirtyFileRef = useRef<string>("");
  const dirtyRef = useRef<boolean>(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const fetchWorkspaceFiles = async () => {
    if (!sessionId) return;
    try {
      const data = await apiCall(`/api/workspace/files?session_id=${sessionId}`);
      setWorkspaceFiles(data);
      if (data.length > 0 && !selectedWorkspaceFile) setSelectedWorkspaceFile(data[0].name);
      onFilesRefreshed?.();
    } catch (e) {
      console.error("Failed to fetch workspace files", e);
    }
  };

  const fetchFileContent = async (filename: string) => {
    if (!filename || !sessionId) return;
    try {
      setIsWorkspaceLoading(true);
      const res = await apiCall(`/api/workspace/files/${filename}?session_id=${sessionId}`);
      setWorkspaceFileContent(res.content);
    } catch (e) {
      console.error("Failed to fetch file content", e);
    } finally {
      setIsWorkspaceLoading(false);
    }
  };

  const saveFile = (filename: string, content: string): Promise<void> => {
    const sid = sessionIdRef.current;
    if (!filename || !sid || isReadOnlyFile(filename)) return Promise.resolve();
    const run = async () => {
      try {
        await apiCall(`/api/workspace/files/${filename}?session_id=${sid}`, {
          method: "POST",
          body: JSON.stringify({ content }),
        });
        fetchWorkspaceFiles();
      } catch (e: any) {
        showToast(`Failed to save ${filename}: ${e.message}`, { type: "error" });
      }
    };
    // Chain saves so POSTs never land out of order (e.g. a debounced save
    // in flight when a flush-on-switch fires)
    saveChainRef.current = saveChainRef.current.then(run, run);
    return saveChainRef.current;
  };

  const flushPendingSave = (): Promise<void> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!dirtyRef.current) return Promise.resolve();
    // Clear before awaiting so a concurrent flush can't double-fire. On save
    // failure we stay non-dirty: the next keystroke re-arms with full content,
    // and retry loops against a dead session are worse than one clear toast.
    dirtyRef.current = false;
    return saveFile(dirtyFileRef.current, contentRef.current);
  };

  const cancelPendingSave = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    dirtyRef.current = false;
  };

  const handleEditorChange = (val: string | undefined) => {
    const v = val || "";
    setWorkspaceFileContent(v);
    if (!selectedWorkspaceFile || isReadOnlyFile(selectedWorkspaceFile)) return;
    contentRef.current = v;
    dirtyFileRef.current = selectedWorkspaceFile;
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { flushPendingSave(); }, 1000);
  };

  const handleSaveWorkspaceFile = async () => {
    if (!selectedWorkspaceFile || !sessionId) return;
    cancelPendingSave();
    await saveFile(selectedWorkspaceFile, workspaceFileContent);
  };

  const handleResetWorkspaceFile = async () => {
    if (!selectedWorkspaceFile || !sessionId) return;
    if (!(await confirmDialog(`Are you sure you want to reset ${selectedWorkspaceFile} to its default boilerplate? This will overwrite all your current modifications.`))) {
      return;
    }
    // A pending debounced save firing after the reset would clobber the boilerplate
    cancelPendingSave();
    setIsWorkspaceLoading(true);
    try {
      const data = await apiCall(`/api/workspace/reset`, {
        method: "POST",
        body: JSON.stringify({ sessionId, filename: selectedWorkspaceFile }),
      });
      setWorkspaceFileContent(data.content || "");
      showToast("File reset to default boilerplate", { type: "success" });
    } catch (e: any) {
      showToast(`Failed to reset file: ${e.message}`, { type: "error" });
    } finally {
      setIsWorkspaceLoading(false);
    }
  };

  const createFile = async (rawName: string) => {
    if (!rawName || !sessionId) return;
    let name = rawName.trim();
    if (!name.endsWith(".py")) name += ".py";
    await apiCall(`/api/workspace/files/${name}?session_id=${sessionId}`, {
      method: "POST",
      body: JSON.stringify({ content: "# New workspace module\n" }),
    });
    await fetchWorkspaceFiles();
    setSelectedWorkspaceFile(name);
  };

  const handleDeleteFile = async (filename: string) => {
    if (filename === MAIN_FILE) { showToast("main.py cannot be deleted.", { type: "error" }); return; }
    if (!(await confirmDialog(`Are you sure you want to delete ${filename}?`))) return;
    if (!sessionId) return;
    // A pending flush after the DELETE would re-create the file (POST creates)
    if (filename === dirtyFileRef.current) cancelPendingSave();
    try {
      await apiCall(`/api/workspace/files/${filename}?session_id=${sessionId}`, { method: "DELETE" });
      if (selectedWorkspaceFile === filename) setSelectedWorkspaceFile(MAIN_FILE);
      await fetchWorkspaceFiles();
    } catch (e: any) {
      showToast(`Failed to delete file: ${e.message}`, { type: "error" });
    }
  };

  const handleToggleRecord = async () => {
    if (isRecording) {
      handleStopRecording();
    } else {
      handleStartRecording();
      setSelectedWorkspaceFile(RECORDING_FILE);
      setTimeout(async () => {
        await fetchWorkspaceFiles();
        await fetchFileContent(RECORDING_FILE);
      }, 500);
    }
  };

  // Live-refresh my_recording.py while it's open and the recorder appends steps
  // (the WS handler re-dispatches recording_step_added as a window event).
  useEffect(() => {
    const handleStepAdded = async () => {
      if (selectedWorkspaceFile === RECORDING_FILE) {
        await fetchFileContent(RECORDING_FILE);
      }
    };
    window.addEventListener("recording-step-added", handleStepAdded);
    return () => {
      window.removeEventListener("recording-step-added", handleStepAdded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkspaceFile]);

  useEffect(() => {
    if (sessionId) {
      cancelPendingSave(); // the previous session's workspace may be gone
      fetchWorkspaceFiles();
      setSelectedWorkspaceFile("");
      setWorkspaceFileContent("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    const load = async () => {
      // Flush the previous file's pending edits (via refs) before fetching the
      // new one, so a rapid A→edit→B→A switch can't read stale content
      await flushPendingSave();
      if (selectedWorkspaceFile) fetchFileContent(selectedWorkspaceFile);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkspaceFile]);

  // Flush any pending edit on unmount so nothing typed is lost.
  useEffect(() => {
    return () => {
      flushPendingSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    workspaceFiles,
    selectedWorkspaceFile,
    setSelectedWorkspaceFile,
    workspaceFileContent,
    isWorkspaceLoading,
    fetchWorkspaceFiles,
    fetchFileContent,
    flushPendingSave,
    cancelPendingSave,
    handleEditorChange,
    handleSaveWorkspaceFile,
    handleResetWorkspaceFile,
    createFile,
    handleDeleteFile,
    handleToggleRecord,
  };
}
