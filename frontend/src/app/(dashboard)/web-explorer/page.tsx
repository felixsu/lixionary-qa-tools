"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Globe, Terminal, Eye, Crosshair, Download, Trash2, Plus, FileCode, Play,
  Save, File, Folder, XCircle, Rows, Lock, X, Layers, Code2, Clipboard, Activity,
  ChevronDown,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { useAppContext } from "../../context/AppContext";
import Dropdown from "../../components/Dropdown";

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
    sessionId,
    networkLogs,
    networkFilter,
    setNetworkFilter,
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
    selectedElementAction,
    setSelectedElementAction,
    selectedElementMethodName,
    setSelectedElementMethodName,
    activeGenCodeTab,
    setActiveGenCodeTab,
    generatedPomCode,
    setGeneratedPomCode,
    generatedClientCode,
    setGeneratedClientCode,
    selectedLogsForClient,
    setSelectedLogsForClient,
    clientBaseUrl,

    profiles,
    selectedProfileId,
    setSelectedProfileId,
    authFunctions,
    token,
    apiCall,
    handleBrowserNavigate,
    handleToggleInspect,
    handlePasteText,
    handleStartBrowser,
    handleDisconnectBrowser,
    handleLogClick,
    handleSaveProfile,
    handleDeleteProfile,
    userSessions,
    fetchUserSessions,
    handleCloseSession,
    handleReconnectSession,
    browserTabs,
    activeTabIndex,
    handleSwitchTab,
    handleCloseTab,
  } = useAppContext();

  const [workspaceFiles, setWorkspaceFiles] = useState<{ name: string; size: number; updatedAt: string }[]>([]);
  const [viewMode, setViewMode] = useState<"browser" | "split" | "workspace">("split");
  const [explorerWidth, setExplorerWidth] = useState<number>(220);
  const [workspaceSplitPercent, setWorkspaceSplitPercent] = useState<number>(50);
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

  const toClassName = (snake: string) =>
    snake.replace(/\.py$/, "").split("_").filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");

  const handleSplitDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startPercent = workspaceSplitPercent;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const deltaPercent = ((moveEvent.clientY - startY) / rect.height) * 100;
      setWorkspaceSplitPercent(Math.min(Math.max(startPercent + deltaPercent, 20), 80));
    };
    const handleMouseUp = () => {
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
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.min(Math.max(startWidth + (moveEvent.clientX - startX), 140), 400);
      setExplorerWidth(newWidth);
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const fetchWorkspaceFiles = async () => {
    if (!sessionId) return;
    try {
      const data = await apiCall(`/api/workspace/files?session_id=${sessionId}`);
      setWorkspaceFiles(data);
      if (data.length > 0 && !selectedWorkspaceFile) setSelectedWorkspaceFile(data[0].name);
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

  const handleSaveWorkspaceFile = async () => {
    if (!selectedWorkspaceFile || !sessionId) return;
    try {
      await apiCall(`/api/workspace/files/${selectedWorkspaceFile}?session_id=${sessionId}`, {
        method: "POST",
        body: JSON.stringify({ content: workspaceFileContent }),
      });
      fetchWorkspaceFiles();
    } catch (e: any) {
      alert(`Failed to save file: ${e.message}`);
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
    setIsScriptRunning(true);
    setWorkspaceLogs("");
    try {
      await apiCall(`/api/workspace/files/${selectedWorkspaceFile}?session_id=${sessionId}`, {
        method: "POST",
        body: JSON.stringify({ content: workspaceFileContent }),
      });
    } catch (e) {
      console.warn("Failed to auto-save file before running", e);
    }
    try {
      const response = await fetch(`/api/workspace/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename: selectedWorkspaceFile, session_id: sessionId }),
      });
      if (!response.body) throw new Error("No response body available");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        setWorkspaceLogs((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (err: any) {
      setWorkspaceLogs((prev) => prev + `\nExecution Error: ${err.message}\n`);
    } finally {
      setIsScriptRunning(false);
    }
  };

  const handleStopScript = async () => {
    try {
      await apiCall("/api/workspace/stop", { method: "POST" });
    } catch (e: any) {
      alert(`Failed to stop script: ${e.message}`);
    }
  };

  useEffect(() => {
    if (sessionId) {
      fetchWorkspaceFiles();
      setSelectedWorkspaceFile("");
      setWorkspaceFileContent("");
    }
  }, [sessionId]);

  useEffect(() => {
    if (selectedWorkspaceFile) fetchFileContent(selectedWorkspaceFile);
  }, [selectedWorkspaceFile]);

  // Profile manager modal states
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileCookies, setProfileCookies] = useState("");
  const [profileLocalStorage, setProfileLocalStorage] = useState("");
  const [profileAuthFunctionId, setProfileAuthFunctionId] = useState<string>("");
  const [profileAuthInjectionType, setProfileAuthInjectionType] = useState<"cookie" | "localStorage">("cookie");
  const [profileAuthInjectionKey, setProfileAuthInjectionKey] = useState("");
  const [profileAuthInjectionDomainOrOrigin, setProfileAuthInjectionDomainOrOrigin] = useState("");
  const [showNewClassModal, setShowNewClassModal] = useState(false);
  const [newClassName, setNewClassName] = useState("");

  useEffect(() => {
    if (isBrowserConnected && sessionId) generatePOM();
  }, [pomElements, activePomClass, isBrowserConnected, sessionId]);

  useEffect(() => {
    if (isBrowserConnected && sessionId && selectedLogsForClient.length) generateHttpClient();
    else setGeneratedClientCode("");
  }, [selectedLogsForClient, clientBaseUrl, isBrowserConnected, sessionId]);

  const generatePOM = async () => {
    const classElements = pomElements[activePomClass] || [];
    try {
      const res = await apiCall("/api/browser/pom/generate", {
        method: "POST",
        body: JSON.stringify({ className: activePomClass, url: browserUrl, elements: classElements }),
      });
      setGeneratedPomCode(res.code);
    } catch (e) {
      console.error(e);
    }
  };

  const generateHttpClient = async () => {
    try {
      const res = await apiCall("/api/browser/client/generate", {
        method: "POST",
        body: JSON.stringify({ baseUrl: clientBaseUrl, logIds: selectedLogsForClient, sessionId }),
      });
      setGeneratedClientCode(res.code);
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddElementToPOM = () => {
    if (!selectedElement) return;
    const strategy = selectedElementLocators[0]?.strategy || "locator (CSS)";
    const selector = selectedElementLocators[0]?.selector || selectedElement.cssSelector;
    const newEl = {
      element_id: `el_${Math.random().toString(36).substring(2, 9)}`,
      method_name: selectedElementMethodName || `click_${selectedElement.tagName}`,
      strategy,
      selector,
      action: selectedElementAction,
      frameLocators: selectedElement.frameLocators || [],
    };
    setPomElements((prev) => {
      const currentClassEls = prev[activePomClass] || [];
      if (currentClassEls.some((el) => el.method_name === newEl.method_name)) {
        alert("Method name already exists in this Page Class.");
        return prev;
      }
      return { ...prev, [activePomClass]: [...currentClassEls, newEl] };
    });
    setSelectedElement(null);
    setSelectedElementLocators([]);
    setSelectedElementMethodName("");
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

  const handleSaveProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName) return;
    if (profileCookies) {
      try { JSON.parse(profileCookies); } catch { alert("Cookies must be a valid JSON array or empty."); return; }
    }
    if (profileLocalStorage) {
      try { JSON.parse(profileLocalStorage); } catch { alert("LocalStorage must be a valid JSON object or empty."); return; }
    }
    try {
      const authInjectionVal = profileAuthFunctionId
        ? { type: profileAuthInjectionType, key: profileAuthInjectionKey, domainOrOrigin: profileAuthInjectionDomainOrOrigin }
        : null;
      await handleSaveProfile(profileName, profileCookies, profileLocalStorage, profileAuthFunctionId || null, authInjectionVal, editingProfileId);
      handleClearProfileForm();
      alert("Browser profile saved successfully!");
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleOpenEditProfile = (profile: any) => {
    setEditingProfileId(profile.id);
    setProfileName(profile.name);
    setProfileCookies(profile.cookies || "");
    setProfileLocalStorage(profile.localStorage || "");
    setProfileAuthFunctionId(profile.authFunctionId || "");
    if (profile.authInjection) {
      setProfileAuthInjectionType(profile.authInjection.type || "cookie");
      setProfileAuthInjectionKey(profile.authInjection.key || "");
      setProfileAuthInjectionDomainOrOrigin(profile.authInjection.domainOrOrigin || "");
    } else {
      setProfileAuthInjectionType("cookie");
      setProfileAuthInjectionKey("");
      setProfileAuthInjectionDomainOrOrigin("");
    }
  };

  const handleClearProfileForm = () => {
    setEditingProfileId(null);
    setProfileName("");
    setProfileCookies("");
    setProfileLocalStorage("");
    setProfileAuthFunctionId("");
    setProfileAuthInjectionType("cookie");
    setProfileAuthInjectionKey("");
    setProfileAuthInjectionDomainOrOrigin("");
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

  const filteredLogs = networkLogs.filter(
    (log) =>
      log.url.toLowerCase().includes(networkFilter.toLowerCase()) ||
      log.method.toLowerCase().includes(networkFilter.toLowerCase())
  );

  const sectionLabel = "text-[11px] font-semibold uppercase tracking-[0.08em] text-stone flex items-center gap-2";
  const fieldCls = "h-[34px] bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay";
  const iconBtn = "h-6 w-6 rounded-md border border-line flex items-center justify-center hover:bg-panel transition-colors";

  const renderWorkspacePanel = () => (
    <div className="h-full w-full flex overflow-hidden bg-cream">
      {/* File list */}
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
                {file.name !== "main.py" && (
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

      <div onMouseDown={handleSidebarDragStart} className="w-1 bg-line hover:bg-clay cursor-col-resize transition-colors flex-shrink-0 self-stretch z-10 select-none" />

      {/* Editor + console */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-11 border-b border-line px-4 bg-cream flex items-center justify-between flex-shrink-0">
          <span className="text-xs font-medium text-graphite font-mono flex items-center gap-1.5">
            <FileCode className="h-4 w-4 text-mute" />
            {selectedWorkspaceFile || "No active file"}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveWorkspaceFile}
              disabled={!selectedWorkspaceFile || isWorkspaceLoading}
              className="h-[30px] px-3 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" /> Save
            </button>
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
              onChange={(val) => setWorkspaceFileContent(val || "")}
              options={{ minimap: { enabled: false }, fontSize: 12, lineNumbers: "on", automaticLayout: true }}
            />
          )}
        </div>

        <div className="h-44 border-t border-line flex flex-col flex-shrink-0">
          <div className="h-9 px-4 border-b border-line flex items-center justify-between bg-cream flex-shrink-0">
            <span className={sectionLabel}>
              <Terminal className="h-3.5 w-3.5 text-mute" /> Execution console
            </span>
            <button onClick={() => setWorkspaceLogs("")} className="text-[11px] text-mute hover:text-graphite">
              Clear
            </button>
          </div>
          <pre className="flex-1 m-0 p-3 bg-ink-900 font-mono text-[11px] text-sage overflow-y-auto whitespace-pre-wrap select-text">
            {workspaceLogs || "Console output is empty. Run main.py or another script to execute."}
          </pre>
        </div>
      </div>
    </div>
  );

  const viewModes: { id: "browser" | "split" | "workspace"; label: string; icon: any }[] = [
    { id: "browser", label: "Browser", icon: Eye },
    { id: "split", label: "Split", icon: Rows },
    { id: "workspace", label: "Workspace", icon: FileCode },
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
            placeholder="https://example.com"
            disabled={!isBrowserConnected}
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
              className="h-[34px] px-3.5 rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors border"
              style={
                inspectMode
                  ? { background: "rgba(204,120,92,0.12)", borderColor: "rgba(204,120,92,0.4)", color: "#cc785c" }
                  : { background: "transparent", borderColor: "var(--color-line)", color: "var(--color-graphite)" }
              }
            >
              <Crosshair className="h-3.5 w-3.5" />
              {inspectMode ? "Inspecting" : "Inspect"}
            </button>
            {/* Sessions dropdown */}
            <div className="relative">
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
                          onClick={() => handleCloseSession(s.session_id)}
                          className="text-mute hover:text-danger transition-colors"
                          title="Close session"
                        >
                          <X className="h-3.5 w-3.5" />
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
            <button
              onClick={() => setShowProfileModal(true)}
              className="h-[34px] px-3 bg-cream border border-line rounded-lg text-[13px] text-graphite hover:bg-panel transition-colors"
            >
              Manage profiles
            </button>
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
              onClick={() => handleStartBrowser(selectedProfileId)}
              className="h-[34px] px-4 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white flex items-center gap-1.5 transition-colors"
            >
              <Play className="h-3.5 w-3.5" /> New session
            </button>
          </>
        )}
      </div>

      {/* Body */}
      {isBrowserConnected ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Left: browser / workspace */}
          <div className="w-2/3 h-full flex flex-col overflow-hidden border-r border-line bg-ink-950">
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
                  {vncUrl ? (
                    <iframe src={vncUrl} className="w-full flex-1 border-none" title="VNC Browser Frame" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-cream/40 text-xs">
                      VNC session initialized. Loading canvas…
                    </div>
                  )}
                </div>
              )}

              {viewMode === "workspace" && <div className="w-full h-full flex flex-col overflow-hidden">{renderWorkspacePanel()}</div>}

              {viewMode === "split" && (
                <div className="w-full h-full flex flex-col overflow-hidden">
                  <div style={{ height: `${workspaceSplitPercent}%` }} className="w-full flex flex-col overflow-hidden flex-shrink-0">
                    {renderWorkspacePanel()}
                  </div>
                  <div onMouseDown={handleSplitDragStart} className="h-1 bg-line hover:bg-clay cursor-row-resize transition-colors flex-shrink-0 w-full z-10 select-none" />
                  <div style={{ height: `${100 - workspaceSplitPercent}%` }} className="w-full bg-ink-950 flex flex-col overflow-hidden flex-shrink-0">
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
                    {vncUrl ? (
                      <iframe src={vncUrl} className="w-full flex-1 border-none" title="VNC Browser Frame" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-cream/40 text-xs">
                        VNC session initialized. Loading canvas…
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: tools panel */}
          <div className="w-1/3 h-full flex flex-col overflow-hidden bg-cream">
            <div className="flex-1 overflow-y-auto flex flex-col">
              {/* Inspect selected node */}
              {selectedElement && (
                <div className="border-b border-line">
                  <div className="px-4 pt-3 pb-2 flex items-center gap-2">
                    <span className={sectionLabel}>
                      <Crosshair className="h-3.5 w-3.5 text-clay" /> Inspect selected node
                    </span>
                    <button
                      onClick={() => { setSelectedElement(null); setSelectedElementLocators([]); }}
                      className="ml-auto text-[11px] text-mute hover:text-graphite"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="px-4 pb-3.5 flex flex-col gap-2.5">
                    <div className="px-3 py-2.5 bg-panel rounded-lg border border-line">
                      <div className="font-mono text-xs text-clay mb-0.5">&lt;{selectedElement.tagName}&gt;</div>
                      <div className="text-xs text-graphite">{selectedElement.text}</div>
                      {selectedElement.frameLocators?.length > 0 && (
                        <div className="text-[10px] text-clay font-medium mt-1">
                          Frame: {selectedElement.frameLocators.join(" → ")}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-stone">Method code name</label>
                      <input
                        type="text"
                        value={selectedElementMethodName}
                        onChange={(e) => setSelectedElementMethodName(e.target.value)}
                        placeholder="e.g. click_submit_btn"
                        className={`${fieldCls} font-mono`}
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-stone">Action type</label>
                      <Dropdown
                        value={selectedElementAction}
                        onChange={setSelectedElementAction}
                        className="h-[34px] px-2.5 rounded-md text-xs text-ink"
                        options={[
                          { value: "click", label: "Click" },
                          { value: "fill", label: "Fill / Type" },
                          { value: "hover", label: "Hover" },
                          { value: "select_option", label: "Select option" },
                        ]}
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-stone">Best strategy locator</label>
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
                        className="h-[34px] px-2.5 rounded-md text-xs text-ink font-mono"
                        options={selectedElementLocators.map((loc, idx) => {
                          const uniqueness =
                            loc.unique === true ? " ✅ (Unique)" : loc.unique === false ? ` ⚠️ (Matches: ${loc.count})` : "";
                          return { value: String(idx), label: `${loc.strategy}${uniqueness}` };
                        })}
                      />
                    </div>

                    <button
                      onClick={handleAddElementToPOM}
                      className="h-9 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors"
                    >
                      Record to page object class
                    </button>
                  </div>
                </div>
              )}

              {/* Page objects */}
              <div className="border-b border-line">
                <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                  <span className={sectionLabel}>
                    <Layers className="h-3.5 w-3.5 text-stone" /> Page objects (POM)
                  </span>
                  <button onClick={() => setShowNewClassModal(true)} className={iconBtn} title="Create page class">
                    <Plus className="h-3.5 w-3.5 text-graphite" />
                  </button>
                </div>
                <div className="px-4 pb-2.5">
                  <Dropdown
                    value={activePomClass}
                    onChange={setActivePomClass}
                    widthClass="w-full"
                    className="h-[34px] px-2.5 rounded-md text-xs text-ink"
                    options={pomClasses.map((cls) => ({ value: cls, label: cls }))}
                  />
                </div>
                <div className="px-4 pb-3 flex flex-col gap-0.5">
                  {(pomElements[activePomClass] || []).length ? (
                    (pomElements[activePomClass] || []).map((el) => (
                      <div key={el.element_id} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-panel">
                        <Code2 className="h-3.5 w-3.5 text-stone flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-[11px] text-graphite">{el.method_name}()</div>
                          <div className="font-mono text-[10px] text-mute truncate">{el.strategy}: {el.selector}</div>
                        </div>
                        <button
                          onClick={() =>
                            setPomElements((prev) => ({
                              ...prev,
                              [activePomClass]: prev[activePomClass].filter((item) => item.element_id !== el.element_id),
                            }))
                          }
                          className="h-5 w-5 rounded flex items-center justify-center hover:bg-danger-soft text-mute hover:text-danger transition-colors flex-shrink-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-[11px] text-mute text-center py-2">
                      No elements recorded. Toggle inspect and click elements in the canvas.
                    </p>
                  )}
                </div>
              </div>

              {/* Code output */}
              <div className="border-b border-line">
                <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                  <span className={sectionLabel}>
                    <Terminal className="h-3.5 w-3.5 text-stone" /> Code output
                  </span>
                  <button
                    onClick={() => {
                      const code = activeGenCodeTab === "pom" ? generatedPomCode : generatedClientCode;
                      const filename = activeGenCodeTab === "pom" ? `${activePomClass}.py` : "http_client.py";
                      if (code) downloadFile(code, filename);
                    }}
                    disabled={activeGenCodeTab === "pom" ? !generatedPomCode : !generatedClientCode}
                    className="h-[26px] px-2.5 bg-cream border border-line rounded-md text-[11px] font-medium text-graphite hover:bg-panel transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </button>
                </div>
                <div className="flex border-b border-line mx-4">
                  {(["pom", "client"] as const).map((t) => {
                    const on = activeGenCodeTab === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setActiveGenCodeTab(t)}
                        className="px-3.5 py-1.5 text-xs transition-colors"
                        style={{
                          borderBottom: `2px solid ${on ? "var(--color-clay)" : "transparent"}`,
                          color: on ? "var(--color-ink)" : "var(--color-stone)",
                          fontWeight: on ? 500 : 400,
                        }}
                      >
                        {t === "pom" ? "POM class" : "HTTP client"}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => {
                      const defaultName = activeGenCodeTab === "pom" ? `${activePomClass.toLowerCase()}_page.py` : "http_client.py";
                      setSaveToWorkspaceFilename(defaultName);
                      setShowSaveToWorkspaceModal(true);
                    }}
                    disabled={activeGenCodeTab === "pom" ? !generatedPomCode : !generatedClientCode}
                    className="ml-auto text-[11px] font-medium text-clay hover:text-clay-dark transition-colors disabled:opacity-50"
                  >
                    Save to workspace
                  </button>
                </div>
                <div className="px-4 py-3">
                  <pre className="m-0 p-3.5 bg-ink-900 text-cream rounded-lg font-mono text-[11px] leading-relaxed overflow-auto max-h-[180px]">
                    {(activeGenCodeTab === "pom" ? generatedPomCode : generatedClientCode) ||
                      "// Generated code appears here as you record elements or select network logs."}
                  </pre>
                </div>
              </div>

              {/* Quick paste */}
              <div className="border-b border-line px-4 py-3">
                <div className="mb-2">
                  <span className={sectionLabel}>
                    <Clipboard className="h-3.5 w-3.5 text-stone" /> Quick paste
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    id="lixionary-quick-paste-input"
                    placeholder="Type or paste value into focused element…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const input = e.currentTarget;
                        if (input.value) { handlePasteText(input.value); input.value = ""; }
                      }
                    }}
                    className="flex-1 h-8 bg-cream border border-line rounded-md px-2.5 text-xs text-graphite outline-none focus:border-clay"
                  />
                  <button
                    onClick={() => {
                      const input = document.getElementById("lixionary-quick-paste-input") as HTMLInputElement;
                      if (input?.value) { handlePasteText(input.value); input.value = ""; }
                    }}
                    className="h-8 px-3 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors"
                  >
                    Send
                  </button>
                </div>
                <p className="text-[10px] text-mute leading-relaxed mt-2">
                  Send text into the focused element, or focus the canvas and press Ctrl+V / Cmd+V.
                </p>
              </div>

              {/* Network logs */}
              <div className="px-4 py-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className={sectionLabel}>
                    <Activity className="h-3.5 w-3.5 text-stone" /> Network logs
                  </span>
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-danger" />
                    <span className="text-[10px] font-medium text-danger">Recording</span>
                  </div>
                </div>
                <input
                  type="text"
                  placeholder="Filter by URL or method…"
                  value={networkFilter}
                  onChange={(e) => setNetworkFilter(e.target.value)}
                  className="h-[30px] bg-cream border border-line rounded-md px-2.5 text-xs text-graphite outline-none focus:border-clay"
                />
                <div className="flex flex-col gap-0.5">
                  {filteredLogs.map((log) => (
                    <div key={log.id} className="flex flex-col gap-1 px-2 py-1.5 rounded-md hover:bg-panel transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0" style={methodStyle(log.method)}>
                          {log.method}
                        </span>
                        <span className="font-mono text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0" style={statusStyle(log.status)}>
                          {log.status === null ? "Pending" : `${log.status} ${log.statusText}`}
                        </span>
                        <span className="font-mono text-[10px] text-stone flex-1 truncate">{log.url}</span>
                      </div>
                      <div className="flex items-center justify-between pl-0.5">
                        <button onClick={() => handleLogClick(log.id)} className="text-[10px] font-medium text-clay hover:text-clay-dark">
                          Inspect details
                        </button>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedLogsForClient.includes(log.id)}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedLogsForClient([...selectedLogsForClient, log.id]);
                              else setSelectedLogsForClient(selectedLogsForClient.filter((id) => id !== log.id));
                            }}
                            className="h-3 w-3 cursor-pointer"
                            style={{ accentColor: "#cc785c" }}
                          />
                          <span className="text-[10px] text-mute font-medium uppercase">Client</span>
                        </label>
                      </div>
                    </div>
                  ))}
                  {filteredLogs.length === 0 && (
                    <p className="text-[11px] text-mute text-center py-3">No network activity captured yet.</p>
                  )}
                </div>
              </div>
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
            onClick={() => handleStartBrowser(selectedProfileId)}
            className="mt-2 h-10 px-6 bg-clay hover:bg-clay-dark rounded-lg text-sm font-medium text-white flex items-center gap-2 transition-colors"
          >
            <Play className="h-4 w-4" /> Connect VNC browser
          </button>
        </div>
      )}

      {/* Network details drawer */}
      {logDetails && (
        <div className="fixed inset-y-0 right-0 z-50 w-[500px] border-l border-line bg-cream shadow-[0_24px_48px_-12px_rgba(20,20,19,0.18)] flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-line flex items-center justify-between flex-shrink-0">
            <span className="font-serif text-lg font-medium text-ink">Network details</span>
            <button
              onClick={() => setLogDetails(null)}
              className="h-8 w-8 rounded-lg border border-line flex items-center justify-center hover:bg-panel transition-colors"
            >
              <X className="h-4 w-4 text-graphite" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5 text-xs font-mono select-text">
            <Field label="Request URL"><span className="text-graphite break-all">{logDetails.request.url}</span></Field>
            <div className="flex gap-4">
              <Field label="Method" className="w-1/2"><span className="text-clay font-medium">{logDetails.request.method}</span></Field>
              <Field label="Type" className="w-1/2"><span className="text-graphite">{logDetails.request.resourceType}</span></Field>
            </div>
            <Field label="Request headers">
              <div className="flex flex-col gap-1">
                {Object.entries(logDetails.request.headers).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-mute w-36 truncate flex-shrink-0">{k}:</span>
                    <span className="text-graphite break-all">{v}</span>
                  </div>
                ))}
              </div>
            </Field>
            {logDetails.response ? (
              <>
                <Field label="Response status">
                  <span style={{ color: logDetails.response.status < 400 ? "#276749" : "#c64545" }} className="font-medium">
                    {logDetails.response.status} {logDetails.response.statusText}
                  </span>
                </Field>
                <Field label="Response body">
                  <pre className="m-0 p-3 bg-ink-900 text-sage rounded-lg whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {logDetails.response.body}
                  </pre>
                </Field>
              </>
            ) : (
              <p className="text-mute text-center italic py-4">Response pending or omitted.</p>
            )}
          </div>
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

      {/* Profiles manager modal */}
      {showProfileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(20,20,19,0.5)", backdropFilter: "blur(2px)" }}>
          <div className="bg-cream rounded-2xl p-7 w-full max-w-4xl h-[620px] shadow-[0_24px_48px_-12px_rgba(20,20,19,0.18)] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-line pb-4 flex-shrink-0">
              <h2 className="m-0 font-serif text-xl font-medium text-ink">Browser profiles</h2>
              <button
                onClick={() => { setShowProfileModal(false); handleClearProfileForm(); }}
                className="h-8 w-8 rounded-lg border border-line flex items-center justify-center hover:bg-panel transition-colors"
              >
                <X className="h-4 w-4 text-graphite" />
              </button>
            </div>

            <div className="flex flex-1 overflow-hidden gap-6 pt-4">
              {/* List */}
              <div className="w-1/3 border-r border-line pr-4 flex flex-col overflow-hidden">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-mute mb-3">Profiles list</span>
                <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
                  {profiles.length ? (
                    profiles.map((p) => {
                      const active = editingProfileId === p.id;
                      return (
                        <div
                          key={p.id}
                          className="p-3 rounded-xl border flex flex-col gap-2 transition-colors"
                          style={active ? { background: "var(--color-hover)", borderColor: "var(--color-clay)" } : { background: "var(--color-cream)", borderColor: "var(--color-line)" }}
                        >
                          <div className="cursor-pointer" onClick={() => handleOpenEditProfile(p)}>
                            <p className="text-xs font-medium text-ink">{p.name}</p>
                            <p className="text-[10px] text-mute mt-1 font-mono truncate">ID: {p.id}</p>
                          </div>
                          <div className="flex justify-end gap-3 border-t border-line pt-2">
                            <button onClick={() => handleOpenEditProfile(p)} className="text-[10px] font-medium text-clay hover:text-clay-dark">Edit</button>
                            <button
                              onClick={async () => {
                                if (confirm("Delete this profile?")) {
                                  await handleDeleteProfile(p.id);
                                  if (editingProfileId === p.id) handleClearProfileForm();
                                }
                              }}
                              className="text-[10px] font-medium text-danger hover:opacity-80"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-6 text-mute text-xs">No profiles configured.</div>
                  )}
                </div>
              </div>

              {/* Form */}
              <form onSubmit={handleSaveProfileSubmit} className="w-2/3 flex flex-col overflow-hidden gap-4">
                <div className="flex items-center justify-between flex-shrink-0">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-mute">
                    {editingProfileId ? "Edit profile settings" : "Configure new profile"}
                  </span>
                  {editingProfileId && (
                    <button type="button" onClick={handleClearProfileForm} className="text-[10px] font-medium text-clay hover:text-clay-dark">
                      New profile form
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-1">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[13px] font-medium text-graphite">Profile name</label>
                    <input
                      type="text"
                      placeholder="e.g. Authenticated admin session"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      required
                      className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[13px] font-medium text-graphite">Inject cookies (JSON array)</label>
                    <textarea
                      rows={4}
                      value={profileCookies}
                      onChange={(e) => setProfileCookies(e.target.value)}
                      placeholder='[{"name": "session", "value": "xyz", "domain": "example.com", "path": "/"}]'
                      className="bg-cream border border-line rounded-lg p-3 font-mono text-xs text-graphite outline-none focus:border-clay resize-none"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[13px] font-medium text-graphite">Inject localStorage (JSON)</label>
                    <textarea
                      rows={5}
                      value={profileLocalStorage}
                      onChange={(e) => setProfileLocalStorage(e.target.value)}
                      placeholder={'{\n  "origins": [\n    { "origin": "https://example.com", "localStorage": [{"name": "k", "value": "v"}] }\n  ]\n}'}
                      className="bg-cream border border-line rounded-lg p-3 font-mono text-xs text-graphite outline-none focus:border-clay resize-none"
                    />
                  </div>

                  <div className="border-t border-line pt-3 flex flex-col gap-4">
                    <h4 className="text-[11px] font-semibold text-clay uppercase tracking-[0.08em]">Auth hook integration</h4>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[13px] font-medium text-graphite">Link auth hook</label>
                      <Dropdown
                        value={profileAuthFunctionId}
                        onChange={setProfileAuthFunctionId}
                        placeholder="— No auth hook linked —"
                        className="h-10 px-3 rounded-lg text-sm text-ink"
                        options={[
                          { value: "", label: "— No auth hook linked —" },
                          ...authFunctions.map((f) => ({
                            value: f.id,
                            label: `${f.name} ${f.expires_in ? `(${f.expires_in}s TTL)` : "(default TTL)"}`,
                          })),
                        ]}
                      />
                    </div>

                    {profileAuthFunctionId && (
                      <div className="bg-panel p-3.5 rounded-xl border border-line flex flex-col gap-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[13px] font-medium text-graphite">Injection type</label>
                            <Dropdown
                              value={profileAuthInjectionType}
                              onChange={(v) => setProfileAuthInjectionType(v as "cookie" | "localStorage")}
                              widthClass="w-full"
                              className="h-9 px-2.5 rounded-md text-xs text-ink"
                              options={[
                                { value: "cookie", label: "Cookie" },
                                { value: "localStorage", label: "Local storage" },
                              ]}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[13px] font-medium text-graphite">Target key / name</label>
                            <input
                              type="text"
                              placeholder="e.g. auth_token"
                              value={profileAuthInjectionKey}
                              onChange={(e) => setProfileAuthInjectionKey(e.target.value)}
                              required={!!profileAuthFunctionId}
                              className="h-9 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay"
                            />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[13px] font-medium text-graphite">
                            {profileAuthInjectionType === "cookie" ? "Domain (cookie)" : "Origin (local storage)"}
                          </label>
                          <input
                            type="text"
                            placeholder={profileAuthInjectionType === "cookie" ? "e.g. .example.com" : "e.g. https://example.com"}
                            value={profileAuthInjectionDomainOrOrigin}
                            onChange={(e) => setProfileAuthInjectionDomainOrOrigin(e.target.value)}
                            required={!!profileAuthFunctionId}
                            className="h-9 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end flex-shrink-0 border-t border-line pt-3">
                  <button
                    type="submit"
                    className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors"
                  >
                    {editingProfileId ? "Update profile" : "Save profile"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
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
