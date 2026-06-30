"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Globe, Terminal, Eye, Crosshair, Download, Trash2, Plus, FileCode, Play,
  Save, File, Folder, XCircle, Rows, Lock, X, Layers, Code2, Clipboard, Activity,
  ChevronDown, ChevronUp, RotateCcw, Copy, Mail,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { useAppContext } from "../../context/AppContext";
import type { NetworkLog, NetworkDetails } from "../../context/AppContext";
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

    collections,
    handleSaveNetworkRequestToCollection,

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
  const [limitExceededModalOpen, setLimitExceededModalOpen] = useState(false);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);

  const onStartBrowser = async () => {
    try {
      await handleStartBrowser(selectedProfileId);
    } catch (e: any) {
      if (e.status === 429 && e.detail && e.detail.error === "resource_depleted") {
        setActiveSessions(e.detail.active_sessions || []);
        setLimitExceededModalOpen(true);
      } else {
        alert(e.message || "Failed to start browser session");
      }
    }
  };
  const [viewMode, setViewMode] = useState<"browser" | "split" | "workspace" | "network">("split");
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
  const [isConsoleMinimized, setIsConsoleMinimized] = useState<boolean>(false);

  // Save network log to API Explorer collection
  const [showSaveToCollectionModal, setShowSaveToCollectionModal] = useState(false);
  const [pendingSaveLog, setPendingSaveLog] = useState<NetworkLog | null>(null);
  const [pendingSaveDetails, setPendingSaveDetails] = useState<NetworkDetails | null>(null);
  const [saveCollectionId, setSaveCollectionId] = useState("");
  const [saveRequestName, setSaveRequestName] = useState("");
  const [saveDuplicates, setSaveDuplicates] = useState<{ collectionName: string; requestName: string }[]>([]);
  const [saveShowDuplicateWarning, setSaveShowDuplicateWarning] = useState(false);
  const [isSavingToCollection, setIsSavingToCollection] = useState(false);

  const pageMethodsRef = useRef<{ name: string; args: string; doc: string }[]>([]);
  const clientMethodsRef = useRef<{ name: string; args: string; doc: string }[]>([]);
  const completionProviderRef = useRef<any>(null);
  const activeReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  useEffect(() => {
    return () => {
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose();
        completionProviderRef.current = null;
      }
    };
  }, []);

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
    try {
      const pageData = await apiCall(`/api/workspace/files/inspection_code/my_page.py?session_id=${sessionId}`);
      if (pageData && pageData.content) {
        pageMethodsRef.current = parsePythonMethods(pageData.content);
      }
    } catch (e) {
      console.error("Failed to parse my_page.py", e);
    }
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
        triggerCharacters: [".", "p"],
        provideCompletionItems: (model: any, position: any) => {
          const lineContent = model.getLineContent(position.lineNumber);
          const textBeforeCursor = lineContent.substring(0, position.column - 1);
          
          if (textBeforeCursor.endsWith("playground_page.")) {
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
              { label: "playground_page", detail: "PlaygroundPage instance" },
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

  const handleResetWorkspaceFile = async () => {
    if (!selectedWorkspaceFile || !sessionId) return;
    if (!confirm(`Are you sure you want to reset ${selectedWorkspaceFile} to its default boilerplate? This will overwrite all your current modifications.`)) {
      return;
    }
    setIsWorkspaceLoading(true);
    try {
      const data = await apiCall(`/api/workspace/reset`, {
        method: "POST",
        body: JSON.stringify({ sessionId, filename: selectedWorkspaceFile }),
      });
      setWorkspaceFileContent(data.content || "");
      alert("File successfully reset to default boilerplate!");
    } catch (e: any) {
      alert(`Failed to reset file: ${e.message}`);
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
  const [profileDefaultUrl, setProfileDefaultUrl] = useState("");
  const [showNewClassModal, setShowNewClassModal] = useState(false);
  const [newClassName, setNewClassName] = useState("");

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

  const handleSaveProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName) return;
    if (profileCookies) {
      try { JSON.parse(profileCookies); } catch { alert("Cookies must be a valid JSON array or empty."); return; }
    }
    if (profileLocalStorage) {
      try { JSON.parse(profileLocalStorage); } catch { alert("LocalStorage must be a valid JSON object or empty."); return; }
    }
    if (profileDefaultUrl) {
      if (!profileDefaultUrl.startsWith("http://") && !profileDefaultUrl.startsWith("https://")) {
        alert("Default URL must start with http:// or https://");
        return;
      }
      try {
        new URL(profileDefaultUrl);
      } catch {
        alert("Default URL must be a valid URL format.");
        return;
      }
    }
    try {
      const authInjectionVal = profileAuthFunctionId
        ? { type: profileAuthInjectionType, key: profileAuthInjectionKey, domainOrOrigin: profileAuthInjectionDomainOrOrigin }
        : null;
      await handleSaveProfile(profileName, profileCookies, profileLocalStorage, profileAuthFunctionId || null, authInjectionVal, profileDefaultUrl, editingProfileId);
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
    setProfileDefaultUrl(profile.defaultUrl || "");
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
    setProfileDefaultUrl("");
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
    setSaveCollectionId(collections[0]?.id || "");
    setSaveDuplicates([]);
    setSaveShowDuplicateWarning(false);
    setShowSaveToCollectionModal(true);
    try {
      const data = await apiCall(`/api/browser/network/${sessionId}/details/${log.id}`);
      setPendingSaveDetails(data);
    } catch { /* non-fatal — save with basic NetworkLog info */ }
  };

  const handleConfirmSaveToCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingSaveLog || !saveCollectionId || !saveRequestName) return;

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
      await handleSaveNetworkRequestToCollection(saveCollectionId, saveCollectionId, saveRequestName, {
        method: pendingSaveLog.method,
        url: urlWithoutQuery,
        headers,
        queryParams,
        bodyType,
        body,
      });
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

      <div onMouseDown={handleSidebarDragStart} className="w-1 bg-line hover:bg-clay cursor-col-resize transition-colors flex-shrink-0 self-stretch z-10 select-none" />

      {/* Editor + console */}
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
              onChange={(val) => setWorkspaceFileContent(val || "")}
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
    </div>
  );

  const renderNetworkPanel = () => {
    return (
      <div className="w-full h-full flex overflow-hidden bg-cream font-sans">
        {/* Left pane: Requests list */}
        <div className="w-1/2 h-full border-r border-line flex flex-col overflow-hidden bg-panel">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between flex-shrink-0">
            <span className={sectionLabel}>
              <Activity className="h-3.5 w-3.5 text-stone" /> Network requests
            </span>
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-danger animate-pulse" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-danger">Recording</span>
            </div>
          </div>
          <div className="p-3 border-b border-line flex-shrink-0">
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
              onClick={onStartBrowser}
              className="h-[34px] px-4 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white flex items-center gap-1.5 transition-colors"
            >
              <Play className="h-3.5 w-3.5" /> New session
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

              {viewMode === "network" && (
                <div className="w-full h-full flex flex-col overflow-hidden bg-cream">
                  {renderNetworkPanel()}
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
                      onClick={() => { setSelectedElement(null); setSelectedElementLocators([]); }}
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
                          { value: "fill", label: "Fill / Type" },
                          { value: "hover", label: "Hover" },
                          { value: "select_option", label: "Select option" },
                        ]}
                      />
                    </div>

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
                        options={selectedElementLocators.map((loc, idx) => {
                          const uniqueness =
                            loc.unique === true ? " ✅ (Unique)" : loc.unique === false ? ` ⚠️ (${loc.count} matches)` : "";
                          return { value: String(idx), label: `${loc.strategy}${uniqueness}` };
                        })}
                      />
                    </div>

                    <button
                      onClick={handleRecordElementToPOM}
                      className="mt-1 h-9 bg-clay hover:bg-clay-dark rounded-lg text-xs font-semibold text-white transition-colors shadow-sm flex items-center justify-center gap-1.5"
                    >
                      <Save className="h-4 w-4" /> Record to page class
                    </button>
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
            className="mt-2 h-10 px-6 bg-clay hover:bg-clay-dark rounded-lg text-sm font-medium text-white flex items-center gap-2 transition-colors"
          >
            <Play className="h-4 w-4" /> Connect VNC browser
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
              <select
                value={saveCollectionId}
                onChange={(e) => setSaveCollectionId(e.target.value)}
                required
                className="h-10 bg-cream border border-line rounded-lg px-3 text-sm text-ink outline-none focus:border-clay"
              >
                {collections.length === 0 && (
                  <option value="" disabled>No collections — create one in API Explorer first</option>
                )}
                {collections.map(col => (
                  <option key={col.id} value={col.id}>{col.name}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Request name</label>
              <input
                type="text"
                value={saveRequestName}
                onChange={(e) => setSaveRequestName(e.target.value)}
                autoFocus
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
                    <label className="text-[13px] font-medium text-graphite">Default URL</label>
                    <input
                      type="text"
                      placeholder="e.g. https://admin.ninjavan.co/orders"
                      value={profileDefaultUrl}
                      onChange={(e) => setProfileDefaultUrl(e.target.value)}
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
