"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Globe, Eye, Crosshair, FileCode, Play,
  Save, Rows, Lock, X, Activity,
  ChevronDown, Copy, Mail, Anchor, Loader2, ScanSearch,
  Sparkles, StopCircle, AppWindow, Braces,
} from "lucide-react";
import { useAppContext } from "../../context/AppContext";
import { useWebExplorer } from "../../context/WebExplorerContext";
import type { NetworkLog, NetworkDetails } from "../../context/WebExplorerContext";
import { useToast } from "../../context/ToastContext";
import Dropdown from "../../components/Dropdown";
import { Modal, ModalFooter } from "../../components/Modal";
import { MY_PAGE_FILE } from "./lib/workspaceFiles";
import BrowserPreview from "./components/BrowserPreview";
import WorkspacePanel from "./components/WorkspacePanel";
import NetworkPanel from "./components/NetworkPanel";
import SaveToCollectionModal from "./components/modals/SaveToCollectionModal";
import PythonClientModal from "./components/modals/PythonClientModal";
import { useWorkspaceFiles } from "./hooks/useWorkspaceFiles";
import { useScriptRunner } from "./hooks/useScriptRunner";
import { usePythonAutocomplete } from "./hooks/usePythonAutocomplete";

export default function WebExplorerPage() {
  const {
    profiles,
    selectedProfileId,
    setSelectedProfileId,
    apiCall,
  } = useAppContext();
  const {
    browserUrl,
    setBrowserUrl,
    isBrowserConnected,
    inspectMode,
    sessionId,
    selectedElement,
    setSelectedElement,
    selectedElementLocators,
    setSelectedElementLocators,
    selectedElementStale,
    setSelectedElementStale,
    inspectError,
    setInspectError,
    pageScanStatus,
    pageScanError,
    pageScanResults,
    pageScanScopeLabel,
    handleScanPage,
    resetPageScan,
    selectedElementAction,
    setSelectedElementAction,
    selectedElementMethodName,
    setSelectedElementMethodName,
    selectedElementTestValue,
    setSelectedElementTestValue,
    isVerifying,
    verifyAttempts,
    verifyResult,
    handleVerifyElement,
    selectorTestResult,
    isTestingSelector,
    handleTestSelector,
    handleClearHighlights,
    handleVerifyCustomSelector,
    handleFocusBrowserWindow,
    isExploring,
    exploreSteps,
    setExploreSteps,
    explorePrompt,
    setExplorePrompt,
    handleStartExplore,
    handleStopExplore,
    isRecording,
    handleBrowserNavigate,
    handleToggleInspect,
    anchorElement,
    handleSetAnchor,
    handleClearAnchor,
    handleStartBrowser,
    handleDisconnectBrowser,
    userSessions,
    fetchUserSessions,
    handleCloseSession,
    handleReconnectSession,
  } = useWebExplorer();

  const [limitExceededModalOpen, setLimitExceededModalOpen] = useState(false);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [closingSessionId, setClosingSessionId] = useState<string | null>(null);

  const onCloseSession = async (sessId: string) => {
    if (closingSessionId) return;
    setClosingSessionId(sessId);
    try {
      await handleCloseSession(sessId);
    } finally {
      setClosingSessionId(null);
    }
  };

  const onStartBrowser = async () => {
    if (isStartingSession) return;
    setIsStartingSession(true);
    try {
      await handleStartBrowser(selectedProfileId);
      // Do NOT clear isStartingSession here — wait for isBrowserConnected (via useEffect below)
    } catch (e: any) {
      setIsStartingSession(false);
      if (e.status === 429 && e.detail && e.detail.error === "resource_depleted") {
        setActiveSessions(e.detail.active_sessions || []);
        setLimitExceededModalOpen(true);
      } else {
        showToast(e.message || "Failed to start browser session", { type: "error" });
      }
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

  const [newFileName, setNewFileName] = useState<string>("");
  const [showNewFileModal, setShowNewFileModal] = useState<boolean>(false);
  const [showSessionsDropdown, setShowSessionsDropdown] = useState<boolean>(false);
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

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName || !sessionId) return;
    try {
      await workspace.createFile(newFileName);
      setShowNewFileModal(false);
      setNewFileName("");
    } catch (err: any) {
      showToast(`Failed to create file: ${err.message}`, { type: "error" });
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

  // Page-scan review drawer: per-element checkbox + editable method name
  const [scanSelections, setScanSelections] = useState<Record<number, { checked: boolean; name: string }>>({});
  const [isRecordingScan, setIsRecordingScan] = useState(false);
  const [showScanMenu, setShowScanMenu] = useState(false);
  const [showExploreMenu, setShowExploreMenu] = useState(false);
  const [exploreScope, setExploreScope] = useState<"page" | "selected">("page");
  // Manual selector testing — inspector-card override input + standalone tester card
  const [customSelectorInput, setCustomSelectorInput] = useState("");
  const [showSelectorTester, setShowSelectorTester] = useState(false);
  const [testerSelector, setTesterSelector] = useState("");
  const [testerAction, setTesterAction] = useState("click");
  const [testerValue, setTesterValue] = useState("");
  const [testerMethodName, setTesterMethodName] = useState("");
  const scanMenuRef = useRef<HTMLDivElement>(null);
  const exploreMenuRef = useRef<HTMLDivElement>(null);
  const sessionsMenuRef = useRef<HTMLDivElement>(null);

  // Close the Scan/Explore/Sessions dropdowns on an outside click or Escape.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (scanMenuRef.current && !scanMenuRef.current.contains(e.target as Node)) {
        setShowScanMenu(false);
      }
      if (exploreMenuRef.current && !exploreMenuRef.current.contains(e.target as Node)) {
        setShowExploreMenu(false);
      }
      if (sessionsMenuRef.current && !sessionsMenuRef.current.contains(e.target as Node)) {
        setShowSessionsDropdown(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShowScanMenu(false);
        setShowExploreMenu(false);
        setShowSessionsDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!pageScanResults) {
      setScanSelections({});
      return;
    }
    const seeded: Record<number, { checked: boolean; name: string }> = {};
    for (const el of pageScanResults) {
      seeded[el.id] = { checked: !el.disabled, name: el.methodName };
    }
    setScanSelections(seeded);
  }, [pageScanResults]);

  const checkedScanElements = (pageScanResults || []).filter((el) => scanSelections[el.id]?.checked);
  const scanNameCounts: Record<string, number> = {};
  for (const el of checkedScanElements) {
    const name = scanSelections[el.id]?.name?.trim() || "";
    scanNameCounts[name] = (scanNameCounts[name] || 0) + 1;
  }
  const hasScanNameConflicts = checkedScanElements.some((el) => {
    const name = scanSelections[el.id]?.name?.trim() || "";
    return !name || scanNameCounts[name] > 1;
  });

  const handleRecordScanned = async () => {
    if (!sessionId || checkedScanElements.length === 0) return;
    setIsRecordingScan(true);
    try {
      const res = await apiCall("/api/browser/pom/add-bulk", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          methods: checkedScanElements.map((el) => ({
            methodName: scanSelections[el.id].name,
            action: el.action,
            strategy: el.locator.strategy,
            selector: el.locator.selector,
            frameLocators: el.frameLocators || [],
          })),
        }),
      });
      const renamed = (res.added || []).filter((a: any) => a.requested !== a.recorded);
      if (renamed.length > 0) {
        showToast(
          `Recorded ${res.count} methods. ${renamed.length} renamed to avoid duplicates: ` +
          renamed.map((a: any) => `${a.requested} → ${a.recorded}`).join(", "),
          { type: "info" }
        );
      }
      resetPageScan();
      await fetchWorkspaceFiles();
      if (selectedWorkspaceFile === MY_PAGE_FILE) {
        await fetchFileContent(MY_PAGE_FILE);
      }
    } catch (e: any) {
      showToast(e.message || "Failed to record scanned elements.", { type: "error" });
    } finally {
      setIsRecordingScan(false);
    }
  };

  // When a custom selector typed in the inspector card tests successfully, it
  // becomes the primary strategy (index 0) — Verify and Record both use the
  // list head, so the manual selector automatically wins over generated ones.
  useEffect(() => {
    if (!selectorTestResult || selectorTestResult.error) return;
    if (showSelectorTester || !selectedElement) return;
    if (selectorTestResult.selector !== customSelectorInput.trim()) return;
    const entry = {
      strategy: "locator (Custom)",
      selector: selectorTestResult.selector,
      statement: `page.locator("${selectorTestResult.selector.replace(/"/g, '\\"')}")`,
      count: selectorTestResult.totalCount,
      unique: selectorTestResult.totalCount === 1,
      score: 200,
    };
    setSelectedElementLocators([entry, ...selectedElementLocators.filter((l) => l.strategy !== "locator (Custom)")]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectorTestResult]);

  // The frame chain a tested custom selector should execute/record against —
  // only unambiguous when exactly one frame matched.
  const testerFrameLocators =
    selectorTestResult && selectorTestResult.frames.length === 1
      ? selectorTestResult.frames[0].frameLocators
      : [];
  const testerHasValidResult =
    !!selectorTestResult &&
    !selectorTestResult.error &&
    selectorTestResult.selector === testerSelector.trim() &&
    selectorTestResult.totalCount > 0;

  const handleSaveTesterToPOM = async () => {
    if (!sessionId || !testerHasValidResult) return;
    const methodName = testerMethodName || `${testerAction}_custom_element`;
    try {
      await apiCall("/api/browser/pom/add", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          methodName,
          action: testerAction,
          strategy: "locator (Custom)",
          selector: testerSelector.trim(),
          frameLocators: testerFrameLocators,
        }),
      });
      showToast(`Method ${methodName} added to MyPage.`, { type: "info" });
      setTesterMethodName("");
      await fetchWorkspaceFiles();
      if (selectedWorkspaceFile === MY_PAGE_FILE) {
        await fetchFileContent(MY_PAGE_FILE);
      }
    } catch (e: any) {
      showToast(e.message || "Failed to record selector to POM class.", { type: "error" });
    }
  };

  const handleRecordElementToPOM = async () => {
    if (!selectedElement || !sessionId) return;
    const strategy = selectedElementLocators[0]?.strategy || "locator (CSS)";
    const selector = selectedElementLocators[0]?.selector || selectedElement.cssSelector;
    const methodName = selectedElementMethodName || `click_${selectedElement.tagName.toLowerCase()}`;
    
    try {
      await apiCall("/api/browser/pom/add", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          methodName,
          action: selectedElementAction,
          strategy,
          selector,
          frameLocators: selectedElement.frameLocators || [],
        }),
      });
      
      setSelectedElement(null);
      setSelectedElementLocators([]);
      setSelectedElementStale({ stale: false, reason: null });
      setSelectedElementMethodName("");
      
      await fetchWorkspaceFiles();
      if (selectedWorkspaceFile === MY_PAGE_FILE) {
        await fetchFileContent(MY_PAGE_FILE);
      }
    } catch (e: any) {
      showToast(e.message || "Failed to record element to POM class.", { type: "error" });
    }
  };

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
      {/* Control bar */}
      <div className="px-4 py-2.5 border-b border-line bg-panel flex items-center gap-2 flex-shrink-0">
        <Globe className="h-4 w-4 text-stone flex-shrink-0" />
        <div className="flex-1 h-[34px] bg-cream border border-line rounded-lg flex items-center px-3 gap-2">
          <Lock className="h-3 w-3 text-mute flex-shrink-0" />
          <input
            type="text"
            value={browserUrl}
            onChange={(e) => setBrowserUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isBrowserConnected) {
                handleBrowserNavigate();
              }
            }}
            placeholder="https://example.com"
            className="flex-1 bg-transparent font-mono text-xs text-ink outline-none disabled:text-stone"
          />
        </div>
        {isBrowserConnected ? (
          <>
            <button
              onClick={handleBrowserNavigate}
              className="h-[34px] px-3.5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors"
            >
              Go
            </button>
            <button
              onClick={handleToggleInspect}
              disabled={isVerifying || isExploring || isRecording}
              title={isVerifying ? "Inspect is disabled while verification is running" : isExploring ? "Inspect is disabled while exploration is running" : isRecording ? "Inspect is disabled while recording" : undefined}
              className="h-[34px] px-3.5 rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors border disabled:opacity-60"
              style={
                inspectMode
                  ? { background: "rgba(204,120,92,0.12)", borderColor: "rgba(204,120,92,0.4)", color: "#cc785c" }
                  : { background: "transparent", borderColor: "var(--color-line)", color: "var(--color-graphite)" }
              }
            >
              <Crosshair className="h-3.5 w-3.5" />
              {inspectMode ? "Inspecting" : "Inspect"}
            </button>
            <button
              onClick={() => {
                const next = !showSelectorTester;
                setShowSelectorTester(next);
                if (!next) handleClearHighlights();
              }}
              disabled={isVerifying || isExploring || isRecording}
              title="Type a selector manually, test it against the page, run actions and save it"
              className="h-[34px] px-3.5 rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors border disabled:opacity-60"
              style={
                showSelectorTester
                  ? { background: "rgba(204,120,92,0.12)", borderColor: "rgba(204,120,92,0.4)", color: "#cc785c" }
                  : { background: "transparent", borderColor: "var(--color-line)", color: "var(--color-graphite)" }
              }
            >
              <Braces className="h-3.5 w-3.5" />
              Selector
            </button>
            <button
              onClick={handleFocusBrowserWindow}
              title="Raise the live browser window — browsing and inspect clicks work there too"
              className="h-[34px] px-3 rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors border bg-transparent border-line text-graphite hover:bg-panel"
            >
              <AppWindow className="h-3.5 w-3.5" />
              Window
            </button>
            <div className="relative" ref={scanMenuRef}>
              <button
                onClick={() => setShowScanMenu((v) => !v)}
                disabled={pageScanStatus === "scanning" || isVerifying || isExploring || isRecording}
                title={isVerifying ? "Scan is disabled while verification is running" : isExploring ? "Scan is disabled while exploration is running" : isRecording ? "Scan is disabled while recording" : "Detect interactive elements and propose POM methods"}
                className="h-[34px] px-3.5 rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors border bg-transparent border-line text-graphite hover:bg-panel disabled:opacity-60"
              >
                {pageScanStatus === "scanning" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ScanSearch className="h-3.5 w-3.5" />
                )}
                {pageScanStatus === "scanning" ? "Scanning…" : "Scan"}
                <ChevronDown className="h-3 w-3" />
              </button>
              {showScanMenu && pageScanStatus !== "scanning" && (
                <div className="absolute right-0 top-full mt-1 w-[260px] bg-cream border border-line rounded-xl shadow-[0_8px_24px_rgba(20,20,19,0.12)] z-50 overflow-hidden">
                  <button
                    onClick={() => { setShowScanMenu(false); handleScanPage("page"); }}
                    className="w-full text-left px-3 py-2.5 text-xs text-ink hover:bg-panel transition-colors"
                  >
                    <span className="font-semibold block">Entire page</span>
                    <span className="text-mute text-[11px]">All frames, including iframes</span>
                  </button>
                  <button
                    onClick={() => { setShowScanMenu(false); handleScanPage("selected"); }}
                    disabled={!selectedElement}
                    className="w-full text-left px-3 py-2.5 text-xs text-ink hover:bg-panel transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-t border-line"
                  >
                    <span className="font-semibold block">Inside selected element</span>
                    <span className="text-mute text-[11px]">
                      {selectedElement
                        ? <>Scan within &lt;{selectedElement.tagName}&gt; {String(selectedElement.text || "").slice(0, 30)}</>
                        : "Inspect & click a parent element first"}
                    </span>
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handleToggleRecord}
              disabled={isVerifying || isExploring}
              title={isRecording ? "Stop recording user interactions" : "Record all user interactions on the page"}
              className={`h-[34px] px-3.5 rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors border ${
                isRecording
                  ? "bg-red-50 border-red-300 text-red-700 hover:bg-red-100 font-semibold"
                  : "bg-transparent border-line text-graphite hover:bg-panel"
              }`}
            >
              {isRecording ? (
                <>
                  <span className="h-2.5 w-2.5 rounded-full bg-red-600 animate-pulse flex-shrink-0" />
                  Recording…
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5 text-graphite" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="8" />
                  </svg>
                  Record
                </>
              )}
            </button>
            <div className="relative" ref={exploreMenuRef}>
              {isExploring ? (
                <button
                  onClick={handleStopExplore}
                  title="Stop exploration and keep whatever was discovered so far"
                  className="h-[34px] px-3.5 rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors border bg-red-50 border-red-300 text-red-700 hover:bg-red-100"
                >
                  <StopCircle className="h-3.5 w-3.5" />
                  Exploring… step {exploreSteps.length} (Stop)
                </button>
              ) : (
                <button
                  onClick={() => setShowExploreMenu((v) => !v)}
                  disabled={isVerifying || isRecording}
                  title={isRecording ? "Explore is disabled while recording" : "Let AI autonomously click/fill around the page to discover interactive elements"}
                  className="h-[34px] px-3.5 rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors border bg-transparent border-line text-graphite hover:bg-panel disabled:opacity-60"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Explore
                  <ChevronDown className="h-3 w-3" />
                </button>
              )}
              {showExploreMenu && !isExploring && (
                <div className="absolute right-0 top-full mt-1 w-[280px] bg-cream border border-line rounded-xl shadow-[0_8px_24px_rgba(20,20,19,0.12)] z-50 p-3 flex flex-col gap-2">
                  <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Scope</label>
                  <div className="flex rounded-md border border-line overflow-hidden">
                    <button
                      onClick={() => setExploreScope("page")}
                      className={`flex-1 h-7 text-[11px] font-medium transition-colors ${exploreScope === "page" ? "bg-clay text-white" : "bg-panel text-graphite hover:bg-line"}`}
                    >
                      Entire page
                    </button>
                    <button
                      onClick={() => selectedElement && setExploreScope("selected")}
                      disabled={!selectedElement}
                      title={selectedElement ? undefined : "Inspect & click a parent element first"}
                      className={`flex-1 h-7 text-[11px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${exploreScope === "selected" ? "bg-clay text-white" : "bg-panel text-graphite hover:bg-line"}`}
                    >
                      Selected element
                    </button>
                  </div>
                  {exploreScope === "selected" && selectedElement && (
                    <p className="text-[11px] text-mute -mt-1">
                      Restricted to &lt;{selectedElement.tagName}&gt; {String(selectedElement.text || "").slice(0, 30)}
                    </p>
                  )}
                  <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">
                    What should the AI explore? (optional)
                  </label>
                  <input
                    type="text"
                    value={explorePrompt}
                    onChange={(e) => setExplorePrompt(e.target.value)}
                    placeholder="e.g. explore the checkout flow"
                    className="h-8 bg-panel border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay"
                  />
                  <p className="text-[11px] text-mute">
                    Runs for a few minutes, clicking/filling around the page for real. Destructive-looking
                    actions (delete, pay, log out, etc.) are automatically skipped, and it won't leave this site.
                  </p>
                  <button
                    onClick={() => { setShowExploreMenu(false); handleStartExplore(exploreScope); }}
                    className="h-8 bg-clay hover:bg-clay-dark rounded-lg text-xs font-semibold text-white transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Start Exploring
                  </button>
                </div>
              )}
            </div>
            {/* Sessions dropdown */}
            <div className="relative" ref={sessionsMenuRef}>
              <button
                onClick={() => { setShowSessionsDropdown((v) => !v); fetchUserSessions(); }}
                className="h-[34px] px-3 bg-cream border border-line rounded-lg text-[13px] text-graphite hover:bg-panel transition-colors flex items-center gap-1.5"
              >
                Sessions <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {showSessionsDropdown && (
                <div className="absolute right-0 top-full mt-1 w-[320px] bg-cream border border-line rounded-xl shadow-[0_8px_24px_rgba(20,20,19,0.12)] z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-line flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone">Your sessions</span>
                    <button onClick={() => setShowSessionsDropdown(false)} className="text-mute hover:text-graphite">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="max-h-[240px] overflow-y-auto">
                    {userSessions.length === 0 && (
                      <p className="text-xs text-mute text-center py-4">No sessions found.</p>
                    )}
                    {userSessions.map((s) => (
                      <div key={s.session_id} className="flex items-center gap-2 px-3 py-2 border-b border-line last:border-0 hover:bg-panel transition-colors">
                        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${s.status === "active" ? "bg-sage" : s.status === "disconnected" ? "bg-stone" : "bg-danger"}`} />
                        <span className="font-mono text-[11px] text-graphite flex-1 truncate" title={s.session_id}>{s.session_id}</span>
                        <span className="text-[10px] text-mute capitalize">{s.status}</span>
                        {s.status === "disconnected" && (
                          <button
                            onClick={() => { handleReconnectSession(s.session_id); setShowSessionsDropdown(false); }}
                            className="text-[11px] font-medium text-clay hover:text-clay-dark"
                          >Reconnect</button>
                        )}
                        <button
                          onClick={() => onCloseSession(s.session_id)}
                          disabled={closingSessionId === s.session_id}
                          className="text-mute hover:text-danger transition-colors disabled:opacity-40"
                          title="Close session"
                        >
                          {closingSessionId === s.session_id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <X className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={handleDisconnectBrowser}
              className="h-[34px] px-3.5 bg-cream border border-line rounded-lg text-[13px] text-graphite hover:bg-panel transition-colors flex items-center gap-1.5"
            >
              <X className="h-3.5 w-3.5" /> Disconnect
            </button>
          </>
        ) : (
          <>
            <Dropdown
              value={selectedProfileId}
              onChange={setSelectedProfileId}
              className="h-[34px] px-3 rounded-lg text-[13px] text-graphite"
              options={[
                { value: "", label: "No profile (clean session)" },
                ...profiles.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            {/* Pre-connect: show existing sessions to reconnect */}
            {userSessions.length > 0 && (
              <div className="flex flex-col gap-1 border border-line rounded-lg px-3 py-2 max-w-[240px]">
                {userSessions.slice(0, 3).map((s) => (
                  <div key={s.session_id} className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full flex-shrink-0 ${s.status === "active" ? "bg-sage" : "bg-stone"}`} />
                    <span className="font-mono text-[10px] text-graphite truncate flex-1" title={s.session_id}>{s.session_id}</span>
                    <button
                      onClick={() => handleReconnectSession(s.session_id)}
                      className="text-[11px] font-medium text-clay hover:text-clay-dark whitespace-nowrap"
                    >Reconnect</button>
                    <button onClick={() => handleCloseSession(s.session_id)} className="text-mute hover:text-danger">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={onStartBrowser}
              disabled={isStartingSession}
              className="h-[34px] px-4 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white flex items-center gap-1.5 transition-colors disabled:opacity-60"
            >
              {isStartingSession ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…</>
              ) : (
                <><Play className="h-3.5 w-3.5" /> New Session</>
              )}
            </button>
          </>
        )}
      </div>

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

              {/* Anchor status banner — shown when user has set an anchor element */}
              {anchorElement && (
                <div className="absolute top-4 right-4 z-50 flex items-center gap-2 px-3 py-2 bg-panel border border-green-500/50 rounded-lg shadow-md text-xs">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
                  <span className="text-ink font-mono">
                    Anchor:{" "}
                    <span className="text-green-600 font-semibold">
                      &lt;{anchorElement.tagName}{anchorElement.id ? `#${anchorElement.id}` : ""}&gt;
                    </span>
                    {anchorElement.text && (
                      <span className="text-mute ml-1 truncate max-w-[80px] inline-block align-bottom">{anchorElement.text}</span>
                    )}
                  </span>
                  <button
                    onClick={handleClearAnchor}
                    title="Clear anchor"
                    className="ml-1 h-4 w-4 flex items-center justify-center text-mute hover:text-ink transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Page scan error toast */}
              {pageScanStatus === "error" && (
                <div className="absolute top-4 right-4 z-50 flex items-center gap-2 px-3 py-2 bg-panel border border-red-400/60 rounded-lg shadow-md text-xs">
                  <span className="text-red-600 font-medium">Scan failed: {pageScanError}</span>
                  <button
                    onClick={resetPageScan}
                    className="ml-1 h-4 w-4 flex items-center justify-center text-mute hover:text-ink transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Explore live step log */}
              {(isExploring || exploreSteps.length > 0) && (
                <div className="absolute bottom-4 left-4 z-40 w-96 max-h-64 bg-cream border border-line rounded-xl shadow-[0_12px_24px_rgba(20,20,19,0.15)] flex flex-col overflow-hidden">
                  <div className="px-3 py-2 border-b border-line bg-panel flex items-center justify-between flex-shrink-0">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-clay" />
                      {isExploring ? "Exploring…" : "Exploration finished"} ({exploreSteps.length} steps)
                    </span>
                    {!isExploring && (
                      <button
                        onClick={() => setExploreSteps([])}
                        className="h-5 w-5 rounded-md hover:bg-line flex items-center justify-center transition-colors"
                      >
                        <X className="h-3.5 w-3.5 text-mute hover:text-graphite" />
                      </button>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto px-3 py-2 text-[11px] font-mono flex flex-col gap-1">
                    {exploreSteps.map((s, i) => (
                      <div key={i} className={s.success === false ? "text-red-600" : "text-graphite"}>
                        #{s.step} {s.action}
                        {s.elementSummary ? `: ${s.elementSummary}` : ""}
                        {s.success === false && s.error ? ` — ${s.error}` : ""}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Page scan review drawer */}
              {pageScanResults && (
                <div className="absolute top-4 bottom-4 right-4 z-40 w-[420px] bg-cream border border-line rounded-xl shadow-[0_12px_24px_rgba(20,20,19,0.15)] flex flex-col overflow-hidden">
                  <div className="px-4 py-3 border-b border-line bg-panel">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink flex items-center gap-2">
                        <ScanSearch className="h-4 w-4 text-clay" />
                        {pageScanScopeLabel ? "Section scan" : "Page scan"} — {pageScanResults.length} elements
                      </span>
                      <button
                        onClick={resetPageScan}
                        className="h-6 w-6 rounded-md hover:bg-line flex items-center justify-center transition-colors"
                      >
                        <X className="h-4 w-4 text-mute hover:text-graphite" />
                      </button>
                    </div>
                    {pageScanScopeLabel && (
                      <div className="mt-1 font-mono text-[10px] text-clay truncate" title={pageScanScopeLabel}>
                        Scope: {pageScanScopeLabel}
                      </div>
                    )}
                  </div>

                  <div className="px-4 py-2 border-b border-line flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setScanSelections((prev) => {
                          const next = { ...prev };
                          for (const el of pageScanResults) next[el.id] = { ...next[el.id], checked: true };
                          return next;
                        })}
                        className="text-clay font-semibold hover:underline"
                      >
                        All
                      </button>
                      <span className="text-line">/</span>
                      <button
                        onClick={() => setScanSelections((prev) => {
                          const next = { ...prev };
                          for (const el of pageScanResults) next[el.id] = { ...next[el.id], checked: false };
                          return next;
                        })}
                        className="text-clay font-semibold hover:underline"
                      >
                        None
                      </button>
                    </div>
                    <span className="text-stone">{checkedScanElements.length} selected</span>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                    {pageScanResults.map((el) => {
                      const sel = scanSelections[el.id] || { checked: false, name: el.methodName };
                      const name = sel.name?.trim() || "";
                      const conflict = sel.checked && (!name || scanNameCounts[name] > 1);
                      return (
                        <div
                          key={el.id}
                          className={`p-2.5 rounded-lg border flex flex-col gap-1.5 ${
                            conflict ? "border-red-400" : "border-line"
                          } ${el.disabled ? "opacity-50" : ""} bg-panel`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={sel.checked}
                              onChange={(e) =>
                                setScanSelections((prev) => ({ ...prev, [el.id]: { ...sel, checked: e.target.checked } }))
                              }
                              className="h-3.5 w-3.5 accent-[#cc785c] flex-shrink-0"
                            />
                            <input
                              type="text"
                              value={sel.name}
                              onChange={(e) =>
                                setScanSelections((prev) => ({ ...prev, [el.id]: { ...sel, name: e.target.value } }))
                              }
                              className="flex-1 h-7 bg-cream border border-line rounded-md px-2 text-xs text-ink outline-none focus:border-clay font-mono min-w-0"
                            />
                            <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-cream border border-line text-stone flex-shrink-0">
                              {el.action}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 pl-5">
                            <span className="font-mono text-[11px] text-graphite truncate">
                              <span className="text-clay font-semibold">&lt;{el.tagName}&gt;</span> {el.text}
                            </span>
                            <span className="flex items-center gap-1.5 flex-shrink-0">
                              {el.frameLocators?.length > 0 && (
                                <span
                                  className="text-[9px] font-semibold uppercase px-1 py-0.5 rounded bg-clay/10 text-clay border border-clay/30"
                                  title={`Inside iframe: ${el.frameLocators.join(" → ")}`}
                                >
                                  iframe
                                </span>
                              )}
                              <span className="text-[10px] text-stone">
                                {el.locator?.unique ? "✅ Unique" : `⚠️ ${el.locator?.count ?? "?"} matches`}
                              </span>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {pageScanResults.length === 0 && (
                      <p className="text-xs text-mute text-center py-6">No interactive elements detected on this page.</p>
                    )}
                  </div>

                  <div className="p-3 border-t border-line bg-panel">
                    <button
                      onClick={handleRecordScanned}
                      disabled={checkedScanElements.length === 0 || hasScanNameConflicts || isRecordingScan}
                      className="w-full h-9 bg-clay hover:bg-clay-dark disabled:opacity-50 rounded-lg text-xs font-semibold text-white transition-colors shadow-sm flex items-center justify-center gap-1.5"
                    >
                      {isRecordingScan ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Record {checkedScanElements.length} selected
                    </button>
                    {hasScanNameConflicts && (
                      <p className="text-[10px] text-red-600 mt-1.5 text-center">
                        Fix duplicate or empty method names before recording.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Floating element inspector card overlay */}
              {selectedElement && !showSelectorTester && (
                <div className="absolute bottom-4 right-4 z-40 w-80 bg-cream border border-line rounded-xl shadow-[0_12px_24px_rgba(20,20,19,0.15)] flex flex-col overflow-hidden">
                  <div className="px-4 py-3 border-b border-line flex items-center justify-between bg-panel">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink flex items-center gap-2">
                      <Crosshair className="h-4 w-4 text-clay animate-pulse" /> Inspect Element
                    </span>
                    <button
                      onClick={() => { setSelectedElement(null); setSelectedElementLocators([]); setSelectedElementStale({ stale: false, reason: null }); setCustomSelectorInput(""); handleClearHighlights(); }}
                      className="h-6 w-6 rounded-md hover:bg-line flex items-center justify-center transition-colors"
                    >
                      <X className="h-4 w-4 text-mute hover:text-graphite" />
                    </button>
                  </div>

                  <div className="p-4 flex flex-col gap-3">
                    <div className="px-3 py-2 bg-panel rounded-lg border border-line font-mono text-[11px] text-graphite break-all max-h-24 overflow-y-auto">
                      <span className="text-clay font-semibold">&lt;{selectedElement.tagName}&gt;</span> {selectedElement.text}
                      {selectedElement.frameLocators?.length > 0 && (
                        <div className="text-[10px] text-clay font-semibold mt-1">
                          Frame: {selectedElement.frameLocators.join(" → ")}
                        </div>
                      )}
                    </div>

                    {selectedElementStale?.stale && (
                      <div className="px-3 py-2 bg-amber-50 border border-amber-300 rounded-lg text-[11px] text-amber-800 font-medium">
                        ⚠️ Content changed while analyzing — the dropdown is likely still loading or refreshing. Locators below may not match. Click the element again once it settles.
                      </div>
                    )}

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Method name</label>
                      <input
                        type="text"
                        value={selectedElementMethodName}
                        onChange={(e) => setSelectedElementMethodName(e.target.value)}
                        placeholder={`e.g. click_${selectedElement.tagName.toLowerCase()}`}
                        className="h-8 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay font-mono"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Action</label>
                      <Dropdown
                        value={selectedElementAction}
                        onChange={setSelectedElementAction}
                        className="h-8 px-2.5 rounded-md text-xs text-ink bg-cream"
                        options={[
                          { value: "click", label: "Click" },
                          { value: "fill", label: "Fill" },
                          { value: "type", label: "Type" },
                          { value: "hover", label: "Hover" },
                          { value: "check", label: "Check" },
                          { value: "select_option", label: "Select option" },
                          { value: "getText", label: "Get Text" },
                        ]}
                      />
                    </div>

                    {["fill", "type", "select_option"].includes(selectedElementAction) && (
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Test value</label>
                        <input
                          type="text"
                          value={selectedElementTestValue}
                          onChange={(e) => setSelectedElementTestValue(e.target.value)}
                          placeholder={selectedElementAction === "select_option" ? "option value attribute" : "sample value to type/fill"}
                          className="h-8 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay font-mono"
                        />
                      </div>
                    )}

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Locator strategy</label>
                      <Dropdown
                        value="0"
                        onChange={(v) => {
                          const selectedIdx = parseInt(v);
                          const loc = selectedElementLocators[selectedIdx];
                          if (loc) {
                            setSelectedElementLocators([loc, ...selectedElementLocators.filter((_, i) => i !== selectedIdx)]);
                          }
                        }}
                        widthClass="w-full"
                        className="h-8 px-2.5 rounded-md text-xs text-ink font-mono bg-cream"
                        openUpward
                        options={selectedElementLocators.map((loc, idx) => {
                          let uniqueness = "";
                          if (selectedElementStale?.stale && loc.count === 0) {
                            uniqueness = " ⚠️ (stale — retry)";
                          } else if (loc.unique === true) {
                            uniqueness = " ✅ (Unique)";
                          } else if (loc.unique === false) {
                            uniqueness = ` ⚠️ (${loc.count} matches)`;
                          }
                          return { value: String(idx), label: `${loc.strategy}${uniqueness}` };
                        })}
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Custom selector (optional)</label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={customSelectorInput}
                          onChange={(e) => setCustomSelectorInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && customSelectorInput.trim() && !isTestingSelector) {
                              handleTestSelector(customSelectorInput.trim());
                            }
                          }}
                          placeholder='css, xpath=…, text=…, a >> b'
                          className="flex-1 h-8 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay font-mono min-w-0"
                        />
                        <button
                          onClick={() => handleTestSelector(customSelectorInput.trim())}
                          disabled={!customSelectorInput.trim() || isTestingSelector}
                          title="Check how many elements this selector matches and highlight them"
                          className="h-8 px-2.5 bg-panel border border-line hover:border-clay rounded-md text-xs font-semibold text-ink transition-colors flex items-center gap-1 disabled:opacity-60"
                        >
                          {isTestingSelector ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 text-clay" />}
                          Test
                        </button>
                      </div>
                      {selectorTestResult?.error && selectorTestResult.selector === customSelectorInput.trim() && (
                        <p className="text-[11px] text-red-600 font-mono break-all">{selectorTestResult.error}</p>
                      )}
                      {selectorTestResult && !selectorTestResult.error && selectorTestResult.selector === customSelectorInput.trim() && (
                        <p className={`text-[11px] font-medium ${selectorTestResult.totalCount === 1 ? "text-green-700" : "text-amber-700"}`}>
                          {selectorTestResult.totalCount === 0
                            ? "No matches on this page"
                            : selectorTestResult.totalCount === 1
                              ? "✅ Unique match — set as primary strategy"
                              : `⚠️ ${selectorTestResult.totalCount} matches — actions need a unique selector (try >> nth=0)`}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2 mt-1">
                      <button
                        onClick={handleSetAnchor}
                        title="Set this element as XPath anchor — then click a descendant to get a relative XPath"
                        className="flex-1 h-9 bg-panel border border-line hover:border-green-500 rounded-lg text-xs font-semibold text-ink transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Anchor className="h-3.5 w-3.5 text-green-600" /> Set as Anchor
                      </button>
                      <button
                        onClick={handleVerifyElement}
                        disabled={isVerifying}
                        title="Try this action + locator live against the browser before recording it"
                        className="flex-1 h-9 bg-panel border border-line hover:border-blue-500 rounded-lg text-xs font-semibold text-ink transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
                      >
                        {isVerifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 text-blue-600" />}
                        {isVerifying ? "Verifying…" : "Verify"}
                      </button>
                      <button
                        onClick={handleRecordElementToPOM}
                        className="flex-1 h-9 bg-clay hover:bg-clay-dark rounded-lg text-xs font-semibold text-white transition-colors shadow-sm flex items-center justify-center gap-1.5"
                      >
                        <Save className="h-3.5 w-3.5" /> Record
                      </button>
                    </div>

                    {(verifyAttempts.length > 0 || verifyResult) && (
                      <div className="px-3 py-2 bg-panel rounded-lg border border-line text-[11px] font-mono max-h-28 overflow-y-auto">
                        {verifyAttempts.map((a, i) => (
                          <div key={i} className={a.status === "success" ? "text-green-700" : "text-mute"}>
                            {a.source === "llm" ? "🤖 " : ""}{a.strategy}: {a.status}{a.error ? ` — ${a.error}` : ""}
                          </div>
                        ))}
                        {verifyResult && (
                          <div className={verifyResult.success ? "text-green-700 font-semibold mt-1" : "text-red-600 font-semibold mt-1"}>
                            {verifyResult.success
                              ? `✅ Verified${verifyResult.resultText ? `: "${verifyResult.resultText}"` : ""}`
                              : "❌ All candidates failed"}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Standalone manual selector tester card — no inspect-click needed */}
              {showSelectorTester && (
                <div className="absolute bottom-4 right-4 z-40 w-80 bg-cream border border-line rounded-xl shadow-[0_12px_24px_rgba(20,20,19,0.15)] flex flex-col overflow-hidden">
                  <div className="px-4 py-3 border-b border-line flex items-center justify-between bg-panel">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink flex items-center gap-2">
                      <Braces className="h-4 w-4 text-clay" /> Selector Tester
                    </span>
                    <button
                      onClick={() => { setShowSelectorTester(false); handleClearHighlights(); }}
                      className="h-6 w-6 rounded-md hover:bg-line flex items-center justify-center transition-colors"
                    >
                      <X className="h-4 w-4 text-mute hover:text-graphite" />
                    </button>
                  </div>

                  <div className="p-4 flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Selector</label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={testerSelector}
                          onChange={(e) => setTesterSelector(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && testerSelector.trim() && !isTestingSelector) {
                              handleTestSelector(testerSelector.trim());
                            }
                          }}
                          placeholder='css, xpath=…, text=…, a >> b'
                          className="flex-1 h-8 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay font-mono min-w-0"
                        />
                        <button
                          onClick={() => handleTestSelector(testerSelector.trim())}
                          disabled={!testerSelector.trim() || isTestingSelector}
                          title="Check how many elements this selector matches and highlight them on the page"
                          className="h-8 px-2.5 bg-panel border border-line hover:border-clay rounded-md text-xs font-semibold text-ink transition-colors flex items-center gap-1 disabled:opacity-60"
                        >
                          {isTestingSelector ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 text-clay" />}
                          Test
                        </button>
                      </div>
                      <p className="text-[10px] text-mute">
                        Playwright syntax: CSS, <span className="font-mono">xpath=//…</span>, <span className="font-mono">text=Submit</span>, chaining with <span className="font-mono">&gt;&gt;</span>
                      </p>
                    </div>

                    {selectorTestResult && selectorTestResult.selector === testerSelector.trim() && (
                      selectorTestResult.error ? (
                        <p className="px-3 py-2 bg-red-50 border border-red-300 rounded-lg text-[11px] text-red-700 font-mono break-all">
                          {selectorTestResult.error}
                        </p>
                      ) : (
                        <div className={`px-3 py-2 rounded-lg border text-[11px] font-medium ${
                          selectorTestResult.totalCount === 1
                            ? "bg-green-50 border-green-300 text-green-800"
                            : selectorTestResult.totalCount === 0
                              ? "bg-panel border-line text-mute"
                              : "bg-amber-50 border-amber-300 text-amber-800"
                        }`}>
                          {selectorTestResult.totalCount === 0
                            ? "No matches on this page"
                            : selectorTestResult.totalCount === 1
                              ? "✅ Unique match (highlighted on the page)"
                              : `⚠️ ${selectorTestResult.totalCount} matches — Playwright strict mode rejects actions on multi-match selectors; refine it or append >> nth=0`}
                          {selectorTestResult.frames.filter((f) => f.frameLocators.length > 0).map((f, i) => (
                            <div key={i} className="text-[10px] font-mono mt-1">
                              {f.count} in frame: {f.frameLocators.join(" → ")}
                            </div>
                          ))}
                        </div>
                      )
                    )}

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Action</label>
                      <Dropdown
                        value={testerAction}
                        onChange={setTesterAction}
                        className="h-8 px-2.5 rounded-md text-xs text-ink bg-cream"
                        options={[
                          { value: "click", label: "Click" },
                          { value: "fill", label: "Fill" },
                          { value: "type", label: "Type" },
                          { value: "hover", label: "Hover" },
                          { value: "check", label: "Check" },
                          { value: "select_option", label: "Select option" },
                          { value: "getText", label: "Get Text" },
                        ]}
                      />
                    </div>

                    {["fill", "type", "select_option"].includes(testerAction) && (
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Test value</label>
                        <input
                          type="text"
                          value={testerValue}
                          onChange={(e) => setTesterValue(e.target.value)}
                          placeholder={testerAction === "select_option" ? "option value attribute" : "sample value to type/fill"}
                          className="h-8 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay font-mono"
                        />
                      </div>
                    )}

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Method name</label>
                      <input
                        type="text"
                        value={testerMethodName}
                        onChange={(e) => setTesterMethodName(e.target.value)}
                        placeholder={`e.g. ${testerAction}_custom_element`}
                        className="h-8 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay font-mono"
                      />
                    </div>

                    <div className="flex gap-2 mt-1">
                      <button
                        onClick={() => handleVerifyCustomSelector(testerSelector.trim(), testerAction, testerValue, testerFrameLocators)}
                        disabled={!testerHasValidResult || isVerifying}
                        title={testerHasValidResult ? "Run this action with the selector live against the browser" : "Test the selector first — it must match at least one element"}
                        className="flex-1 h-9 bg-panel border border-line hover:border-blue-500 rounded-lg text-xs font-semibold text-ink transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
                      >
                        {isVerifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 text-blue-600" />}
                        {isVerifying ? "Running…" : "Run"}
                      </button>
                      <button
                        onClick={handleSaveTesterToPOM}
                        disabled={!testerHasValidResult}
                        title={testerHasValidResult ? "Save as a POM method using this selector" : "Test the selector first — it must match at least one element"}
                        className="flex-1 h-9 bg-clay hover:bg-clay-dark rounded-lg text-xs font-semibold text-white transition-colors shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-60"
                      >
                        <Save className="h-3.5 w-3.5" /> Save to POM
                      </button>
                    </div>

                    {(verifyAttempts.length > 0 || verifyResult) && (
                      <div className="px-3 py-2 bg-panel rounded-lg border border-line text-[11px] font-mono max-h-28 overflow-y-auto">
                        {verifyAttempts.map((a, i) => (
                          <div key={i} className={a.status === "success" ? "text-green-700" : "text-mute"}>
                            {a.source === "llm" ? "🤖 " : ""}{a.strategy}: {a.status}{a.error ? ` — ${a.error}` : ""}
                          </div>
                        ))}
                        {verifyResult && (
                          <div className={verifyResult.success ? "text-green-700 font-semibold mt-1" : "text-red-600 font-semibold mt-1"}>
                            {verifyResult.success
                              ? `✅ Ran successfully${verifyResult.resultText ? `: "${verifyResult.resultText}"` : ""}`
                              : "❌ Action failed with this selector"}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
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
        <Modal title="Create Python module" onClose={() => { setShowNewFileModal(false); setNewFileName(""); }} width={420}>
          <form onSubmit={handleCreateFile} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Filename</label>
              <input
                type="text"
                placeholder="e.g. login_pom.py"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                autoFocus
                required
                className="h-10 bg-cream border border-line rounded-lg px-3.5 font-mono text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
              />
            </div>
            <ModalFooter onCancel={() => { setShowNewFileModal(false); setNewFileName(""); }} submitLabel="Create" />
          </form>
        </Modal>
      )}


      {/* Resource Limit Exceeded Modal */}
      {limitExceededModalOpen && (
        <Modal 
          title="Server Resource Limit Reached" 
          onClose={() => setLimitExceededModalOpen(false)} 
          width={640}
        >
          <div className="flex flex-col gap-4">
            <div className="text-[13px] text-mute leading-relaxed">
              The global limit of <strong>12 active browser sessions</strong> has been reached to prevent host Out of Memory (OOM) crashes.
              Please ask a teammate to close their idle session:
            </div>
            
            <div className="border border-line rounded-xl overflow-hidden max-h-[300px] overflow-y-auto bg-panel">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="bg-panel border-b border-line text-mute font-semibold">
                    <th className="p-3">Teammate</th>
                    <th className="p-3">Session ID</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {activeSessions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-mute">
                        No active sessions found (or data is unavailable).
                      </td>
                    </tr>
                  ) : (
                    activeSessions.map((sess) => (
                      <tr key={sess.session_id} className="border-b border-line last:border-0 hover:bg-cream/40">
                        <td className="p-3">
                          <div className="font-medium text-ink">{sess.owner_name}</div>
                          <div className="text-[11px] text-mute flex items-center gap-1.5 mt-0.5">
                            {sess.owner_email}
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(sess.owner_email);
                              }}
                              className="text-clay hover:text-clay-dark inline-flex items-center"
                              title="Copy Email Address"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <a 
                              href={`mailto:${sess.owner_email}?subject=Nudge: Close your idle Web Explorer session&body=Hi ${sess.owner_name},%0D%0A%0D%0ACould you please close your active browser session (${sess.session_id}) in Web Explorer so that I can start a session? Thanks!`} 
                              className="text-clay hover:text-clay-dark inline-flex items-center"
                              title="Email Teammate"
                            >
                              <Mail className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        </td>
                        <td className="p-3 font-mono text-[11px] text-graphite">{sess.session_id}</td>
                        <td className="p-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${
                            sess.status === "active" 
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" 
                              : sess.status === "disconnected" 
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" 
                              : "bg-panel text-mute"
                          }`}>
                            {sess.status}
                          </span>
                        </td>
                        <td className="p-3 text-[11px] text-mute">
                          {sess.created_at ? new Date(sess.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "N/A"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="flex justify-end pt-2 border-t border-line">
              <button 
                onClick={() => setLimitExceededModalOpen(false)}
                className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
