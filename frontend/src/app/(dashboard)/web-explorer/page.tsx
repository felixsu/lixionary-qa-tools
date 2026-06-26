"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Globe, RefreshCw, Terminal, Eye, EyeOff, 
  AlertCircle, Copy, Download, Trash, Plus, ChevronRight, FileCode, Play,
  Save, File, Folder, PlayCircle, XCircle, Rows
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { useAppContext } from "../../context/AppContext";

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
    selectedLogId,
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
    setClientBaseUrl,

    // Profiles state & ops
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
    handleDeleteProfile
  } = useAppContext();

  // Workspace integration states
  const [activeLeftTab, setActiveLeftTab] = useState<"browser" | "workspace">("browser");
  const [workspaceFiles, setWorkspaceFiles] = useState<{name: string, size: number, updatedAt: string}[]>([]);

  // Layout and Resizable Pane states
  const [viewMode, setViewMode] = useState<"browser" | "split" | "workspace">("split");
  const [explorerWidth, setExplorerWidth] = useState<number>(220);
  const [workspaceSplitPercent, setWorkspaceSplitPercent] = useState<number>(50);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleSplitDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startPercent = workspaceSplitPercent;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const deltaY = moveEvent.clientY - startY;
      const deltaPercent = (deltaY / rect.height) * 100;
      const newPercent = Math.min(Math.max(startPercent + deltaPercent, 20), 80);
      setWorkspaceSplitPercent(newPercent);
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
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.min(Math.max(startWidth + deltaX, 140), 400);
      setExplorerWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<string>("");
  const [workspaceFileContent, setWorkspaceFileContent] = useState<string>("");
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState<boolean>(false);
  const [workspaceLogs, setWorkspaceLogs] = useState<string>("");
  const [isScriptRunning, setIsScriptRunning] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>("");
  const [showNewFileModal, setShowNewFileModal] = useState<boolean>(false);

  const fetchWorkspaceFiles = async () => {
    try {
      const data = await apiCall("/api/workspace/files");
      setWorkspaceFiles(data);
      if (data.length > 0 && !selectedWorkspaceFile) {
        setSelectedWorkspaceFile(data[0].name);
      }
    } catch (e) {
      console.error("Failed to fetch workspace files", e);
    }
  };

  const fetchFileContent = async (filename: string) => {
    if (!filename) return;
    try {
      setIsWorkspaceLoading(true);
      const res = await apiCall(`/api/workspace/files/${filename}`);
      setWorkspaceFileContent(res.content);
    } catch (e) {
      console.error("Failed to fetch file content", e);
    } finally {
      setIsWorkspaceLoading(false);
    }
  };

  const handleSaveWorkspaceFile = async () => {
    if (!selectedWorkspaceFile) return;
    try {
      await apiCall(`/api/workspace/files/${selectedWorkspaceFile}`, {
        method: "POST",
        body: JSON.stringify({ content: workspaceFileContent })
      });
      alert(`File ${selectedWorkspaceFile} saved successfully.`);
      fetchWorkspaceFiles();
    } catch (e: any) {
      alert(`Failed to save file: ${e.message}`);
    }
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName) return;
    let name = newFileName.trim();
    if (!name.endsWith(".py")) {
      name += ".py";
    }
    try {
      await apiCall(`/api/workspace/files/${name}`, {
        method: "POST",
        body: JSON.stringify({ content: "# New workspace module\n" })
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
    if (filename === "main.py") {
      alert("main.py cannot be deleted.");
      return;
    }
    if (!confirm(`Are you sure you want to delete ${filename}?`)) return;
    try {
      await apiCall(`/api/workspace/files/${filename}`, {
        method: "DELETE"
      });
      if (selectedWorkspaceFile === filename) {
        setSelectedWorkspaceFile("main.py");
      }
      await fetchWorkspaceFiles();
    } catch (e: any) {
      alert(`Failed to delete file: ${e.message}`);
    }
  };

  const handleRunScript = async () => {
    if (!selectedWorkspaceFile) return;
    setIsScriptRunning(true);
    setWorkspaceLogs("");
    
    try {
      await apiCall(`/api/workspace/files/${selectedWorkspaceFile}`, {
        method: "POST",
        body: JSON.stringify({ content: workspaceFileContent })
      });
    } catch (e) {
      console.warn("Failed to auto-save file before running", e);
    }

    try {
      const response = await fetch(`/api/workspace/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ filename: selectedWorkspaceFile })
      });

      if (!response.body) {
        throw new Error("No response body available");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setWorkspaceLogs(prev => prev + chunk);
      }
    } catch (err: any) {
      setWorkspaceLogs(prev => prev + `\nExecution Error: ${err.message}\n`);
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
    fetchWorkspaceFiles();
  }, []);

  useEffect(() => {
    if (selectedWorkspaceFile) {
      fetchFileContent(selectedWorkspaceFile);
    }
  }, [selectedWorkspaceFile]);

  const renderWorkspacePanel = () => {
    return (
      <div className="h-full w-full flex overflow-hidden bg-slate-950">
        {/* Workspace sidebar list */}
        <div 
          style={{ width: `${explorerWidth}px` }} 
          className="flex-shrink-0 bg-slate-900/10 flex flex-col justify-between overflow-hidden"
        >
          <div className="flex-grow flex flex-col overflow-hidden">
            <div className="p-3 border-b border-slate-850 flex items-center justify-between flex-shrink-0 bg-slate-900/30">
              <span className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider flex items-center gap-1.5">
                <Folder className="h-3.5 w-3.5 text-indigo-400" />
                Files
              </span>
              <button
                onClick={() => setShowNewFileModal(true)}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-400"
                title="Create Python Module"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            
            <div className="flex-grow overflow-y-auto p-2 space-y-1">
              {workspaceFiles.map(file => (
                <div
                  key={file.name}
                  className={`group flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition border ${
                    selectedWorkspaceFile === file.name
                      ? "bg-indigo-600/10 border-indigo-500/30 text-indigo-400 font-bold"
                      : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
                  }`}
                >
                  <button
                    onClick={() => setSelectedWorkspaceFile(file.name)}
                    className="flex items-center gap-2 text-left truncate flex-grow"
                  >
                    <File className={`h-3.5 w-3.5 ${selectedWorkspaceFile === file.name ? "text-indigo-400" : "text-slate-500"}`} />
                    <span className="truncate">{file.name}</span>
                  </button>
                  {file.name !== "main.py" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFile(file.name);
                      }}
                      className="opacity-0 group-hover:opacity-100 hover:text-red-400 p-0.5 transition"
                      title="Delete module"
                    >
                      <Trash className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Draggable Divider for Sidebar */}
        <div
          onMouseDown={handleSidebarDragStart}
          className="w-1.5 hover:w-2 bg-slate-900/60 hover:bg-indigo-500/50 cursor-col-resize transition-all flex-shrink-0 self-stretch z-10 select-none flex items-center justify-center border-l border-r border-slate-850"
        />

        {/* Code Editor Pane */}
        <div className="flex-grow flex flex-col overflow-hidden relative">
          <div className="h-11 border-b border-slate-850 px-4 bg-slate-900/20 flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-semibold text-slate-300 font-mono flex items-center gap-1.5">
              <FileCode className="h-4 w-4 text-slate-500" />
              {selectedWorkspaceFile || "No active file"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveWorkspaceFile}
                disabled={!selectedWorkspaceFile || isWorkspaceLoading}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 text-white disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                Save
              </button>
              {isScriptRunning ? (
                <button
                  onClick={handleStopScript}
                  className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold flex items-center gap-1.5 text-white transition-all duration-200"
                >
                  <XCircle className="h-3.5 w-3.5 animate-pulse" />
                  Stop Script
                </button>
              ) : (
                <button
                  onClick={handleRunScript}
                  disabled={!selectedWorkspaceFile}
                  className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-bold flex items-center gap-1.5 text-white disabled:opacity-50 transition-all duration-200"
                >
                  <Play className="h-3.5 w-3.5" />
                  Run Script
                </button>
              )}
            </div>
          </div>

          <div className="flex-grow relative bg-slate-950 overflow-hidden">
            {isWorkspaceLoading ? (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500 bg-slate-950/80">
                Loading module content...
              </div>
            ) : (
              <Editor
                key={selectedWorkspaceFile}
                height="100%"
                language="python"
                theme="vs-dark"
                value={workspaceFileContent}
                onChange={(val) => setWorkspaceFileContent(val || "")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 11,
                  lineNumbers: "on",
                  scrollbar: { vertical: "auto", horizontal: "auto" },
                  automaticLayout: true
                }}
              />
            )}
          </div>

          {/* Console logs pane */}
          <div className="h-48 border-t border-slate-850 flex flex-col flex-shrink-0 bg-slate-950">
            <div className="h-9 px-4 border-b border-slate-850 flex items-center justify-between bg-slate-900/30 flex-shrink-0">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-slate-500" />
                Execution Console logs
              </span>
              <button
                onClick={() => setWorkspaceLogs("")}
                className="text-[10px] text-slate-500 hover:text-slate-300"
              >
                Clear
              </button>
            </div>
            <div className="flex-grow p-3 font-mono text-[10px] text-emerald-400 overflow-y-auto bg-slate-950 whitespace-pre-wrap select-text">
              {workspaceLogs || "Console output is empty. Run main.py or other script to execute."}
            </div>
          </div>
        </div>
      </div>
    );
  };

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

  // Auto-generate code when POM elements or selected logs change
  useEffect(() => {
    if (isBrowserConnected && sessionId) {
      generatePOM();
    }
  }, [pomElements, activePomClass, isBrowserConnected, sessionId]);

  useEffect(() => {
    if (isBrowserConnected && sessionId && selectedLogsForClient.length) {
      generateHttpClient();
    } else {
      setGeneratedClientCode("");
    }
  }, [selectedLogsForClient, clientBaseUrl, isBrowserConnected, sessionId]);

  const generatePOM = async () => {
    const classElements = pomElements[activePomClass] || [];
    try {
      const res = await apiCall("/api/browser/pom/generate", {
        method: "POST",
        body: JSON.stringify({
          className: activePomClass,
          url: browserUrl,
          elements: classElements
        })
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
        body: JSON.stringify({
          baseUrl: clientBaseUrl,
          logIds: selectedLogsForClient,
          sessionId: sessionId
        })
      });
      setGeneratedClientCode(res.code);
    } catch (e) {
      console.error(e);
    }
  };

  // Add recorded element to POM list
  const handleAddElementToPOM = () => {
    if (!selectedElement) return;
    
    // Read the form values or fallback
    const strategy = selectedElementLocators[0]?.strategy || "locator (CSS)";
    const selector = selectedElementLocators[0]?.selector || selectedElement.cssSelector;

    const newEl = {
      element_id: `el_${Math.random().toString(36).substring(2, 9)}`,
      method_name: selectedElementMethodName || `click_${selectedElement.tagName}`,
      strategy,
      selector,
      action: selectedElementAction,
      frameLocators: selectedElement.frameLocators || []
    };

    setPomElements(prev => {
      const currentClassEls = prev[activePomClass] || [];
      // Prevent duplicate method names
      if (currentClassEls.some(el => el.method_name === newEl.method_name)) {
        alert("Method name already exists in this Page Class.");
        return prev;
      }
      return {
        ...prev,
        [activePomClass]: [...currentClassEls, newEl]
      };
    });

    // Reset element selector view
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
    setPomElements(prev => ({ ...prev, [newClassName]: [] }));
    setActivePomClass(newClassName);
    setNewClassName("");
    setShowNewClassModal(false);
  };

  const handleSaveProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName) return;

    // Basic JSON format check
    if (profileCookies) {
      try {
        JSON.parse(profileCookies);
      } catch (err) {
        alert("Cookies must be a valid JSON array or empty.");
        return;
      }
    }
    if (profileLocalStorage) {
      try {
        JSON.parse(profileLocalStorage);
      } catch (err) {
        alert("LocalStorage must be a valid JSON object or empty.");
        return;
      }
    }

    try {
      const authInjectionVal = profileAuthFunctionId ? {
        type: profileAuthInjectionType,
        key: profileAuthInjectionKey,
        domainOrOrigin: profileAuthInjectionDomainOrOrigin
      } : null;

      await handleSaveProfile(
        profileName,
        profileCookies,
        profileLocalStorage,
        profileAuthFunctionId || null,
        authInjectionVal,
        editingProfileId
      );
      // Reset form
      setProfileName("");
      setProfileCookies("");
      setProfileLocalStorage("");
      setProfileAuthFunctionId("");
      setProfileAuthInjectionType("cookie");
      setProfileAuthInjectionKey("");
      setProfileAuthInjectionDomainOrOrigin("");
      setEditingProfileId(null);
      alert("Browser Profile saved successfully!");
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

  const filteredLogs = networkLogs.filter(log => 
    log.url.toLowerCase().includes(networkFilter.toLowerCase()) ||
    log.method.toLowerCase().includes(networkFilter.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      
      {/* Web explorer control bar */}
      <div className="p-3 border-b border-slate-850 bg-slate-900/20 flex items-center justify-between flex-shrink-0 gap-4">
        <div className="flex items-center gap-2 flex-grow">
          <Globe className="h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={browserUrl}
            onChange={(e) => setBrowserUrl(e.target.value)}
            placeholder="https://example.com"
            className="flex-grow bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
            disabled={!isBrowserConnected}
          />
          {isBrowserConnected ? (
            <>
              <button
                onClick={handleBrowserNavigate}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-bold transition flex items-center gap-1 text-white"
              >
                Go
              </button>
              <button
                onClick={handleToggleInspect}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${inspectMode ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/40" : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200"}`}
              >
                {inspectMode ? "Inspecting" : "Inspect Element"}
              </button>
              <button
                onClick={handleDisconnectBrowser}
                className="px-3.5 py-1.5 bg-rose-950/80 hover:bg-rose-900 border border-rose-900/50 rounded-lg text-xs font-semibold text-rose-200 transition"
              >
                Disconnect
              </button>
            </>
          ) : (
            <div className="flex items-center gap-3">
              {/* Profile Selector */}
              <select
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                className="bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 outline-none"
              >
                <option value="">No Profile (Clean Session)</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              
              <button
                onClick={() => setShowProfileModal(true)}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-semibold text-slate-400 transition"
              >
                Manage Profiles
              </button>

              <button
                onClick={() => handleStartBrowser(selectedProfileId)}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-bold text-white transition flex items-center gap-1.5"
              >
                <Play className="h-3.5 w-3.5" />
                Connect VNC Browser
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Workspace split panel */}
      {isBrowserConnected ? (
        <div className="flex-grow flex overflow-hidden">
          {/* Left Panel: Embedded VNC Browser Frame or Workspace Panel */}
          <div className="w-2/3 h-full bg-slate-950 flex flex-col overflow-hidden border-r border-slate-900">
            {/* Left Panel View Mode Toggle Buttons */}
            <div className="h-10 bg-slate-900 border-b border-slate-800/80 px-4 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase font-extrabold text-slate-500 tracking-wider">
                  View Mode
                </span>
                <div className="flex bg-slate-950 border border-slate-850 rounded-lg p-0.5 overflow-hidden">
                  <button
                    onClick={() => setViewMode("browser")}
                    className={`px-3 py-1 text-[10px] font-bold uppercase transition rounded-md flex items-center gap-1.5 ${
                      viewMode === "browser"
                        ? "bg-indigo-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Eye className="h-3 w-3" />
                    Browser
                  </button>
                  <button
                    onClick={() => {
                      setViewMode("split");
                      fetchWorkspaceFiles();
                    }}
                    className={`px-3 py-1 text-[10px] font-bold uppercase transition rounded-md flex items-center gap-1.5 ${
                      viewMode === "split"
                        ? "bg-indigo-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Rows className="h-3 w-3" />
                    Split View
                  </button>
                  <button
                    onClick={() => {
                      setViewMode("workspace");
                      fetchWorkspaceFiles();
                    }}
                    className={`px-3 py-1 text-[10px] font-bold uppercase transition rounded-md flex items-center gap-1.5 ${
                      viewMode === "workspace"
                        ? "bg-indigo-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <FileCode className="h-3 w-3" />
                    Workspace
                  </button>
                </div>
              </div>
            </div>

            <div ref={containerRef} className="flex-grow overflow-hidden relative bg-black flex">
              {viewMode === "browser" && (
                vncUrl ? (
                  <iframe
                    src={vncUrl}
                    className="w-full h-full border-none"
                    title="VNC Browser Frame"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-600 text-xs w-full">
                    VNC Session initialized. Loading Canvas...
                  </div>
                )
              )}

              {viewMode === "workspace" && (
                <div className="w-full h-full flex flex-col overflow-hidden">
                  {renderWorkspacePanel()}
                </div>
              )}

              {viewMode === "split" && (
                <div className="w-full h-full flex flex-col overflow-hidden">
                  {/* Top Column: Workspace Panel */}
                  <div style={{ height: `${workspaceSplitPercent}%` }} className="w-full flex flex-col overflow-hidden flex-shrink-0">
                    {renderWorkspacePanel()}
                  </div>
                  
                  {/* Main Draggable Divider Splitter */}
                  <div
                    onMouseDown={handleSplitDragStart}
                    className="h-1.5 hover:h-2 bg-slate-900/60 hover:bg-indigo-500/50 cursor-row-resize transition-all flex-shrink-0 w-full z-10 select-none flex items-center justify-center border-t border-b border-slate-850"
                  />

                  {/* Bottom Column: VNC Browser Frame */}
                  <div style={{ height: `${100 - workspaceSplitPercent}%` }} className="w-full bg-slate-950 flex flex-col overflow-hidden flex-shrink-0">
                    {vncUrl ? (
                      <iframe
                        src={vncUrl}
                        className="w-full h-full border-none"
                        title="VNC Browser Frame"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-600 text-xs">
                        VNC Session initialized. Loading Canvas...
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: POM recorder, network logs and inspector */}
          <div className="w-1/3 h-full border-l border-slate-850 flex flex-col overflow-hidden bg-slate-950">
            {/* Split subtabs: POM Recorder, Network logs, Code Output */}
            <div className="flex-grow flex flex-col overflow-hidden">
              
              {/* Element Inspector Hook (If inspect clicks an element) */}
              {selectedElement && (
                <div className="m-3 p-3 bg-indigo-500/5 border border-indigo-500/20 rounded-xl space-y-3 flex-shrink-0">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Inspect Selected Node</h4>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">&lt;{selectedElement.tagName}&gt; - "{selectedElement.text}"</p>
                      {selectedElement.frameLocators && selectedElement.frameLocators.length > 0 && (
                        <p className="text-[9px] text-amber-500 font-semibold mt-1">
                          📍 Frame: {selectedElement.frameLocators.join(" ➔ ")}
                        </p>
                      )}
                    </div>
                    <button 
                      onClick={() => { setSelectedElement(null); setSelectedElementLocators([]); }}
                      className="text-[10px] text-slate-500 hover:text-slate-300"
                    >
                      Clear
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div>
                      <label className="text-[9px] uppercase font-bold text-slate-500">Method Code Name</label>
                      <input 
                        type="text"
                        value={selectedElementMethodName}
                        onChange={(e) => setSelectedElementMethodName(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
                        placeholder="e.g. click_submit_btn"
                      />
                    </div>

                    <div className="flex gap-2">
                      <div className="w-1/2">
                        <label className="text-[9px] uppercase font-bold text-slate-500">Action Type</label>
                        <select
                          value={selectedElementAction}
                          onChange={(e) => setSelectedElementAction(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1 text-xs outline-none"
                        >
                          <option value="click">Click</option>
                          <option value="fill">Fill / Type</option>
                          <option value="hover">Hover</option>
                          <option value="select_option">Select Option</option>
                        </select>
                      </div>
                      <div className="w-1/2">
                        <label className="text-[9px] uppercase font-bold text-slate-500">Best Strategy Locator</label>
                        <select
                          onChange={(e) => {
                            const selectedIdx = parseInt(e.target.value);
                            const loc = selectedElementLocators[selectedIdx];
                            if (loc) {
                              setSelectedElementLocators([
                                loc,
                                ...selectedElementLocators.filter((_, i) => i !== selectedIdx)
                              ]);
                            }
                          }}
                          className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1 text-xs outline-none"
                        >
                          {selectedElementLocators.map((loc, idx) => {
                            const uniqueness = loc.unique === true ? " ✅ (Unique)" : loc.unique === false ? ` ⚠️ (Matches: ${loc.count})` : "";
                            return (
                              <option key={idx} value={idx}>
                                {loc.strategy}: {loc.statement}{uniqueness}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </div>

                    <button
                      onClick={handleAddElementToPOM}
                      className="w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white transition"
                    >
                      Record Node to Page Object Class
                    </button>
                  </div>
                </div>
              )}

              {/* Accordion Panels */}
              <div className="flex-grow overflow-y-auto p-4 space-y-4">
                
                {/* Accordion Item: Page Objects Manager */}
                <div className="rounded-xl border border-slate-850 bg-slate-900/10 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Page Objects (POM)</span>
                    <button
                      onClick={() => setShowNewClassModal(true)}
                      className="p-1 rounded bg-slate-800 border border-slate-700 hover:bg-slate-750 text-indigo-400"
                      title="Create Page Class"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <select
                      value={activePomClass}
                      onChange={(e) => setActivePomClass(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-1.5 text-xs outline-none"
                    >
                      {pomClasses.map(cls => (
                        <option key={cls} value={cls}>{cls}</option>
                      ))}
                    </select>
                  </div>

                  {/* Recorded POM elements */}
                  <div className="space-y-1.5">
                    {(pomElements[activePomClass] || []).length ? (
                      (pomElements[activePomClass] || []).map(el => (
                        <div key={el.element_id} className="flex items-center justify-between bg-slate-950 p-2 rounded-lg border border-slate-900">
                          <div>
                            <span className="font-semibold text-slate-200 text-xs">{el.method_name}()</span>
                            <p className="text-[9px] text-slate-500 font-mono mt-0.5 truncate w-64">{el.strategy}: {el.selector}</p>
                          </div>
                          <button
                            onClick={() => {
                              setPomElements(prev => ({
                                ...prev,
                                [activePomClass]: prev[activePomClass].filter(item => item.element_id !== el.element_id)
                              }));
                            }}
                            className="text-slate-600 hover:text-red-400"
                          >
                            <Trash className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-[10px] text-slate-500 text-center py-2">No elements recorded yet. Toggle inspect and click elements in the canvas.</p>
                    )}
                  </div>
                </div>

                {/* Accordion Item: Code Output View */}
                <div className="rounded-xl border border-slate-850 bg-slate-900/10 p-3 space-y-3 flex flex-col h-96">
                  <div className="flex items-center justify-between">
                    <div className="flex border border-slate-850 rounded-lg overflow-hidden bg-slate-950">
                      <button
                        onClick={() => setActiveGenCodeTab("pom")}
                        className={`px-3 py-1 text-[9px] font-bold uppercase transition ${activeGenCodeTab === "pom" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                      >
                        POM Class
                      </button>
                      <button
                        onClick={() => setActiveGenCodeTab("client")}
                        className={`px-3 py-1 text-[9px] font-bold uppercase transition ${activeGenCodeTab === "client" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                      >
                        HTTP Client
                      </button>
                    </div>
                    
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          const code = activeGenCodeTab === "pom" ? generatedPomCode : generatedClientCode;
                          const defaultFilename = activeGenCodeTab === "pom" ? `${activePomClass.toLowerCase()}_pom.py` : "http_client.py";
                          const filename = prompt("Enter filename to save to workspace:", defaultFilename);
                          if (!filename || !code) return;
                          try {
                            await apiCall(`/api/workspace/files/${filename}`, {
                              method: "POST",
                              body: JSON.stringify({ content: code })
                            });
                            alert(`File ${filename} saved to workspace successfully!`);
                            fetchWorkspaceFiles();
                          } catch (err: any) {
                            alert(`Failed to save to workspace: ${err.message}`);
                          }
                        }}
                        disabled={activeGenCodeTab === "pom" ? !generatedPomCode : !generatedClientCode}
                        className="px-2 py-1 rounded bg-slate-800 border border-slate-700 hover:bg-slate-750 text-emerald-400 disabled:opacity-50 flex items-center gap-1 text-[9px] font-bold"
                        title="Save to backend virtual workspace"
                      >
                        <Save className="h-3 w-3" />
                        <span>Save to Workspace</span>
                      </button>
                      
                      <button
                        onClick={() => {
                          const code = activeGenCodeTab === "pom" ? generatedPomCode : generatedClientCode;
                          const filename = activeGenCodeTab === "pom" ? `${activePomClass}.py` : "http_client.py";
                          if (code) downloadFile(code, filename);
                        }}
                        disabled={activeGenCodeTab === "pom" ? !generatedPomCode : !generatedClientCode}
                        className="p-1 rounded bg-slate-800 border border-slate-700 hover:bg-slate-750 text-indigo-400 disabled:opacity-50"
                        title="Download synthesized file"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex-grow relative bg-slate-950 rounded-lg overflow-hidden border border-slate-900">
                    <Editor
                      height="100%"
                      language="python"
                      theme="vs-dark"
                      value={activeGenCodeTab === "pom" ? generatedPomCode : generatedClientCode}
                      options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        fontSize: 10,
                        scrollbar: { vertical: "auto", horizontal: "auto" },
                        automaticLayout: true
                      }}
                    />
                  </div>
                </div>

                {/* Accordion Item: Quick Paste Tool */}
                <div className="rounded-xl border border-slate-850 bg-slate-900/10 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Quick Paste Tool</span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Paste value to send to remote browser..."
                        id="lixionary-quick-paste-input"
                        className="w-full bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/50"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const input = e.currentTarget;
                            const text = input.value;
                            if (text) {
                              handlePasteText(text);
                              input.value = "";
                            }
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          const input = document.getElementById('lixionary-quick-paste-input') as HTMLInputElement;
                          const text = input?.value;
                          if (text) {
                            handlePasteText(text);
                            input.value = "";
                          }
                        }}
                        className="px-3 bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-bold text-white transition"
                      >
                        Send
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Type/paste text above and click <strong>Send</strong> (or press Enter) to type it into the currently active element in the remote browser. You can also focus the browser canvas and press <strong>Ctrl+V / Cmd+V</strong> to paste directly.
                    </p>
                  </div>
                </div>

                {/* Accordion Item: Browser Network Logger */}
                <div className="rounded-xl border border-slate-850 bg-slate-900/10 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Intercepted Network Logs</span>
                    <span className="text-[10px] bg-indigo-500/10 text-indigo-400 font-bold px-1.5 py-0.5 rounded">Recording</span>
                  </div>

                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Filter URL/Method..."
                        value={networkFilter}
                        onChange={(e) => setNetworkFilter(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1 text-xs focus:outline-none"
                      />
                    </div>

                    <div className="h-72 overflow-y-auto space-y-1 bg-slate-950 p-2 rounded-lg border border-slate-900">
                      {filteredLogs.map(log => (
                        <div key={log.id} className="flex flex-col gap-1 p-2 border-b border-slate-900 last:border-0 hover:bg-slate-900/40 rounded transition">
                          <div className="flex items-center justify-between">
                            <span className={`text-[9px] uppercase font-extrabold px-1 rounded ${
                              log.method === "GET" ? "bg-emerald-500/10 text-emerald-400" : "bg-blue-500/10 text-blue-400"
                            }`}>{log.method}</span>
                            <span className={`text-[9px] font-bold ${
                              log.status === null ? "text-amber-400" :
                              log.status < 400 ? "text-emerald-400" : "text-rose-400"
                            }`}>
                              {log.status === null ? "Pending" : `${log.status} ${log.statusText}`}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-300 truncate font-mono select-all">{log.url}</p>
                          <div className="flex items-center justify-between mt-1 pt-1 border-t border-slate-900/60">
                            <button
                              onClick={() => handleLogClick(log.id)}
                              className="text-[9px] text-indigo-400 hover:text-indigo-300 font-bold"
                            >
                              Inspect Details
                            </button>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedLogsForClient.includes(log.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedLogsForClient([...selectedLogsForClient, log.id]);
                                  } else {
                                    setSelectedLogsForClient(selectedLogsForClient.filter(id => id !== log.id));
                                  }
                                }}
                                className="rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-0 focus:ring-offset-0 h-3 w-3"
                              />
                              <span className="text-[9px] text-slate-500 font-semibold uppercase">Client</span>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

              </div>

            </div>
          </div>
        </div>
      ) : (
        <div className="flex-grow flex flex-col items-center justify-center text-slate-500 bg-slate-950 px-4">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="h-16 w-16 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto border border-slate-800">
              <Globe className="h-8 w-8 text-slate-500" />
            </div>
            <div>
              <h3 className="text-slate-200 font-bold text-sm">Browser Session Inactive</h3>
              <p className="text-xs text-slate-500 mt-1">Start a remote debug session to inspect pages, capture network requests, and auto-generate Playwright python POM files.</p>
            </div>
          </div>
        </div>
      )}

      {/* DETAILED LOG INSPECT DRAWER */}
      {logDetails && (
        <div className="fixed inset-y-0 right-0 z-50 w-[500px] border-l border-slate-800 bg-slate-900/95 shadow-2xl backdrop-blur-md flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Network Details</span>
            <button
              onClick={() => setLogDetails(null)}
              className="text-slate-500 hover:text-slate-300 text-xs font-bold"
            >
              Close
            </button>
          </div>
          <div className="flex-grow overflow-y-auto p-5 space-y-5 text-xs font-mono select-text">
            <div>
              <h4 className="text-[10px] font-extrabold uppercase text-slate-500 mb-1.5">Request URL</h4>
              <p className="bg-slate-950 p-2.5 rounded-lg border border-slate-950 text-slate-300 break-all">{logDetails.request.url}</p>
            </div>
            
            <div className="flex gap-4">
              <div className="w-1/2">
                <h4 className="text-[10px] font-extrabold uppercase text-slate-500 mb-1.5">Method</h4>
                <p className="bg-slate-950 p-2 rounded-lg border border-slate-950 text-indigo-400 font-bold">{logDetails.request.method}</p>
              </div>
              <div className="w-1/2">
                <h4 className="text-[10px] font-extrabold uppercase text-slate-500 mb-1.5">Type</h4>
                <p className="bg-slate-950 p-2 rounded-lg border border-slate-950 text-slate-300 font-medium">{logDetails.request.resourceType}</p>
              </div>
            </div>

            <div>
              <h4 className="text-[10px] font-extrabold uppercase text-slate-500 mb-1.5">Request Headers</h4>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-950 text-slate-400 space-y-1">
                {Object.entries(logDetails.request.headers).map(([k, v]) => (
                  <div key={k} className="flex">
                    <span className="text-slate-500 font-bold w-36 truncate">{k}:</span>
                    <span className="text-slate-300 break-all flex-grow">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {logDetails.response ? (
              <>
                <div className="flex gap-4">
                  <div className="w-1/2">
                    <h4 className="text-[10px] font-extrabold uppercase text-slate-500 mb-1.5">Response Status</h4>
                    <p className={`bg-slate-950 p-2 rounded-lg border border-slate-950 font-bold ${logDetails.response.status < 400 ? "text-emerald-400" : "text-rose-400"}`}>
                      {logDetails.response.status} {logDetails.response.statusText}
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="text-[10px] font-extrabold uppercase text-slate-500 mb-1.5">Response Body</h4>
                  <pre className="bg-slate-950 p-3 rounded-lg border border-slate-950 text-emerald-400 whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {logDetails.response.body}
                  </pre>
                </div>
              </>
            ) : (
              <p className="text-slate-500 text-center italic py-4">Response pending or omitted.</p>
            )}
          </div>
        </div>
      )}

      {/* NEW CLASS MODAL */}
      {showNewClassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <form onSubmit={handleCreateClass} className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-md space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Create New Page Class</h3>
            <input 
              type="text" 
              placeholder="Class name (e.g. LoginPage, DashboardPage)..."
              value={newClassName}
              onChange={(e) => setNewClassName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
              required
            />
            <div className="flex justify-end gap-3 pt-2">
              <button 
                type="button" 
                onClick={() => { setShowNewClassModal(false); setNewClassName(""); }}
                className="px-3.5 py-1.5 rounded-lg border border-slate-800 text-xs font-semibold text-slate-400 hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* BROWSER PROFILES MANAGER MODAL */}
      {showProfileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-4xl space-y-5 shadow-2xl flex flex-col h-[600px] overflow-hidden">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3 flex-shrink-0">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Browser Profiles Manager</h3>
              <button 
                onClick={() => { setShowProfileModal(false); handleClearProfileForm(); }}
                className="text-slate-500 hover:text-slate-300 text-xs font-bold"
              >
                Close
              </button>
            </div>

            <div className="flex flex-grow overflow-hidden gap-6">
              {/* Left Column: Profiles List */}
              <div className="w-1/3 border-r border-slate-800 flex flex-col overflow-hidden pr-4 flex-shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">Profiles List</span>
                </div>
                
                <div className="flex-grow overflow-y-auto space-y-2 pr-1">
                  {profiles.length ? (
                    profiles.map(p => (
                      <div 
                        key={p.id}
                        className={`p-3 rounded-xl border flex flex-col gap-2 transition ${
                          editingProfileId === p.id 
                            ? "bg-indigo-500/10 border-indigo-500/40 text-indigo-400" 
                            : "bg-slate-950 border-slate-850 hover:bg-slate-900 text-slate-200"
                        }`}
                      >
                        <div 
                          className="cursor-pointer"
                          onClick={() => handleOpenEditProfile(p)}
                        >
                          <p className="text-xs font-bold">{p.name}</p>
                          <p className="text-[9px] text-slate-500 mt-1 font-mono">ID: {p.id}</p>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-slate-900 pt-2">
                          <button
                            onClick={() => handleOpenEditProfile(p)}
                            className="text-[9px] font-bold text-indigo-400 hover:text-indigo-300"
                          >
                            Edit
                          </button>
                          <button
                            onClick={async () => {
                              if (confirm("Are you sure you want to delete this profile?")) {
                                await handleDeleteProfile(p.id);
                                if (editingProfileId === p.id) handleClearProfileForm();
                              }
                            }}
                            className="text-[9px] font-bold text-rose-400 hover:text-rose-300"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-6 text-slate-500 text-xs">
                      No profiles configured.
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Profile Editor Form */}
              <form onSubmit={handleSaveProfileSubmit} className="w-2/3 flex flex-col overflow-hidden space-y-4">
                <div className="flex items-center justify-between flex-shrink-0">
                  <span className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">
                    {editingProfileId ? "Edit Profile Settings" : "Configure New Profile"}
                  </span>
                  {editingProfileId && (
                    <button 
                      type="button" 
                      onClick={handleClearProfileForm}
                      className="text-[10px] bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded text-slate-400 font-bold"
                    >
                      New Profile Form
                    </button>
                  )}
                </div>

                <div className="flex-grow overflow-y-auto space-y-4 pr-1">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400">Profile Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Authenticated Admin Session"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="w-full mt-1.5 bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400">
                      Inject Cookies (JSON List Format)
                    </label>
                    <textarea
                      rows={4}
                      value={profileCookies}
                      onChange={(e) => setProfileCookies(e.target.value)}
                      className="w-full mt-1.5 bg-slate-950 border border-slate-850 rounded-xl p-3 text-xs outline-none focus:border-indigo-500 text-emerald-400 font-mono"
                      placeholder='[{"name": "session", "value": "xyz", "domain": "example.com", "path": "/"}]'
                    />
                    <p className="text-[9px] text-slate-500 mt-1 font-semibold">Tip: Paste a Playwright-compatible JSON array containing cookies.</p>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400">
                      Inject LocalStorage (JSON Object/Array Format)
                    </label>
                    <textarea
                      rows={5}
                      value={profileLocalStorage}
                      onChange={(e) => setProfileLocalStorage(e.target.value)}
                      className="w-full mt-1.5 bg-slate-950 border border-slate-850 rounded-xl p-3 text-xs outline-none focus:border-indigo-500 text-emerald-400 font-mono"
                      placeholder='{
  "origins": [
    {
      "origin": "https://operatorv2-qa.ninjavan.co",
      "localStorage": [{"name": "acceptedTnC", "value": "true"}]
    }
  ]
}'
                    />
                    <p className="text-[9px] text-slate-500 mt-1 font-semibold">Tip: Paste a key-value object or use the origins array schema above for domain-scoped storage.</p>
                  </div>

                  <div className="border-t border-slate-800 pt-3 space-y-4">
                    <h4 className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider">Auth Hook Integration</h4>
                    
                    <div>
                      <label className="text-[10px] uppercase font-bold text-slate-400">Link Auth Hook</label>
                      <select
                        value={profileAuthFunctionId}
                        onChange={(e) => setProfileAuthFunctionId(e.target.value)}
                        className="w-full mt-1.5 bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                      >
                        <option value="">-- No Auth Hook Linked --</option>
                        {authFunctions.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name} {f.expires_in ? `(${f.expires_in}s TTL)` : "(JWT/Default TTL)"}
                          </option>
                        ))}
                      </select>
                    </div>

                    {profileAuthFunctionId && (
                      <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-850 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400">Injection Type</label>
                            <select
                              value={profileAuthInjectionType}
                              onChange={(e) => setProfileAuthInjectionType(e.target.value as "cookie" | "localStorage")}
                              className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500"
                            >
                              <option value="cookie">Cookie</option>
                              <option value="localStorage">Local Storage</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400">Target Key / Name</label>
                            <input
                              type="text"
                              placeholder="e.g. auth_token"
                              value={profileAuthInjectionKey}
                              onChange={(e) => setProfileAuthInjectionKey(e.target.value)}
                              className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500"
                              required={!!profileAuthFunctionId}
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400">
                            {profileAuthInjectionType === "cookie" ? "Domain (Cookie)" : "Origin (Local Storage)"}
                          </label>
                          <input
                            type="text"
                            placeholder={profileAuthInjectionType === "cookie" ? "e.g. .ninjavan.co" : "e.g. https://operatorv2-qa.ninjavan.co"}
                            value={profileAuthInjectionDomainOrOrigin}
                            onChange={(e) => setProfileAuthInjectionDomainOrOrigin(e.target.value)}
                            className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500"
                            required={!!profileAuthFunctionId}
                          />
                          <p className="text-[9px] text-slate-500 mt-1">
                            {profileAuthInjectionType === "cookie" 
                              ? "Must be the exact domain or subdomain for the cookie." 
                              : "Must include protocol and hostname, e.g., https://example.com"}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-3 flex-shrink-0 border-t border-slate-800 pt-3">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white rounded-lg transition"
                  >
                    {editingProfileId ? "Update Profile" : "Save Profile"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {/* NEW FILE CREATION MODAL */}
      {showNewFileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <form onSubmit={handleCreateFile} className="w-full max-w-sm bg-slate-900 border border-slate-850 rounded-2xl p-6 space-y-4 shadow-2xl">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
              Create Python Module
            </h3>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-400">Filename</label>
              <input
                type="text"
                placeholder="e.g. login_pom.py"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                required
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setShowNewFileModal(false); setNewFileName(""); }}
                className="px-3.5 py-1.5 rounded-lg border border-slate-800 text-xs font-semibold text-slate-400 hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition font-bold"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
