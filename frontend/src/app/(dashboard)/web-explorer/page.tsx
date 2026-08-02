"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Globe, Eye, FileCode, Play, Rows, Activity, Loader2,
} from "lucide-react";
import { useAppContext } from "../../context/AppContext";
import { useWebExplorer } from "../../context/WebExplorerContext";
import type { NetworkLog, NetworkDetails } from "../../context/WebExplorerContext";
import { useToast } from "../../context/ToastContext";
import { MY_PAGE_FILE } from "./lib/workspaceFiles";
import ControlBar from "./components/ControlBar";
import BrowserPreview from "./components/BrowserPreview";
import WorkspacePanel from "./components/WorkspacePanel";
import NetworkPanel from "./components/NetworkPanel";
import SaveToCollectionModal from "./components/modals/SaveToCollectionModal";
import PythonClientModal from "./components/modals/PythonClientModal";
import NewFileModal from "./components/modals/NewFileModal";
import AnchorBanner from "./components/overlays/AnchorBanner";
import ScanErrorToast from "./components/overlays/ScanErrorToast";
import ExploreLog from "./components/overlays/ExploreLog";
import ScanReviewDrawer from "./components/overlays/ScanReviewDrawer";
import InspectorCard from "./components/overlays/InspectorCard";
import { useWorkspaceFiles } from "./hooks/useWorkspaceFiles";
import { useScriptRunner } from "./hooks/useScriptRunner";
import { usePythonAutocomplete } from "./hooks/usePythonAutocomplete";
import { useEscapeActions } from "./hooks/useEscapeActions";

export default function WebExplorerPage() {
  const {
    selectedProfileId,
    apiCall,
  } = useAppContext();
  const {
    isBrowserConnected,
    inspectMode,
    sessionId,
    selectedElement,
    setSelectedElement,
    setSelectedElementLocators,
    setSelectedElementStale,
    handleClearHighlights,
    inspectError,
    setInspectError,
    isRecording,
    handleToggleInspect,
    handleStartBrowser,
  } = useWebExplorer();

  const [isStartingSession, setIsStartingSession] = useState(false);

  const onStartBrowser = async () => {
    if (isStartingSession) return;
    setIsStartingSession(true);
    try {
      await handleStartBrowser(selectedProfileId);
      // Do NOT clear isStartingSession here — wait for isBrowserConnected (via useEffect below)
    } catch (e: any) {
      setIsStartingSession(false);
      showToast(e.message || "Failed to start browser session", { type: "error" });
    }
  };

  // Clear loading state exactly when the browser becomes connected (WS "status" message received)
  useEffect(() => {
    if (isBrowserConnected) {
      setIsStartingSession(false);
    }
  }, [isBrowserConnected]);
  const [viewMode, setViewMode] = useState<"browser" | "split" | "workspace" | "network">("split");
  const [explorerWidth, setExplorerWidth] = useState<number>(220);
  const [workspaceSplitPercent, setWorkspaceSplitPercent] = useState<number>(50);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const [showNewFileModal, setShowNewFileModal] = useState<boolean>(false);
  const [isConsoleMinimized, setIsConsoleMinimized] = useState<boolean>(false);

  // Save network log to API Explorer collection
  const [showSaveToCollectionModal, setShowSaveToCollectionModal] = useState(false);
  const [pendingSaveLog, setPendingSaveLog] = useState<NetworkLog | null>(null);
  const [pendingSaveDetails, setPendingSaveDetails] = useState<NetworkDetails | null>(null);

  // Show Python client code for a network log
  const [showPythonModal, setShowPythonModal] = useState(false);
  const [pendingPythonLog, setPendingPythonLog] = useState<NetworkLog | null>(null);
  const [pendingPythonDetails, setPendingPythonDetails] = useState<NetworkDetails | null>(null);

  const { showToast } = useToast();

  const autocomplete = usePythonAutocomplete();
  const workspace = useWorkspaceFiles({ onFilesRefreshed: autocomplete.updateMethodsCache });
  const {
    selectedWorkspaceFile,
    fetchWorkspaceFiles,
    fetchFileContent,
    cancelPendingSave,
    handleToggleRecord,
  } = workspace;
  const runner = useScriptRunner({
    selectedWorkspaceFile,
    workspaceFileContent: workspace.workspaceFileContent,
    cancelPendingSave,
  });

  const handleCreateFile = async (name: string) => {
    if (!name || !sessionId) return;
    try {
      await workspace.createFile(name);
      setShowNewFileModal(false);
    } catch (err: any) {
      showToast(`Failed to create file: ${err.message}`, { type: "error" });
    }
  };

  // Refresh the file list, and re-fetch my_page.py if it's the open file —
  // shared follow-up for every action that records methods into MyPage.
  const refreshMyPageFile = async () => {
    await fetchWorkspaceFiles();
    if (selectedWorkspaceFile === MY_PAGE_FILE) {
      await fetchFileContent(MY_PAGE_FILE);
    }
  };

  // Surface element-inspection failures (e.g. a click inside an iframe that
  // threw while resolving the frame chain) instead of leaving the click
  // looking like it silently did nothing.
  useEffect(() => {
    if (inspectError) {
      showToast(`Inspect failed: ${inspectError}`, { type: "error" });
      setInspectError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectError]);

  // Restore persisted layout sizes on mount
  useEffect(() => {
    const sp = localStorage.getItem("lixionary_split_percent");
    const ew = localStorage.getItem("lixionary_explorer_width");
    if (sp) setWorkspaceSplitPercent(Number(sp));
    if (ew) setExplorerWidth(Number(ew));
  }, []);

  // Persist layout sizes when they change
  useEffect(() => {
    try { localStorage.setItem("lixionary_split_percent", String(workspaceSplitPercent)); } catch {}
  }, [workspaceSplitPercent]);

  useEffect(() => {
    try { localStorage.setItem("lixionary_explorer_width", String(explorerWidth)); } catch {}
  }, [explorerWidth]);

  const handleSplitDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startPercent = workspaceSplitPercent;
    setIsDraggingSplit(true);
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      // Moving divider right shrinks workspace (browser expands), so subtract delta
      const deltaPercent = ((moveEvent.clientX - startX) / rect.width) * 100;
      setWorkspaceSplitPercent(Math.min(Math.max(startPercent - deltaPercent, 20), 80));
    };
    const handleMouseUp = () => {
      setIsDraggingSplit(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleSidebarDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = explorerWidth;
    // In split mode the file tree is on the RIGHT, so drag direction is inverted
    const reversed = viewMode === "split";
    setIsDraggingSidebar(true);
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const newWidth = Math.min(Math.max(startWidth + (reversed ? -dx : dx), 140), 400);
      setExplorerWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsDraggingSidebar(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // Recording and inspecting shouldn't run at once — auto turn off inspect mode
  // whenever recording starts, whether triggered by the button above or a
  // server-pushed "recording_started" WS message.
  useEffect(() => {
    if (isRecording && inspectMode) {
      handleToggleInspect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  // Manual selector testing — inspector-card override input. State lives here
  // so it survives the card unmounting when the element is dismissed.
  const [customSelectorInput, setCustomSelectorInput] = useState("");

  // Shared full reset for the InspectorCard — used by its ✕ button, after a
  // successful Record, and by the Escape ladder, so all paths stay in sync.
  const dismissInspectorCard = () => {
    setSelectedElement(null);
    setSelectedElementLocators([]);
    setSelectedElementStale({ stale: false, reason: null });
    setCustomSelectorInput("");
    handleClearHighlights();
  };

  useEscapeActions({ dismissInspectorCard });

  const handleOpenSaveModal = async (log: NetworkLog, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingSaveLog(log);
    setPendingSaveDetails(null);
    setShowSaveToCollectionModal(true);
    try {
      const data = await apiCall(`/api/browser/network/${sessionId}/details/${log.id}`);
      setPendingSaveDetails(data);
    } catch { /* non-fatal — save with basic NetworkLog info */ }
  };

  const handleOpenPythonModal = async (log: NetworkLog, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingPythonLog(log);
    setPendingPythonDetails(null);
    setShowPythonModal(true);
    try {
      const data = await apiCall(`/api/browser/network/${sessionId}/details/${log.id}`);
      setPendingPythonDetails(data);
    } catch { /* non-fatal — generate from basic NetworkLog info */ }
  };

  const viewModes: { id: "browser" | "split" | "workspace" | "network"; label: string; icon: any }[] = [
    { id: "browser", label: "Browser", icon: Eye },
    { id: "split", label: "Split", icon: Rows },
    { id: "workspace", label: "Workspace", icon: FileCode },
    { id: "network", label: "Network Activity", icon: Activity },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ControlBar
        onToggleRecord={handleToggleRecord}
        onStartBrowser={onStartBrowser}
        isStartingSession={isStartingSession}
      />

      {isBrowserConnected ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Main workspace area - expanded to full-width */}
          <div className="w-full h-full flex flex-col overflow-hidden bg-ink-950">
            <div className="h-10 bg-cream border-b border-line px-4 flex items-center gap-3 flex-shrink-0">
              <span className="text-[10px] uppercase font-semibold tracking-[0.1em] text-mute">View mode</span>
              <div className="flex bg-cream border border-line rounded-lg p-0.5">
                {viewModes.map((vm) => {
                  const on = viewMode === vm.id;
                  const Icon = vm.icon;
                  return (
                    <button
                      key={vm.id}
                      onClick={() => { setViewMode(vm.id); if (vm.id !== "browser") fetchWorkspaceFiles(); }}
                      className="px-3 py-1 text-[11px] font-medium rounded-md flex items-center gap-1.5 transition-colors"
                      style={on ? { background: "var(--color-clay)", color: "#fff" } : { color: "var(--color-stone)" }}
                    >
                      <Icon className="h-3 w-3" /> {vm.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div ref={containerRef} className="flex-1 overflow-hidden relative bg-ink-950 flex">
              {viewMode === "browser" && (
                <BrowserPreview dragOverlayActive={isDraggingSplit || isDraggingSidebar} />
              )}

              {viewMode === "workspace" && (
                <div className="w-full h-full flex flex-col overflow-hidden">
                  <WorkspacePanel
                    explorerWidth={explorerWidth}
                    onSidebarDragStart={handleSidebarDragStart}
                    workspace={workspace}
                    runner={runner}
                    onEditorMount={autocomplete.handleEditorDidMount}
                    isConsoleMinimized={isConsoleMinimized}
                    setIsConsoleMinimized={setIsConsoleMinimized}
                    onNewFile={() => setShowNewFileModal(true)}
                  />
                </div>
              )}

              {viewMode === "split" && (
                <div className="w-full h-full flex flex-row overflow-hidden">
                  <div style={{ width: `${100 - workspaceSplitPercent}%` }} className="h-full bg-ink-950 flex flex-col overflow-hidden flex-shrink-0">
                    <BrowserPreview dragOverlayActive={isDraggingSplit || isDraggingSidebar} />
                  </div>
                  <div onMouseDown={handleSplitDragStart} className="w-1 bg-line hover:bg-clay cursor-col-resize transition-colors flex-shrink-0 h-full z-10 select-none" />
                  <div style={{ width: `${workspaceSplitPercent}%` }} className="h-full flex flex-col overflow-hidden flex-shrink-0">
                    <WorkspacePanel
                      fileListOnRight
                      explorerWidth={explorerWidth}
                      onSidebarDragStart={handleSidebarDragStart}
                      workspace={workspace}
                      runner={runner}
                      onEditorMount={autocomplete.handleEditorDidMount}
                      isConsoleMinimized={isConsoleMinimized}
                      setIsConsoleMinimized={setIsConsoleMinimized}
                      onNewFile={() => setShowNewFileModal(true)}
                    />
                  </div>
                </div>
              )}

              {viewMode === "network" && (
                <div className="w-full h-full flex flex-col overflow-hidden bg-cream">
                  <NetworkPanel onOpenPythonModal={handleOpenPythonModal} onOpenSaveModal={handleOpenSaveModal} />
                </div>
              )}

              <AnchorBanner />
              <ScanErrorToast />
              <ExploreLog />
              <ScanReviewDrawer onRecorded={refreshMyPageFile} />
              {selectedElement && (
                <InspectorCard
                  customSelectorInput={customSelectorInput}
                  setCustomSelectorInput={setCustomSelectorInput}
                  onDismiss={dismissInspectorCard}
                  onRecorded={refreshMyPageFile}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
          <Globe className="h-12 w-12 text-mute" />
          <div className="text-lg font-medium text-graphite">Browser session inactive</div>
          <div className="text-[13px] text-mute text-center max-w-[360px] leading-relaxed">
            Select a browser profile and click New Session to start a live session. You can then
            inspect elements and record Page Object Models.
          </div>
          <button
            onClick={onStartBrowser}
            disabled={isStartingSession}
            className="mt-2 h-10 px-6 bg-clay hover:bg-clay-dark rounded-lg text-sm font-medium text-white flex items-center gap-2 transition-colors disabled:opacity-60"
          >
            {isStartingSession ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Starting…</>
            ) : (
              <><Play className="h-4 w-4" /> New Session</>
            )}
          </button>
        </div>
      )}

      {/* Save network log to collection modal */}
      {showSaveToCollectionModal && pendingSaveLog && (
        <SaveToCollectionModal
          log={pendingSaveLog}
          details={pendingSaveDetails}
          onClose={() => setShowSaveToCollectionModal(false)}
        />
      )}

      {showPythonModal && pendingPythonLog && (
        <PythonClientModal
          log={pendingPythonLog}
          details={pendingPythonDetails}
          onClose={() => setShowPythonModal(false)}
        />
      )}

      {/* New file modal */}
      {showNewFileModal && (
        <NewFileModal
          onCreate={handleCreateFile}
          onClose={() => setShowNewFileModal(false)}
        />
      )}

    </div>
  );
}
