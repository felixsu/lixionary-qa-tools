"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Globe, Terminal, Eye, Crosshair, Download, Trash2, Plus, FileCode, Play,
  Save, File, Folder, XCircle, Rows, Lock, X, Layers, Code2, Clipboard, Activity,
  ChevronDown, ChevronUp, RotateCcw, Copy, Check, Mail, Anchor, Loader2, ScanSearch,
  CheckCircle2, AlertCircle, Sparkles, StopCircle,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { useAppContext } from "../../context/AppContext";
import type { NetworkLog, NetworkDetails } from "../../context/AppContext";
import Dropdown from "../../components/Dropdown";

const LOCAL_API_URL = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:8484';

const methodStyle = (m: string): React.CSSProperties => {
  const map: Record<string, { bg: string; c: string }> = {
    GET: { bg: "#e3f5e9", c: "#276749" },
    POST: { bg: "#e3ecff", c: "#1a4db5" },
    PUT: { bg: "#fff3e0", c: "#9a5c00" },
    DELETE: { bg: "#fde8e8", c: "#c64545" },
    PATCH: { bg: "#f3e8ff", c: "#6d28d9" },
  };
  const s = map[m] || { bg: "#f0f0ee", c: "#6c6a64" };
  return { background: s.bg, color: s.c };
};

const statusStyle = (status: number | null): React.CSSProperties => {
  if (status === null) return { background: "#fff3e0", color: "#9a5c00" };
  if (status < 400) return { background: "#e3f5e9", color: "#276749" };
  return { background: "#fde8e8", color: "#c64545" };
};
export default function WebExplorerPage() {
  const {
    browserUrl,
    setBrowserUrl,
    isBrowserConnected,
    inspectMode,
    vncUrl,
    latestFrame,
    sessionId,
    sendBrowserMouseEvent,
    sendBrowserWheelEvent,
    sendBrowserKeyboardEvent,
    networkLogs,
    networkFilter,
    setNetworkFilter,
    networkPillFilter,
    setNetworkPillFilter,
    handleClearNetworkLogs,
    logDetails,
    setLogDetails,
    activePomClass,
    setActivePomClass,
    pomClasses,
    setPomClasses,
    pomElements,
    setPomElements,
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
    isExploring,
    exploreSteps,
    setExploreSteps,
    explorePrompt,
    setExplorePrompt,
    handleStartExplore,
    handleStopExplore,
    activeGenCodeTab,
    setActiveGenCodeTab,
    generatedPomCode,
    setGeneratedPomCode,
    generatedClientCode,
    setGeneratedClientCode,
    selectedLogsForClient,
    setSelectedLogsForClient,
    clientBaseUrl,

    collections,
    handleSaveNetworkRequestToCollection,
    handleSaveNetworkRequestToNewCollection,

    profiles,
    selectedProfileId,
    setSelectedProfileId,
    token,
    apiCall,
    handleBrowserNavigate,
    handleToggleInspect,
    handlePasteText,
    anchorElement,
    handleSetAnchor,
    handleClearAnchor,
    handleStartBrowser,
    handleDisconnectBrowser,
    handleLogClick,
    userSessions,
    fetchUserSessions,
    handleCloseSession,
    handleReconnectSession,
    browserTabs,
    activeTabIndex,
    handleSwitchTab,
    handleCloseTab,
  } = useAppContext();

  // While verifying an inspected element (or running an autonomous Explore
  // session), the noVNC view must be watch-only — the automation is really
  // driving the tab, so the user shouldn't be able to fight it for control.
  // Changing the iframe src forces noVNC to reconnect (brief flicker), which
  // is an accepted tradeoff over patching the VNC container's static assets
  // for a runtime toggle.
  //
  // IMPORTANT: always pass view_only explicitly (0 or 1), never omit it.
  // noVNC's own webutil.js falls back to (and re-persists into) localStorage
  // for this origin whenever the URL doesn't specify it — so omitting the
  // param once we're done verifying/exploring doesn't "unset" it, it silently
  // inherits whatever was last stored, permanently wedging every future
  // session read-only until that stale localStorage entry is overwritten.
  const effectiveVncUrl = vncUrl ? `${vncUrl}&view_only=${(isVerifying || isExploring) ? 1 : 0}` : vncUrl;

  const previewContainerRef = useRef<HTMLDivElement>(null);

  const handlePreviewMouseEvent = (e: React.MouseEvent, type: "click" | "move" | "down" | "up") => {
    if (isVerifying || isExploring) return;
    if (!previewContainerRef.current || !isBrowserConnected) return;

    if (type === "move" && e.buttons !== 1 && !inspectMode) return;

    const rect = previewContainerRef.current.getBoundingClientRect();
    const containerWidth = rect.width;
    const containerHeight = rect.height;
    
    // Viewport aspect ratio is 1280 / 720 (16/9)
    const imageAspectRatio = 1280 / 720;
    const containerAspectRatio = containerWidth / containerHeight;
    
    let renderedWidth = containerWidth;
    let renderedHeight = containerHeight;
    let offsetX = 0;
    let offsetY = 0;
    
    if (containerAspectRatio > imageAspectRatio) {
      // Container is wider than the image: black bars on left/right
      renderedWidth = containerHeight * imageAspectRatio;
      offsetX = (containerWidth - renderedWidth) / 2;
    } else {
      // Container is taller than the image: black bars on top/bottom
      renderedHeight = containerWidth / imageAspectRatio;
      offsetY = (containerHeight - renderedHeight) / 2;
    }
    
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    const x = (clickX - offsetX) / renderedWidth;
    const y = (clickY - offsetY) / renderedHeight;
    
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
      sendBrowserMouseEvent(type, x, y);
    }
  };

  const handlePreviewKeyDown = (e: React.KeyboardEvent) => {
    if (inspectMode || isVerifying || isExploring) return;
    if (!isBrowserConnected) return;

    e.preventDefault();
    e.stopPropagation();

    sendBrowserKeyboardEvent(e.key);
  };

  const handlePreviewWheel = (e: React.WheelEvent) => {
    if (isVerifying || isExploring) return;
    if (!isBrowserConnected) return;

    sendBrowserWheelEvent(e.deltaX, e.deltaY);
  };

  const [workspaceFiles, setWorkspaceFiles] = useState<{ name: string; size: number; updatedAt: string }[]>([]);
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
        alert(e.message || "Failed to start browser session");
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

  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<string>("");
  const [workspaceFileContent, setWorkspaceFileContent] = useState<string>("");
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState<boolean>(false);
  const [workspaceLogs, setWorkspaceLogs] = useState<string>("");
  const [isScriptRunning, setIsScriptRunning] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>("");
  const [showNewFileModal, setShowNewFileModal] = useState<boolean>(false);
  const [showSaveToWorkspaceModal, setShowSaveToWorkspaceModal] = useState<boolean>(false);
  const [saveToWorkspaceFilename, setSaveToWorkspaceFilename] = useState<string>("");
  const [showSessionsDropdown, setShowSessionsDropdown] = useState<boolean>(false);
  const [isConsoleMinimized, setIsConsoleMinimized] = useState<boolean>(false);

  // Save network log to API Explorer collection
  const [showSaveToCollectionModal, setShowSaveToCollectionModal] = useState(false);
  const [pendingSaveLog, setPendingSaveLog] = useState<NetworkLog | null>(null);
  const [pendingSaveDetails, setPendingSaveDetails] = useState<NetworkDetails | null>(null);
  const [saveCollectionId, setSaveCollectionId] = useState("");
  const [saveRequestName, setSaveRequestName] = useState("");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [saveDuplicates, setSaveDuplicates] = useState<{ collectionName: string; requestName: string }[]>([]);
  const [saveShowDuplicateWarning, setSaveShowDuplicateWarning] = useState(false);

  // Show Python client code for a network log
  const [showPythonModal, setShowPythonModal] = useState(false);
  const [pythonCopied, setPythonCopied] = useState(false);
  const [pendingPythonLog, setPendingPythonLog] = useState<NetworkLog | null>(null);
  const [pendingPythonDetails, setPendingPythonDetails] = useState<NetworkDetails | null>(null);
  const [isSavingToCollection, setIsSavingToCollection] = useState(false);

  const pageMethodsRef = useRef<{ name: string; args: string; doc: string }[]>([]);
  const clientMethodsRef = useRef<{ name: string; args: string; doc: string }[]>([]);
  const completionProviderRef = useRef<any>(null);
  const activeReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

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

  // Toast (workspace save feedback)
  const [toast, setToast] = useState<{ msg: string; variant: "success" | "error" } | null>(null);
  const showToast = (msg: string, variant: "success" | "error" = "success") => {
    setToast({ msg, variant });
    setTimeout(() => setToast(null), 2600);
  };

  // Surface element-inspection failures (e.g. a click inside an iframe that
  // threw while resolving the frame chain) instead of leaving the click
  // looking like it silently did nothing.
  useEffect(() => {
    if (inspectError) {
      showToast(`Inspect failed: ${inspectError}`, "error");
      setInspectError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectError]);

  useEffect(() => {
    return () => {
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose();
        completionProviderRef.current = null;
      }
      flushPendingSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const toClassName = (snake: string) =>
    snake.replace(/\.py$/, "").split("_").filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");

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

  const parsePythonMethods = (content: string) => {
    const methods: { name: string; args: string; doc: string }[] = [];
    const regex = /def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\):(?:\s*\n\s*"""([^"]*)""")?/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      if (name === "__init__") continue;
      const args = match[2].trim();
      const doc = match[3] ? match[3].trim() : "";
      methods.push({ name, args, doc });
    }
    return methods;
  };

  const updateMethodsCache = async () => {
    if (!sessionId) return;
    let myPageMethods: { name: string; args: string; doc: string }[] = [];
    let playgroundMethods: { name: string; args: string; doc: string }[] = [];
    try {
      const pageData = await apiCall(`/api/workspace/files/inspection_code/my_page.py?session_id=${sessionId}`);
      if (pageData && pageData.content) {
        myPageMethods = parsePythonMethods(pageData.content);
      }
    } catch (e) {
      console.error("Failed to parse my_page.py", e);
    }
    try {
      const pgData = await apiCall(`/api/workspace/files/playground.py?session_id=${sessionId}`);
      if (pgData && pgData.content) {
        playgroundMethods = parsePythonMethods(pgData.content);
      }
    } catch (e) {
      console.error("Failed to parse playground.py", e);
    }
    // PlaygroundPage extends MyPage: suggest the union, overrides win
    const seen = new Set(playgroundMethods.map((m) => m.name));
    pageMethodsRef.current = [...playgroundMethods, ...myPageMethods.filter((m) => !seen.has(m.name))];
    try {
      const clientData = await apiCall(`/api/workspace/files/inspection_code/my_client.py?session_id=${sessionId}`);
      if (clientData && clientData.content) {
        clientMethodsRef.current = parsePythonMethods(clientData.content);
      }
    } catch (e) {
      console.error("Failed to parse my_client.py", e);
    }
  };

  const handleEditorDidMount = (editor: any, monaco: any) => {
    if (!completionProviderRef.current) {
      completionProviderRef.current = monaco.languages.registerCompletionItemProvider("python", {
        triggerCharacters: [".", "p", "m"],
        provideCompletionItems: (model: any, position: any) => {
          const lineContent = model.getLineContent(position.lineNumber);
          const textBeforeCursor = lineContent.substring(0, position.column - 1);
          
          // mPage is the current template variable; playground_page kept for
          // workspaces scaffolded before the rename
          if (/(^|[^\w])(mPage|playground_page)\.$/.test(textBeforeCursor)) {
            return {
              suggestions: pageMethodsRef.current.map((m) => ({
                label: m.name,
                kind: monaco.languages.CompletionItemKind.Method,
                insertText: m.name + "(" + (m.args.includes("value") ? '"${1:value}"' : "") + ")",
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                detail: `(method) ${m.name}(${m.args})`,
                documentation: m.doc,
                range: {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: position.column,
                  endColumn: position.column
                }
              }))
            };
          }
          
          if (textBeforeCursor.endsWith("playground_client.")) {
            return {
              suggestions: clientMethodsRef.current.map((m) => ({
                label: m.name,
                kind: monaco.languages.CompletionItemKind.Method,
                insertText: m.name + "(" + (m.args.includes("payload") ? "payload=${1:payload_obj}" : "") + ")",
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                detail: `(method) ${m.name}(${m.args})`,
                documentation: m.doc,
                range: {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: position.column,
                  endColumn: position.column
                }
              }))
            };
          }

          const word = model.getWordUntilPosition(position);
          if (!textBeforeCursor.includes(".")) {
            const vars = [
              { label: "mPage", detail: "PlaygroundPage instance" },
              { label: "playground_client", detail: "PlaygroundClient instance" }
            ];
            return {
              suggestions: vars.map((v) => ({
                label: v.label,
                kind: monaco.languages.CompletionItemKind.Variable,
                insertText: v.label,
                detail: v.detail,
                range: {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: word.startColumn,
                  endColumn: word.endColumn
                }
              }))
            };
          }

          return { suggestions: [] };
        }
      });
    }
  };

  const fetchWorkspaceFiles = async () => {
    if (!sessionId) return;
    try {
      const data = await apiCall(`/api/workspace/files?session_id=${sessionId}`);
      setWorkspaceFiles(data);
      if (data.length > 0 && !selectedWorkspaceFile) setSelectedWorkspaceFile(data[0].name);
      updateMethodsCache();
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
    if (!filename || !sid || filename.startsWith("inspection_code/")) return Promise.resolve();
    const run = async () => {
      try {
        await apiCall(`/api/workspace/files/${filename}?session_id=${sid}`, {
          method: "POST",
          body: JSON.stringify({ content }),
        });
        fetchWorkspaceFiles();
      } catch (e: any) {
        showToast(`Failed to save ${filename}: ${e.message}`, "error");
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
    if (!selectedWorkspaceFile || selectedWorkspaceFile.startsWith("inspection_code/")) return;
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
    if (!confirm(`Are you sure you want to reset ${selectedWorkspaceFile} to its default boilerplate? This will overwrite all your current modifications.`)) {
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
      showToast("File reset to default boilerplate");
    } catch (e: any) {
      showToast(`Failed to reset file: ${e.message}`, "error");
    } finally {
      setIsWorkspaceLoading(false);
    }
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName || !sessionId) return;
    let name = newFileName.trim();
    if (!name.endsWith(".py")) name += ".py";
    try {
      await apiCall(`/api/workspace/files/${name}?session_id=${sessionId}`, {
        method: "POST",
        body: JSON.stringify({ content: "# New workspace module\n" }),
      });
      setShowNewFileModal(false);
      setNewFileName("");
      await fetchWorkspaceFiles();
      setSelectedWorkspaceFile(name);
    } catch (e: any) {
      alert(`Failed to create file: ${e.message}`);
    }
  };

  const handleDeleteFile = async (filename: string) => {
    if (filename === "main.py") { alert("main.py cannot be deleted."); return; }
    if (!confirm(`Are you sure you want to delete ${filename}?`)) return;
    if (!sessionId) return;
    // A pending flush after the DELETE would re-create the file (POST creates)
    if (filename === dirtyFileRef.current) cancelPendingSave();
    try {
      await apiCall(`/api/workspace/files/${filename}?session_id=${sessionId}`, { method: "DELETE" });
      if (selectedWorkspaceFile === filename) setSelectedWorkspaceFile("main.py");
      await fetchWorkspaceFiles();
    } catch (e: any) {
      alert(`Failed to delete file: ${e.message}`);
    }
  };

  const injectImportIntoMain = async (filename: string) => {
    if (!sessionId) return;
    const moduleName = filename.replace(/\.py$/, "");
    const className = toClassName(filename);
    const importLine = `from ${moduleName} import ${className}`;
    try {
      const res = await apiCall(`/api/workspace/files/main.py?session_id=${sessionId}`);
      const lines: string[] = res.content.split("\n");
      if (lines.some((l: string) => l.trim() === importLine)) return; // already imported
      let lastImportIdx = -1;
      lines.forEach((l: string, i: number) => {
        if (/^(import |from )/.test(l)) lastImportIdx = i;
      });
      lines.splice(lastImportIdx + 1, 0, importLine);
      await apiCall(`/api/workspace/files/main.py?session_id=${sessionId}`, {
        method: "POST",
        body: JSON.stringify({ content: lines.join("\n") }),
      });
    } catch (e) {
      console.warn("Failed to auto-import into main.py", e);
    }
  };

  const handleSaveToWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId) { alert("No active session. Start a browser session first."); return; }
    const code = activeGenCodeTab === "pom" ? generatedPomCode : generatedClientCode;
    if (!code) return;
    let name = saveToWorkspaceFilename.trim();
    if (!name.endsWith(".py")) name += ".py";
    try {
      await apiCall(`/api/workspace/files/${name}?session_id=${sessionId}`, {
        method: "POST",
        body: JSON.stringify({ content: code }),
      });
      if (activeGenCodeTab === "pom") await injectImportIntoMain(name);
      await fetchWorkspaceFiles();
      setSelectedWorkspaceFile(name);
      setShowSaveToWorkspaceModal(false);
      setSaveToWorkspaceFilename("");
    } catch (err: any) {
      alert(`Failed to save to workspace: ${err.message}`);
    }
  };

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
    try {
      await apiCall("/api/workspace/stop", { method: "POST" });
    } catch (e: any) {
      alert(`Failed to stop script: ${e.message}`);
    }
  };

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

  const [showNewClassModal, setShowNewClassModal] = useState(false);
  const [newClassName, setNewClassName] = useState("");

  // Page-scan review drawer: per-element checkbox + editable method name
  const [scanSelections, setScanSelections] = useState<Record<number, { checked: boolean; name: string }>>({});
  const [isRecordingScan, setIsRecordingScan] = useState(false);
  const [showScanMenu, setShowScanMenu] = useState(false);
  const [showExploreMenu, setShowExploreMenu] = useState(false);
  const [exploreScope, setExploreScope] = useState<"page" | "selected">("page");
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
        alert(
          `Recorded ${res.count} methods. ${renamed.length} renamed to avoid duplicates:\n` +
          renamed.map((a: any) => `${a.requested} → ${a.recorded}`).join("\n")
        );
      }
      resetPageScan();
      await fetchWorkspaceFiles();
      if (selectedWorkspaceFile === "inspection_code/my_page.py") {
        await fetchFileContent("inspection_code/my_page.py");
      }
    } catch (e: any) {
      alert(e.message || "Failed to record scanned elements.");
    } finally {
      setIsRecordingScan(false);
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
      if (selectedWorkspaceFile === "inspection_code/my_page.py") {
        await fetchFileContent("inspection_code/my_page.py");
      }
    } catch (e: any) {
      alert(e.message || "Failed to record element to POM class.");
    }
  };

  const handleCreateClass = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassName) return;
    if (pomClasses.includes(newClassName)) {
      alert("Class name already exists.");
      return;
    }
    setPomClasses([...pomClasses, newClassName]);
    setPomElements((prev) => ({ ...prev, [newClassName]: [] }));
    setActivePomClass(newClassName);
    setNewClassName("");
    setShowNewClassModal(false);
  };
  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredLogs = networkLogs.filter((log) => {
    const matchesText =
      networkFilter === "" ||
      log.url.toLowerCase().includes(networkFilter.toLowerCase()) ||
      log.method.toLowerCase().includes(networkFilter.toLowerCase());
    const matchesPill =
      networkPillFilter === "all" ||
      (networkPillFilter === "api" && log.url.toLowerCase().includes("api"));
    return matchesText && matchesPill;
  });

  // Save network log to collection helpers
  const logBaseUrl = (url: string) => url.split("?")[0];

  const parseLogQueryParams = (url: string): { key: string; value: string }[] => {
    try {
      return Array.from(new URL(url).searchParams.entries()).map(([key, value]) => ({ key, value }));
    } catch { return []; }
  };

  const suggestRequestName = (url: string): string => {
    try {
      const segments = new URL(url).pathname.split("/").filter(Boolean);
      return segments[segments.length - 1] || "API Request";
    } catch { return "API Request"; }
  };

  const findCollectionDuplicates = (method: string, url: string): { collectionName: string; requestName: string }[] => {
    const base = logBaseUrl(url);
    return collections.flatMap(col =>
      col.requests
        .filter(req => req.method === method && logBaseUrl(req.url) === base)
        .map(req => ({ collectionName: col.name, requestName: req.name }))
    );
  };

  const handleOpenSaveModal = async (log: NetworkLog, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingSaveLog(log);
    setPendingSaveDetails(null);
    setSaveRequestName(suggestRequestName(log.url));
    setSaveCollectionId(collections.length ? collections[0].id : "__new__");
    setNewCollectionName("");
    setSaveDuplicates([]);
    setSaveShowDuplicateWarning(false);
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
    setPythonCopied(false);
    setShowPythonModal(true);
    try {
      const data = await apiCall(`/api/browser/network/${sessionId}/details/${log.id}`);
      setPendingPythonDetails(data);
    } catch { /* non-fatal — generate from basic NetworkLog info */ }
  };

  const buildPythonFromNetworkLog = (log: NetworkLog, details: NetworkDetails | null): string => {
    const extraModels: string[] = [];

    const toClassName = (name: string) =>
      name.replace(/[^a-zA-Z0-9]/g, "_").replace(/^[0-9]/, "_$&")
          .split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");

    const pyType = (v: any, nameHint: string): string => {
      if (v === null) return "Optional[Any]";
      if (typeof v === "boolean") return "bool";
      if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
      if (typeof v === "string") return "str";
      if (Array.isArray(v)) {
        if (v.length > 0 && v[0] !== null && typeof v[0] === "object" && !Array.isArray(v[0])) {
          const modelName = toClassName(nameHint) + "Item";
          extraModels.push(`class ${modelName}(BaseModel):\n${modelFields(v[0], modelName)}`);
          return `List[${modelName}]`;
        }
        return "List[Any]";
      }
      if (typeof v === "object") {
        const modelName = toClassName(nameHint);
        extraModels.push(`class ${modelName}(BaseModel):\n${modelFields(v, modelName)}`);
        return modelName;
      }
      return "Any";
    };

    const modelFields = (obj: Record<string, any>, parentName: string): string =>
      Object.entries(obj)
        .map(([k, v]) => `    ${k}: ${pyType(v, parentName + "_" + k)}`)
        .join("\n") || "    pass";

    const url = details?.request.url ?? log.url;
    const method = (details?.request.method ?? log.method).toLowerCase();
    const headers = details?.request.headers ?? log.headers ?? {};

    const postData = details?.request.postData;
    let requestBodyObj: Record<string, any> | null = null;
    if (postData) {
      try {
        const parsed = JSON.parse(postData);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) requestBodyObj = parsed;
      } catch { /* not JSON — sent as raw body below */ }
    }
    const hasRequestModel = !!requestBodyObj;

    const rawResponseBody = details?.response?.body;
    let responseBodyObj: any = null;
    if (rawResponseBody !== undefined && rawResponseBody !== null) {
      if (typeof rawResponseBody === "string") {
        try { responseBodyObj = JSON.parse(rawResponseBody); } catch { responseBodyObj = null; }
      } else {
        responseBodyObj = rawResponseBody;
      }
    }

    let responseModelName = "";
    let responseModelBlock = "";
    if (responseBodyObj !== null) {
      if (Array.isArray(responseBodyObj) && responseBodyObj.length > 0 &&
          typeof responseBodyObj[0] === "object" && responseBodyObj[0] !== null && !Array.isArray(responseBodyObj[0])) {
        responseModelName = "List[ResponseItem]";
        responseModelBlock = `class ResponseItem(BaseModel):\n${modelFields(responseBodyObj[0], "ResponseItem")}`;
      } else if (typeof responseBodyObj === "object" && !Array.isArray(responseBodyObj)) {
        responseModelName = "ResponseBody";
        responseModelBlock = `class ResponseBody(BaseModel):\n${modelFields(responseBodyObj, "ResponseBody")}`;
      }
    }

    const requestModelBlock = hasRequestModel
      ? `class RequestBody(BaseModel):\n${modelFields(requestBodyObj!, "RequestBody")}`
      : "";

    const lines: string[] = [];
    lines.push("from __future__ import annotations");
    lines.push("import requests");
    lines.push("from pydantic import BaseModel");
    lines.push("from typing import Any, Dict, List, Optional");

    for (const m of extraModels) {
      lines.push("");
      lines.push(m);
    }

    if (requestModelBlock) {
      lines.push("");
      lines.push(requestModelBlock);
    }

    if (responseModelBlock) {
      lines.push("");
      lines.push(responseModelBlock);
    }

    const returnType = responseModelName || "dict";
    lines.push("");
    lines.push("");
    lines.push(`def call_api() -> ${returnType}:`);
    lines.push(`    url = "${url}"`);

    const headerEntries = Object.entries(headers).filter(([k]) => k !== "");
    if (headerEntries.length) {
      lines.push("    headers = {");
      headerEntries.forEach(([k, v]) => {
        lines.push(`        "${k}": "${v}",`);
      });
      lines.push("    }");
    } else {
      lines.push("    headers = {}");
    }

    if (hasRequestModel) {
      const fieldInits = Object.entries(requestBodyObj!).map(([k, v]) => {
        const val = typeof v === "string" ? `"${v}"` : JSON.stringify(v);
        return `        ${k}=${val},`;
      }).join("\n");
      lines.push("    payload = RequestBody(");
      lines.push(fieldInits);
      lines.push("    )");
    }

    const hasBody = !!postData;
    if (hasBody) {
      lines.push(`    response = requests.${method}(`);
      lines.push("        url,");
      lines.push("        headers=headers,");
      if (hasRequestModel) {
        lines.push("        json=payload.model_dump(),");
      } else {
        lines.push(`        data=${JSON.stringify(postData)},`);
      }
      lines.push("    )");
    } else {
      lines.push(`    response = requests.${method}(url, headers=headers)`);
    }

    lines.push("    response.raise_for_status()");
    if (responseModelName === "ResponseBody") {
      lines.push("    return ResponseBody(**response.json())");
    } else if (responseModelName) {
      lines.push("    return response.json()  # List[ResponseItem]");
    } else {
      lines.push("    return response.json()");
    }

    return lines.join("\n");
  };

  const copyPythonToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setPythonCopied(true);
      showToast("Python code copied");
      setTimeout(() => setPythonCopied(false), 1500);
    } catch {
      showToast("Failed to copy", "error");
    }
  };

  const handleConfirmSaveToCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    const isNewCollection = saveCollectionId === "__new__";
    if (!pendingSaveLog || !saveCollectionId || !saveRequestName) return;
    if (isNewCollection && !newCollectionName.trim()) return;

    if (!saveShowDuplicateWarning) {
      const dupes = findCollectionDuplicates(pendingSaveLog.method, pendingSaveLog.url);
      if (dupes.length) {
        setSaveDuplicates(dupes);
        setSaveShowDuplicateWarning(true);
        return;
      }
    }

    const req = pendingSaveDetails?.request;
    const rawHeaders = req?.headers ?? pendingSaveLog.headers;
    const headers = Object.entries(rawHeaders || {}).map(([key, value]) => ({ key, value }));
    const postData = req?.postData || "";
    let bodyType = "NONE";
    let body = "";
    if (postData) {
      try { JSON.parse(postData); bodyType = "JSON"; } catch { bodyType = "TEXT"; }
      body = postData;
    }
    const fullUrl = req?.url ?? pendingSaveLog.url;
    const queryParams = parseLogQueryParams(fullUrl);
    const urlWithoutQuery = logBaseUrl(fullUrl);

    setIsSavingToCollection(true);
    try {
      if (isNewCollection) {
        await handleSaveNetworkRequestToNewCollection(newCollectionName.trim(), saveRequestName, {
          method: pendingSaveLog.method,
          url: urlWithoutQuery,
          headers,
          queryParams,
          bodyType,
          body,
        });
      } else {
        await handleSaveNetworkRequestToCollection(saveCollectionId, saveCollectionId, saveRequestName, {
          method: pendingSaveLog.method,
          url: urlWithoutQuery,
          headers,
          queryParams,
          bodyType,
          body,
        });
      }
      setShowSaveToCollectionModal(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSavingToCollection(false);
    }
  };

  const sectionLabel = "text-[11px] font-semibold uppercase tracking-[0.08em] text-stone flex items-center gap-2";
  const fieldCls = "h-[34px] bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay";
  const iconBtn = "h-6 w-6 rounded-md border border-line flex items-center justify-center hover:bg-panel transition-colors";

  const renderWorkspacePanel = ({ fileListOnRight = false }: { fileListOnRight?: boolean } = {}) => {
    const fileList = (
      <div style={{ width: `${explorerWidth}px` }} className="flex-shrink-0 bg-panel flex flex-col overflow-hidden">
        <div className="px-3 py-2.5 border-b border-line flex items-center justify-between flex-shrink-0">
          <span className={sectionLabel}>
            <Folder className="h-3.5 w-3.5 text-clay" /> Files
          </span>
          <button onClick={() => setShowNewFileModal(true)} className={iconBtn} title="Create Python module">
            <Plus className="h-3 w-3 text-graphite" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {workspaceFiles.map((file) => {
            const active = selectedWorkspaceFile === file.name;
            return (
              <div
                key={file.name}
                className="group flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors hover:bg-cream"
                style={{ background: active ? "var(--color-cream)" : "transparent" }}
              >
                <button
                  onClick={() => setSelectedWorkspaceFile(file.name)}
                  className="flex items-center gap-2 text-left truncate flex-1"
                >
                  <File className={`h-3.5 w-3.5 ${active ? "text-clay" : "text-mute"}`} />
                  <span className={`truncate ${active ? "text-clay font-medium" : "text-graphite"}`}>{file.name}</span>
                </button>
                {file.name !== "main.py" && file.name !== "playground.py" && !file.name.startsWith("inspection_code/") && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteFile(file.name); }}
                    className="opacity-0 group-hover:opacity-100 text-mute hover:text-danger transition"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

    );
    const resizer = (
      <div onMouseDown={handleSidebarDragStart} className="w-1 bg-line hover:bg-clay cursor-col-resize transition-colors flex-shrink-0 self-stretch z-10 select-none" />
    );
    const editor = (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-11 border-b border-line px-4 bg-cream flex items-center justify-between flex-shrink-0">
          <span className="text-xs font-medium text-graphite font-mono flex items-center gap-1.5">
            <FileCode className="h-4 w-4 text-mute" />
            {selectedWorkspaceFile || "No active file"}
          </span>
          <div className="flex items-center gap-2">
            {selectedWorkspaceFile.startsWith("inspection_code/") && (
              <span className="h-[30px] px-3 bg-panel border border-line rounded-md text-xs font-medium text-mute flex items-center gap-1.5 select-none">
                <Lock className="h-3.5 w-3.5" /> Read-only
              </span>
            )}
            {!selectedWorkspaceFile.startsWith("inspection_code/") && (
              <button
                onClick={handleSaveWorkspaceFile}
                disabled={!selectedWorkspaceFile || isWorkspaceLoading}
                className="h-[30px] px-3 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" /> Save
              </button>
            )}
            {(selectedWorkspaceFile === "main.py" || selectedWorkspaceFile.startsWith("inspection_code/")) && (
              <button
                onClick={handleResetWorkspaceFile}
                disabled={!selectedWorkspaceFile || isWorkspaceLoading}
                className="h-[30px] px-3 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors flex items-center gap-1.5 disabled:opacity-50"
                title="Reset file content to default boilerplate"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </button>
            )}
            {isScriptRunning ? (
              <button
                onClick={handleStopScript}
                className="h-[30px] px-3 bg-danger rounded-md text-xs font-medium text-white flex items-center gap-1.5 transition-colors"
              >
                <XCircle className="h-3.5 w-3.5" /> Stop
              </button>
            ) : (
              <button
                onClick={handleRunScript}
                disabled={!selectedWorkspaceFile}
                className="h-[30px] px-3 bg-clay hover:bg-clay-dark rounded-md text-xs font-medium text-white flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" /> Run
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 relative overflow-hidden">
          {isWorkspaceLoading ? (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-mute bg-cream/80">
              Loading module content…
            </div>
          ) : (
            <Editor
              key={selectedWorkspaceFile}
              height="100%"
              language="python"
              theme="vs-dark"
              value={workspaceFileContent}
              onChange={handleEditorChange}
              onMount={handleEditorDidMount}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: "on",
                automaticLayout: true,
                readOnly: selectedWorkspaceFile.startsWith("inspection_code/"),
              }}
            />
          )}
        </div>

        <div className={`border-t border-line flex flex-col flex-shrink-0 transition-all duration-300 ${isConsoleMinimized ? "h-9" : "h-44"}`}>
          <div className="h-9 px-4 border-b border-line flex items-center justify-between bg-cream flex-shrink-0">
            <button
              onClick={() => setIsConsoleMinimized(!isConsoleMinimized)}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <Terminal className="h-3.5 w-3.5 text-mute" />
              <span className={sectionLabel}>Execution console</span>
              {isConsoleMinimized ? <ChevronUp className="h-3.5 w-3.5 text-mute" /> : <ChevronDown className="h-3.5 w-3.5 text-mute" />}
            </button>
            {!isConsoleMinimized && (
              <button onClick={() => setWorkspaceLogs("")} className="text-[11px] text-mute hover:text-graphite">
                Clear
              </button>
            )}
          </div>
          {!isConsoleMinimized && (
            <pre className="flex-1 m-0 p-3 bg-ink-900 font-mono text-[11px] text-sage overflow-y-auto whitespace-pre-wrap select-text">
              {workspaceLogs || "Console output is empty. Run main.py or another script to execute."}
            </pre>
          )}
        </div>
      </div>
    );

    return (
      <div className="h-full w-full flex overflow-hidden bg-cream">
        {fileListOnRight ? <>{editor}{resizer}{fileList}</> : <>{fileList}{resizer}{editor}</>}
      </div>
    );
  };

  const renderNetworkPanel = () => {
    return (
      <div className="w-full h-full flex overflow-hidden bg-cream font-sans">
        {/* Left pane: Requests list */}
        <div className="w-1/2 h-full border-r border-line flex flex-col overflow-hidden bg-panel">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between flex-shrink-0">
            <span className={sectionLabel}>
              <Activity className="h-3.5 w-3.5 text-stone" /> Network requests
            </span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-danger animate-pulse" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-danger">Recording</span>
              </div>
              <button
                onClick={handleClearNetworkLogs}
                title="Clear network log"
                className="h-[22px] px-2 rounded-md border border-line text-[10px] font-medium text-mute hover:text-ink hover:border-clay transition-colors flex items-center gap-1"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            </div>
          </div>
          <div className="px-3 pt-2.5 pb-0 flex gap-1.5 flex-shrink-0">
            {(["all", "api"] as const).map((pill) => (
              <button
                key={pill}
                onClick={() => setNetworkPillFilter(pill)}
                className={`h-[22px] px-2.5 rounded-full text-[10px] font-semibold transition-colors ${
                  networkPillFilter === pill
                    ? "bg-clay text-white"
                    : "bg-line text-mute hover:text-ink"
                }`}
              >
                {pill === "all" ? "Show all" : "API"}
              </button>
            ))}
          </div>
          <div className="p-3 pb-3 pt-2 border-b border-line flex-shrink-0">
            <input
              type="text"
              placeholder="Filter by URL or method…"
              value={networkFilter}
              onChange={(e) => setNetworkFilter(e.target.value)}
              className="w-full h-[32px] bg-cream border border-line rounded-lg px-3 text-xs text-graphite outline-none focus:border-clay transition-colors"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
            {filteredLogs.map((log) => {
              const isActive = logDetails?.request.url === log.url && logDetails?.request.method === log.method;
              return (
                <div
                  key={log.id}
                  onClick={() => handleLogClick(log.id)}
                  className={`flex flex-col gap-1.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                    isActive ? "bg-cream border-clay" : "bg-cream/40 border-line hover:bg-cream"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={methodStyle(log.method)}>
                      {log.method}
                    </span>
                    <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={statusStyle(log.status)}>
                      {log.status === null ? "Pending" : log.status}
                    </span>
                    <span className="font-mono text-[11px] text-graphite flex-1 truncate">{log.url}</span>
                    <button
                      onClick={(e) => handleOpenPythonModal(log, e)}
                      title="Show Python client code"
                      className="h-5 w-5 rounded flex items-center justify-center text-stone hover:text-clay hover:bg-line transition-colors flex-shrink-0"
                    >
                      <Code2 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => handleOpenSaveModal(log, e)}
                      title="Save to API Explorer collection"
                      className="h-5 w-5 rounded flex items-center justify-center text-stone hover:text-clay hover:bg-line transition-colors flex-shrink-0"
                    >
                      <Save className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
            {filteredLogs.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center text-mute py-12 gap-2">
                <Activity className="h-8 w-8 text-mute/50" />
                <p className="text-xs">No network activity captured yet.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right pane: Selected Request details */}
        <div className="w-1/2 h-full flex flex-col overflow-hidden bg-cream">
          {logDetails ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between flex-shrink-0 bg-panel">
                <span className="text-xs font-semibold text-graphite font-mono truncate max-w-[80%]">
                  {logDetails.request.method} {logDetails.request.url}
                </span>
                <button
                  onClick={() => setLogDetails(null)}
                  className="h-6 w-6 rounded-md hover:bg-line flex items-center justify-center transition-colors"
                >
                  <X className="h-4 w-4 text-mute hover:text-graphite" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 font-mono text-[11px] leading-normal select-text">
                <Field label="Request URL">
                  <span className="text-graphite break-all">{logDetails.request.url}</span>
                </Field>
                <div className="flex gap-4">
                  <Field label="Method" className="w-1/2">
                    <span className="text-clay font-semibold">{logDetails.request.method}</span>
                  </Field>
                  <Field label="Status" className="w-1/2">
                    <span className="font-semibold" style={{ color: (logDetails.response?.status ?? 0) < 400 ? "var(--color-clay)" : "var(--color-danger)" }}>
                      {logDetails.response ? `${logDetails.response.status} ${logDetails.response.statusText}` : "Pending"}
                    </span>
                  </Field>
                </div>
                
                {logDetails.request.postData && (
                  <Field label="Request Payload">
                    <pre className="mt-1 p-2 bg-panel rounded border border-line overflow-auto max-h-40 whitespace-pre-wrap font-mono text-[10px]">
                      {(() => {
                        try {
                          return JSON.stringify(JSON.parse(logDetails.request.postData), null, 2);
                        } catch {
                          return logDetails.request.postData;
                        }
                      })()}
                    </pre>
                  </Field>
                )}
                
                {logDetails.response?.body && (
                  <Field label="Response Payload">
                    <pre className="mt-1 p-2 bg-panel rounded border border-line overflow-auto max-h-64 whitespace-pre-wrap font-mono text-[10px]">
                      {(() => {
                        try {
                          return JSON.stringify(JSON.parse(logDetails.response.body), null, 2);
                        } catch {
                          return logDetails.response.body;
                        }
                      })()}
                    </pre>
                  </Field>
                )}

                <Field label="Request Headers">
                  <div className="mt-1 p-2 bg-panel rounded border border-line flex flex-col gap-1 overflow-auto max-h-40 text-[10px] font-mono">
                    {Object.entries(logDetails.request.headers || {}).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <span className="text-mute flex-shrink-0 font-semibold">{k}:</span>
                        <span className="text-graphite break-all">{v as string}</span>
                      </div>
                    ))}
                  </div>
                </Field>

                {logDetails.response?.headers && (
                  <Field label="Response Headers">
                    <div className="mt-1 p-2 bg-panel rounded border border-line flex flex-col gap-1 overflow-auto max-h-40 text-[10px] font-mono">
                      {Object.entries(logDetails.response.headers || {}).map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <span className="text-mute flex-shrink-0 font-semibold">{k}:</span>
                          <span className="text-graphite break-all">{v as string}</span>
                        </div>
                      ))}
                    </div>
                  </Field>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-mute gap-2">
              <Activity className="h-8 w-8 text-mute/30" />
              <p className="text-xs">Select a request to inspect details.</p>
            </div>
          )}
        </div>
      </div>
    );
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
              disabled={isVerifying || isExploring}
              title={isVerifying ? "Inspect is disabled while verification is running" : isExploring ? "Inspect is disabled while exploration is running" : undefined}
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
            <div className="relative" ref={scanMenuRef}>
              <button
                onClick={() => setShowScanMenu((v) => !v)}
                disabled={pageScanStatus === "scanning" || isVerifying || isExploring}
                title={isVerifying ? "Scan is disabled while verification is running" : isExploring ? "Scan is disabled while exploration is running" : "Detect interactive elements and propose POM methods"}
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
                  disabled={isVerifying}
                  title="Let AI autonomously click/fill around the page to discover interactive elements"
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
                <><Play className="h-3.5 w-3.5" /> New session</>
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
                <div className="w-full h-full flex flex-col">
                  {isBrowserConnected && browserTabs.length > 1 && (
                    <div className="flex items-center gap-0.5 px-2 py-1 bg-ink-900 border-b border-white/10 overflow-x-auto flex-shrink-0">
                      {browserTabs.map((tab, i) => (
                        <div
                          key={tab.index}
                          onClick={() => handleSwitchTab(i)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] cursor-pointer whitespace-nowrap max-w-[180px] select-none transition-colors ${
                            activeTabIndex === i ? "bg-cream/15 text-cream" : "text-cream/40 hover:bg-cream/10 hover:text-cream/70"
                          }`}
                        >
                          <Globe className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">
                            {tab.url ? (() => { try { return new URL(tab.url).hostname || "New tab"; } catch { return "New tab"; } })() : "New tab"}
                          </span>
                          {i > 0 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCloseTab(i); }}
                              className="ml-0.5 text-cream/30 hover:text-danger transition-colors"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="relative flex-1 w-full overflow-hidden">
                    {isBrowserConnected ? (
                      <div 
                        ref={previewContainerRef}
                        className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden focus:outline-none"
                        tabIndex={0}
                        onKeyDown={handlePreviewKeyDown}
                        onWheel={handlePreviewWheel}
                        onMouseDown={(e) => handlePreviewMouseEvent(e, "down")}
                        onMouseUp={(e) => handlePreviewMouseEvent(e, "up")}
                        onMouseMove={(e) => handlePreviewMouseEvent(e, "move")}
                        onClick={(e) => handlePreviewMouseEvent(e, "click")}
                      >
                        {latestFrame ? (
                          <img 
                            src={`data:image/jpeg;base64,${latestFrame}`} 
                            alt="Browser Screencast" 
                            className="w-full h-full object-contain pointer-events-none select-none"
                            draggable={false}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-cream/40 text-xs gap-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
                            Session started. Streaming native browser window...
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-cream/40 text-xs">
                        Select a profile and click Connect browser to start a session.
                      </div>
                    )}
                    {(isDraggingSplit || isDraggingSidebar) && (
                      <div className="absolute inset-0 z-10" />
                    )}
                  </div>
                </div>
              )}

              {viewMode === "workspace" && <div className="w-full h-full flex flex-col overflow-hidden">{renderWorkspacePanel()}</div>}

              {viewMode === "split" && (
                <div className="w-full h-full flex flex-row overflow-hidden">
                  <div style={{ width: `${100 - workspaceSplitPercent}%` }} className="h-full bg-ink-950 flex flex-col overflow-hidden flex-shrink-0">
                    {isBrowserConnected && browserTabs.length > 1 && (
                      <div className="flex items-center gap-0.5 px-2 py-1 bg-ink-900 border-b border-white/10 overflow-x-auto flex-shrink-0">
                        {browserTabs.map((tab, i) => (
                          <div
                            key={tab.index}
                            onClick={() => handleSwitchTab(i)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] cursor-pointer whitespace-nowrap max-w-[180px] select-none transition-colors ${
                              activeTabIndex === i ? "bg-cream/15 text-cream" : "text-cream/40 hover:bg-cream/10 hover:text-cream/70"
                            }`}
                          >
                            <Globe className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">
                              {tab.url ? (() => { try { return new URL(tab.url).hostname || "New tab"; } catch { return "New tab"; } })() : "New tab"}
                            </span>
                            {i > 0 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCloseTab(i); }}
                                className="ml-0.5 text-cream/30 hover:text-danger transition-colors"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="relative flex-1 w-full overflow-hidden">
                      {isBrowserConnected ? (
                        <div 
                          ref={previewContainerRef}
                          className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden focus:outline-none"
                          tabIndex={0}
                          onKeyDown={handlePreviewKeyDown}
                          onWheel={handlePreviewWheel}
                          onMouseDown={(e) => handlePreviewMouseEvent(e, "down")}
                          onMouseUp={(e) => handlePreviewMouseEvent(e, "up")}
                          onMouseMove={(e) => handlePreviewMouseEvent(e, "move")}
                          onClick={(e) => handlePreviewMouseEvent(e, "click")}
                        >
                          {latestFrame ? (
                            <img 
                              src={`data:image/jpeg;base64,${latestFrame}`} 
                              alt="Browser Screencast" 
                              className="w-full h-full object-contain pointer-events-none select-none"
                              draggable={false}
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center text-cream/40 text-xs gap-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
                              Session started. Streaming native browser window...
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-cream/40 text-xs">
                          Select a profile and click Connect browser to start a session.
                        </div>
                      )}
                      {(isDraggingSplit || isDraggingSidebar) && (
                        <div className="absolute inset-0 z-10" />
                      )}
                    </div>
                  </div>
                  <div onMouseDown={handleSplitDragStart} className="w-1 bg-line hover:bg-clay cursor-col-resize transition-colors flex-shrink-0 h-full z-10 select-none" />
                  <div style={{ width: `${workspaceSplitPercent}%` }} className="h-full flex flex-col overflow-hidden flex-shrink-0">
                    {renderWorkspacePanel({ fileListOnRight: true })}
                  </div>
                </div>
              )}

              {viewMode === "network" && (
                <div className="w-full h-full flex flex-col overflow-hidden bg-cream">
                  {renderNetworkPanel()}
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
              {selectedElement && (
                <div className="absolute bottom-4 right-4 z-40 w-80 bg-cream border border-line rounded-xl shadow-[0_12px_24px_rgba(20,20,19,0.15)] flex flex-col overflow-hidden">
                  <div className="px-4 py-3 border-b border-line flex items-center justify-between bg-panel">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink flex items-center gap-2">
                      <Crosshair className="h-4 w-4 text-clay animate-pulse" /> Inspect Element
                    </span>
                    <button
                      onClick={() => { setSelectedElement(null); setSelectedElementLocators([]); setSelectedElementStale({ stale: false, reason: null }); }}
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
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
          <Globe className="h-12 w-12 text-mute" />
          <div className="text-lg font-medium text-graphite">Browser session inactive</div>
          <div className="text-[13px] text-mute text-center max-w-[360px] leading-relaxed">
            Select a browser profile and click Connect VNC browser to start a live session. You can then
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
              <><Play className="h-4 w-4" /> Connect VNC browser</>
            )}
          </button>
        </div>
      )}

      {/* Save network log to collection modal */}
      {showSaveToCollectionModal && pendingSaveLog && (
        <ModalShell
          title="Save to collection"
          onClose={() => setShowSaveToCollectionModal(false)}
          width={460}
        >
          <form onSubmit={handleConfirmSaveToCollection} className="flex flex-col gap-5">
            {saveShowDuplicateWarning && saveDuplicates.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-amber-800">Duplicate request detected</span>
                <ul className="text-[12px] text-amber-700 list-disc pl-4">
                  {saveDuplicates.map((d, i) => (
                    <li key={i}>
                      <span className="font-mono">{d.requestName}</span>{" "}
                      in <span className="font-medium">{d.collectionName}</span>
                    </li>
                  ))}
                </ul>
                <span className="text-[12px] text-amber-700 mt-0.5">Submit again to save anyway.</span>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Collection</label>
              {saveCollectionId === "__new__" ? (
                <>
                  <input
                    type="text"
                    placeholder="e.g. Authentication Suite"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    autoFocus
                    required
                    className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
                  />
                  {collections.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setSaveCollectionId(collections[0].id); setNewCollectionName(""); }}
                      className="self-start text-[12px] text-clay hover:underline"
                    >
                      ← Choose existing collection
                    </button>
                  )}
                </>
              ) : (
                <select
                  value={saveCollectionId}
                  onChange={(e) => setSaveCollectionId(e.target.value)}
                  required
                  className="h-10 bg-cream border border-line rounded-lg px-3 text-sm text-ink outline-none focus:border-clay"
                >
                  {collections.map(col => (
                    <option key={col.id} value={col.id}>{col.name}</option>
                  ))}
                  <option value="__new__">+ Create new collection…</option>
                </select>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Request name</label>
              <input
                type="text"
                value={saveRequestName}
                onChange={(e) => setSaveRequestName(e.target.value)}
                autoFocus={saveCollectionId !== "__new__"}
                required
                className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
              />
            </div>

            <div className="flex items-center gap-2 px-3 py-2 bg-panel rounded-lg border border-line">
              <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={methodStyle(pendingSaveLog.method)}>
                {pendingSaveLog.method}
              </span>
              <span className="font-mono text-[11px] text-graphite truncate">{logBaseUrl(pendingSaveLog.url)}</span>
            </div>

            <FooterButtons
              onCancel={() => setShowSaveToCollectionModal(false)}
              submitLabel={isSavingToCollection ? "Saving…" : saveShowDuplicateWarning ? "Save anyway" : "Save"}
            />
          </form>
        </ModalShell>
      )}

      {showPythonModal && pendingPythonLog && (() => {
        const code = buildPythonFromNetworkLog(pendingPythonLog, pendingPythonDetails);
        return (
          <ModalShell title="Python client" onClose={() => { setShowPythonModal(false); setPythonCopied(false); }} width={680}>
            <div className="flex flex-col gap-4">
              <p className="text-[13px] text-stone leading-relaxed">
                Generated from the captured request and response. Uses{" "}
                <code className="font-mono text-[12px] bg-panel px-1 py-0.5 rounded">requests</code> and{" "}
                <code className="font-mono text-[12px] bg-panel px-1 py-0.5 rounded">pydantic</code>.
              </p>
              <div className="relative">
                <pre className="m-0 p-4 bg-ink-900 text-sage font-mono text-xs leading-relaxed overflow-auto whitespace-pre rounded-xl max-h-[420px]">
                  {code}
                </pre>
                <button
                  onClick={() => copyPythonToClipboard(code)}
                  title="Copy code"
                  className="absolute top-3 right-3 h-7 px-2.5 flex items-center gap-1.5 bg-ink-800/80 border border-white/10 rounded-md text-xs font-medium text-cream/70 hover:text-cream hover:bg-ink-700 transition-colors"
                >
                  {pythonCopied ? <Check className="h-3.5 w-3.5 text-sage" /> : <Copy className="h-3.5 w-3.5" />}
                  {pythonCopied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="flex justify-end pt-1 border-t border-line">
                <button
                  onClick={() => { setShowPythonModal(false); setPythonCopied(false); }}
                  className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </ModalShell>
        );
      })()}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 bg-ink-900 text-cream px-4 py-3 rounded-lg border-l-4 ${
            toast.variant === "error" ? "border-red-500" : "border-sage"
          } text-[13px] shadow-[0_4px_16px_rgba(20,20,19,0.24)] max-w-[360px]`}
          style={{ animation: "fadeUp 0.2s ease-out" }}
        >
          {toast.variant === "error" ? (
            <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-sage flex-shrink-0" />
          )}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* New class modal */}
      {showNewClassModal && (
        <ModalShell title="Create page class" onClose={() => { setShowNewClassModal(false); setNewClassName(""); }} width={420}>
          <form onSubmit={handleCreateClass} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Class name</label>
              <input
                type="text"
                placeholder="e.g. LoginPage"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                autoFocus
                required
                className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
              />
            </div>
            <FooterButtons onCancel={() => { setShowNewClassModal(false); setNewClassName(""); }} submitLabel="Create" />
          </form>
        </ModalShell>
      )}

      {/* New file modal */}
      {showNewFileModal && (
        <ModalShell title="Create Python module" onClose={() => { setShowNewFileModal(false); setNewFileName(""); }} width={420}>
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
            <FooterButtons onCancel={() => { setShowNewFileModal(false); setNewFileName(""); }} submitLabel="Create" />
          </form>
        </ModalShell>
      )}

      {/* Save to workspace modal */}
      {showSaveToWorkspaceModal && (
        <ModalShell title="Save to workspace" onClose={() => { setShowSaveToWorkspaceModal(false); setSaveToWorkspaceFilename(""); }} width={420}>
          <form onSubmit={handleSaveToWorkspace} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">File name <span className="text-mute font-normal">(snake_case, .py)</span></label>
              <input
                type="text"
                placeholder="e.g. order_page.py"
                value={saveToWorkspaceFilename}
                onChange={(e) => setSaveToWorkspaceFilename(e.target.value)}
                autoFocus
                required
                className="h-10 bg-cream border border-line rounded-lg px-3.5 font-mono text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
              />
            </div>
            {saveToWorkspaceFilename && activeGenCodeTab === "pom" && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-mute uppercase tracking-[0.08em]">Class name preview</span>
                <span className="font-mono text-sm text-clay">{toClassName(saveToWorkspaceFilename)}</span>
              </div>
            )}
            <FooterButtons onCancel={() => { setShowSaveToWorkspaceModal(false); setSaveToWorkspaceFilename(""); }} submitLabel="Save" />
          </form>
        </ModalShell>
      )}



      {/* Resource Limit Exceeded Modal */}
      {limitExceededModalOpen && (
        <ModalShell 
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
        </ModalShell>
      )}
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-mute mb-1.5">{label}</h4>
      <div className="bg-panel p-2.5 rounded-lg border border-line">{children}</div>
    </div>
  );
}

function ModalShell({ title, onClose, children, width = 480 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(20,20,19,0.5)", backdropFilter: "blur(2px)" }}>
      <div className="bg-cream rounded-2xl p-8 shadow-[0_24px_48px_-12px_rgba(20,20,19,0.18)] flex flex-col gap-5" style={{ width }}>
        <div className="flex items-center justify-between">
          <h2 className="m-0 font-serif text-xl font-medium text-ink">{title}</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-lg border border-line flex items-center justify-center hover:bg-panel transition-colors">
            <X className="h-4 w-4 text-graphite" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FooterButtons({ onCancel, submitLabel }: { onCancel: () => void; submitLabel: string }) {
  return (
    <div className="flex justify-end gap-2 pt-1 border-t border-line">
      <button type="button" onClick={onCancel} className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors">
        Cancel
      </button>
      <button type="submit" className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors">
        {submitLabel}
      </button>
    </div>
  );
}
