"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Play, Send, Cpu, Database, Key, FileCode, Plus, Trash, Share2, 
  Lock, Unlock, Globe, RefreshCw, User, LogOut, Filter, ArrowRight, 
  Search, Check, Copy, Download, ChevronRight, AlertCircle, Terminal,
  ExternalLink, Eye, EyeOff
} from "lucide-react";
import Editor from "@monaco-editor/react";

// Types
interface Environment {
  id: string;
  name: string;
  variables: { key: string; value: string; isSecret: boolean }[];
}

interface AuthFunction {
  id: string;
  name: string;
  description: string;
  script: string;
  cachedToken?: string;
  expiresAt?: string;
}

interface RequestItem {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  queryParams: { key: string; value: string }[];
  bodyType: string;
  body: string;
  authType: string;
  authConfig: {
    token?: string;
    key?: string;
    value?: string;
    authFunctionId?: string;
  };
  responseParserScript?: string;
}

interface Collection {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  collaboratorIds: string[];
  requests: RequestItem[];
}

interface NetworkLog {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  resourceType: string;
  status: number | null;
  statusText: string;
}

interface NetworkDetails {
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    resourceType: string;
  };
  response: {
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: any;
  } | null;
}

interface RecordedElement {
  element_id: string;
  method_name: string;
  strategy: string;
  selector: string;
  action: string;
}

export default function Home() {
  // Authentication State
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  // Tab State: 'api' | 'web' | 'envs' | 'auth_funcs'
  const [activeTab, setActiveTab] = useState<string>("api");

  // Databases & Shared States
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedEnvId, setSelectedEnvId] = useState<string>("");
  const [authFunctions, setAuthFunctions] = useState<AuthFunction[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [selectedRequestId, setSelectedRequestId] = useState<string>("");

  // API Explorer Active Request Editor State
  const [reqName, setReqName] = useState("New Request");
  const [reqMethod, setReqMethod] = useState("GET");
  const [reqUrl, setReqUrl] = useState("https://api.github.com/users/google");
  const [reqHeaders, setReqHeaders] = useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);
  const [reqQueryParams, setReqQueryParams] = useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);
  const [reqBodyType, setReqBodyType] = useState("NONE");
  const [reqBody, setReqBody] = useState("");
  const [reqAuthType, setReqAuthType] = useState("NONE");
  const [reqAuthConfig, setReqAuthConfig] = useState<any>({ token: "", key: "", value: "", authFunctionId: "" });
  const [reqParserScript, setReqParserScript] = useState("");

  // API Explorer Response State
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [isExecutingApi, setIsExecutingApi] = useState(false);
  const [responseTab, setResponseTab] = useState<"pretty" | "headers" | "raw" | "extracted">("pretty");
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGeneratingAiParser, setIsGeneratingAiParser] = useState(false);

  // Web Explorer State
  const [browserUrl, setBrowserUrl] = useState("https://example.com");
  const [isBrowserConnected, setIsBrowserConnected] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
  const [vncUrl, setVncUrl] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [networkLogs, setNetworkLogs] = useState<NetworkLog[]>([]);
  const [networkFilter, setNetworkFilter] = useState("");
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [logDetails, setLogDetails] = useState<NetworkDetails | null>(null);
  const [activePomClass, setActivePomClass] = useState("LandingPage");
  const [pomClasses, setPomClasses] = useState<string[]>(["LandingPage"]);
  const [pomElements, setPomElements] = useState<Record<string, RecordedElement[]>>({ "LandingPage": [] });
  const [showNewClassModal, setShowNewClassModal] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const [selectedElement, setSelectedElement] = useState<any>(null);
  const [selectedElementLocators, setSelectedElementLocators] = useState<any[]>([]);
  const [selectedElementAction, setSelectedElementAction] = useState("click");
  const [selectedElementMethodName, setSelectedElementMethodName] = useState("");
  const [activeGenCodeTab, setActiveGenCodeTab] = useState<"pom" | "client">("pom");
  const [generatedPomCode, setGeneratedPomCode] = useState("");
  const [generatedClientCode, setGeneratedClientCode] = useState("");
  const [selectedLogsForClient, setSelectedLogsForClient] = useState<string[]>([]);
  const [clientBaseUrl, setClientBaseUrl] = useState("https://example.com");

  // Modal / Sharing States
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [importCollectionId, setImportCollectionId] = useState("");
  
  // Settings / Manage Modals
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [envModalName, setEnvModalName] = useState("");
  const [envModalVariables, setEnvModalVariables] = useState<{ key: string; value: string; isSecret: boolean }[]>([
    { key: "", value: "", isSecret: false }
  ]);
  const [editingEnvId, setEditingEnvId] = useState<string | null>(null);

  const [showAuthFuncModal, setShowAuthFuncModal] = useState(false);
  const [authFuncName, setAuthFuncName] = useState("");
  const [authFuncDesc, setAuthFuncDesc] = useState("");
  const [authFuncScript, setAuthFuncScript] = useState("");
  const [editingAuthFuncId, setEditingAuthFuncId] = useState<string | null>(null);

  // WebSocket Ref for browser interactions
  const wsRef = useRef<WebSocket | null>(null);

  // Run on mount
  useEffect(() => {
    const savedToken = localStorage.getItem("lixionary_token");
    const savedUser = localStorage.getItem("lixionary_user");
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
    }
    setIsLoadingAuth(false);
  }, []);

  // Fetch data when authenticated
  useEffect(() => {
    if (token) {
      fetchEnvironments();
      fetchAuthFunctions();
      fetchCollections();
    }
  }, [token]);

  // Synchronize request inputs when selection changes
  useEffect(() => {
    if (selectedCollectionId && selectedRequestId) {
      const col = collections.find(c => c.id === selectedCollectionId);
      const req = col?.requests.find(r => r.id === selectedRequestId);
      if (req) {
        setReqName(req.name);
        setReqMethod(req.method);
        setReqUrl(req.url);
        setReqHeaders(req.headers.length ? req.headers : [{ key: "", value: "" }]);
        setReqQueryParams(req.queryParams.length ? req.queryParams : [{ key: "", value: "" }]);
        setReqBodyType(req.bodyType);
        setReqBody(req.body || "");
        setReqAuthType(req.authType);
        setReqAuthConfig(req.authConfig || { token: "", key: "", value: "", authFunctionId: "" });
        setReqParserScript(req.responseParserScript || "");
        setApiResponse(null);
      }
    }
  }, [selectedRequestId, selectedCollectionId, collections]);

  // Connect to browser WebSocket
  const connectBrowserSession = (sessId: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host; // Standard Next.js server proxying /ws isn't setup, connect directly
    // Let's connect directly to the FastAPI server websocket
    const wsUrl = `ws://localhost:8000/api/browser/ws/browser-session/${sessId}`;
    
    console.log(`Connecting WebSocket browser stream: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      console.log("WS Event:", msg.type, msg);
      
      switch (msg.type) {
        case "status":
          setIsBrowserConnected(true);
          setBrowserUrl(msg.data.url);
          break;
        case "navigation":
          setBrowserUrl(msg.data.url);
          // Auto-fetch network logs to synchronize
          fetchNetworkLogs(sessId);
          break;
        case "network_request":
          setNetworkLogs(prev => {
            // Avoid duplicate requests
            if (prev.some(log => log.id === msg.data.id)) return prev;
            return [...prev, { ...msg.data, status: null, statusText: "Pending" }];
          });
          break;
        case "network_response":
          setNetworkLogs(prev => prev.map(log => 
            log.id === msg.data.id 
              ? { ...log, status: msg.data.status, statusText: msg.data.statusText }
              : log
          ));
          break;
        case "element_selected":
          setSelectedElement(msg.data.element);
          setSelectedElementLocators(msg.data.locators);
          setSelectedElementMethodName(`${selectedElementAction}_${msg.data.element.tagName}_${msg.data.element.text.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 15)}`.toLowerCase());
          break;
        case "error":
          alert(`Browser session error: ${msg.message}`);
          break;
      }
    };

    ws.onclose = () => {
      setIsBrowserConnected(false);
      setInspectMode(false);
    };

    ws.onerror = (err) => {
      console.error("WS error:", err);
      setIsBrowserConnected(false);
    };
  };

  const handleStartBrowser = () => {
    const sessId = `session_${Math.random().toString(36).substring(2, 9)}`;
    setSessionId(sessId);
    setNetworkLogs([]);
    setSelectedElement(null);
    setSelectedElementLocators([]);
    
    // Set noVNC Iframe URL - pointing directly to VNC Browser container exposed at local machine port 8080
    setVncUrl(`http://localhost:8080/vnc.html?autoconnect=true&resize=scale&password=`);
    
    // Connect control WebSocket channel
    connectBrowserSession(sessId);
  };

  const handleDisconnectBrowser = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setIsBrowserConnected(false);
    setInspectMode(false);
    setVncUrl("");
    setSessionId("");
  };

  const handleBrowserNavigate = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: "navigate",
        url: browserUrl
      }));
    }
  };

  const handleToggleInspect = () => {
    const nextMode = !inspectMode;
    setInspectMode(nextMode);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: "toggle-inspect",
        enabled: nextMode
      }));
    }
  };

  const fetchNetworkLogs = async (sessId: string) => {
    try {
      const res = await fetch(`/api/browser/network/${sessId}/logs`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setNetworkLogs(data);
      }
    } catch (e) {
      console.error("Error fetching network logs", e);
    }
  };

  const handleLogClick = async (logId: string) => {
    setSelectedLogId(logId);
    setLogDetails(null);
    try {
      const res = await fetch(`/api/browser/network/${sessionId}/details/${encodeURIComponent(logId)}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLogDetails(data);
      }
    } catch (e) {
      console.error("Error fetching network log details", e);
    }
  };

  // REST API operations
  const apiCall = async (path: string, options: RequestInit = {}) => {
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };
    const response = await fetch(path, { ...options, headers });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: "Unknown error occurred" }));
      throw new Error(err.detail || `Server responded with ${response.status}`);
    }
    return response.json();
  };

  const handleLogin = async (email: string) => {
    try {
      // Exchange mock or user email for token
      const data = await apiCall("/api/auth/google", {
        method: "POST",
        body: JSON.stringify({ idToken: email })
      });
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem("lixionary_token", data.token);
      localStorage.setItem("lixionary_user", JSON.stringify(data.user));
    } catch (e: any) {
      alert(`Login failed: ${e.message}`);
    }
  };

  const handleGuestLogin = async () => {
    try {
      const data = await apiCall("/api/auth/guest", { method: "POST" });
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem("lixionary_token", data.token);
      localStorage.setItem("lixionary_user", JSON.stringify(data.user));
    } catch (e: any) {
      alert(`Guest login failed: ${e.message}`);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("lixionary_token");
    localStorage.removeItem("lixionary_user");
    handleDisconnectBrowser();
  };

  const fetchEnvironments = async () => {
    try {
      const data = await apiCall("/api/environments");
      setEnvironments(data);
      if (data.length && !selectedEnvId) {
        setSelectedEnvId(data[0].id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchAuthFunctions = async () => {
    try {
      const data = await apiCall("/api/auth-functions");
      setAuthFunctions(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchCollections = async () => {
    try {
      const data = await apiCall("/api/collections");
      setCollections(data);
      if (data.length && !selectedCollectionId) {
        setSelectedCollectionId(data[0].id);
        if (data[0].requests.length) {
          setSelectedRequestId(data[0].requests[0].id);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // API Explorer Commands
  const handleExecuteRequest = async () => {
    if (!selectedCollectionId || !selectedRequestId) {
      alert("Please select or create a request to execute.");
      return;
    }
    
    setIsExecutingApi(true);
    setApiResponse(null);
    setResponseTab("pretty");

    try {
      const payload = {
        requestId: selectedRequestId,
        method: reqMethod,
        url: reqUrl,
        headers: reqHeaders.filter(h => h.key !== ""),
        queryParams: reqQueryParams.filter(p => p.key !== ""),
        bodyType: reqBodyType,
        body: reqBody,
        authType: reqAuthType,
        authConfig: {
          token: reqAuthConfig.token,
          key: reqAuthConfig.key,
          value: reqAuthConfig.value,
          authFunctionId: reqAuthConfig.authFunctionId
        },
        responseParserScript: reqParserScript,
        environmentId: selectedEnvId || null
      };

      const result = await apiCall("/api/executor/run", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      
      setApiResponse(result);
      // Refresh environments just in case response parser updated variables
      fetchEnvironments();
    } catch (e: any) {
      setApiResponse({
        status: 500,
        statusText: "Error",
        headers: {},
        body: e.message,
        executionTimeMs: 0,
        parsedVariables: {}
      });
    } finally {
      setIsExecutingApi(false);
    }
  };

  const handleSaveRequest = async () => {
    if (!selectedCollectionId || !selectedRequestId) return;
    
    try {
      const col = collections.find(c => c.id === selectedCollectionId);
      if (!col) return;

      const updatedRequests = col.requests.map(r => {
        if (r.id === selectedRequestId) {
          return {
            ...r,
            name: reqName,
            method: reqMethod,
            url: reqUrl,
            headers: reqHeaders.filter(h => h.key !== ""),
            queryParams: reqQueryParams.filter(p => p.key !== ""),
            bodyType: reqBodyType,
            body: reqBody,
            authType: reqAuthType,
            authConfig: {
              token: reqAuthConfig.token,
              key: reqAuthConfig.key,
              value: reqAuthConfig.value,
              authFunctionId: reqAuthConfig.authFunctionId || null
            },
            responseParserScript: reqParserScript
          };
        }
        return r;
      });

      await apiCall(`/api/collections/${selectedCollectionId}`, {
        method: "PUT",
        body: JSON.stringify({ requests: updatedRequests })
      });

      await fetchCollections();
      alert("Request saved successfully!");
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    }
  };

  const handleCreateRequest = async () => {
    if (!selectedCollectionId) {
      alert("Please select a collection first.");
      return;
    }
    
    try {
      const col = collections.find(c => c.id === selectedCollectionId);
      if (!col) return;

      const newRequest: RequestItem = {
        id: `req_${Math.random().toString(36).substring(2, 9)}`,
        name: "New Request",
        method: "GET",
        url: "{{BASE_URL}}/api/resource",
        headers: [],
        queryParams: [],
        bodyType: "NONE",
        body: "",
        authType: "NONE",
        authConfig: {}
      };

      const updatedRequests = [...col.requests, newRequest];
      await apiCall(`/api/collections/${selectedCollectionId}`, {
        method: "PUT",
        body: JSON.stringify({ requests: updatedRequests })
      });

      await fetchCollections();
      setSelectedRequestId(newRequest.id);
    } catch (e: any) {
      alert(`Failed to add request: ${e.message}`);
    }
  };

  const handleCreateCollection = async () => {
    const name = prompt("Enter collection name:");
    if (!name) return;
    try {
      const result = await apiCall("/api/collections", {
        method: "POST",
        body: JSON.stringify({ name })
      });
      await fetchCollections();
      setSelectedCollectionId(result.id);
    } catch (e: any) {
      alert(`Failed to create collection: ${e.message}`);
    }
  };

  const handleImportCollection = async () => {
    if (!importCollectionId) return;
    try {
      // Get shared collection
      const result = await apiCall(`/api/collections/${importCollectionId}`);
      // In this version, importing adds collaboratorIds via route
      await apiCall(`/api/collections/${importCollectionId}/collaborators`, {
        method: "POST",
        body: JSON.stringify({ userId: user.id })
      });
      await fetchCollections();
      setSelectedCollectionId(importCollectionId);
      setImportCollectionId("");
      alert("Shared collection imported successfully!");
    } catch (e: any) {
      alert(`Import failed: ${e.message}`);
    }
  };

  const handleAddCollaborator = async () => {
    if (!shareEmail || !selectedCollectionId) return;
    try {
      await apiCall(`/api/collections/${selectedCollectionId}/collaborators`, {
        method: "POST",
        body: JSON.stringify({ email: shareEmail })
      });
      alert(`Collection shared with: ${shareEmail}`);
      setShareEmail("");
      setShowShareModal(false);
      fetchCollections();
    } catch (e: any) {
      alert(`Sharing failed: ${e.message}`);
    }
  };

  // Env CRUD Modal
  const openEnvCreate = () => {
    setEditingEnvId(null);
    setEnvModalName("");
    setEnvModalVariables([{ key: "", value: "", isSecret: false }]);
    setShowEnvModal(true);
  };

  const openEnvEdit = (env: Environment) => {
    setEditingEnvId(env.id);
    setEnvModalName(env.name);
    setEnvModalVariables(env.variables.length ? env.variables : [{ key: "", value: "", isSecret: false }]);
    setShowEnvModal(true);
  };

  const handleSaveEnv = async () => {
    if (!envModalName) return;
    const vars = envModalVariables.filter(v => v.key !== "");
    
    try {
      if (editingEnvId) {
        await apiCall(`/api/environments/${editingEnvId}`, {
          method: "PUT",
          body: JSON.stringify({ name: envModalName, variables: vars })
        });
      } else {
        await apiCall("/api/environments", {
          method: "POST",
          body: JSON.stringify({ name: envModalName, variables: vars })
        });
      }
      setShowEnvModal(false);
      fetchEnvironments();
    } catch (e: any) {
      alert(`Failed to save environment: ${e.message}`);
    }
  };

  const handleDeleteEnv = async (id: string) => {
    if (!confirm("Are you sure you want to delete this environment?")) return;
    try {
      await apiCall(`/api/environments/${id}`, { method: "DELETE" });
      fetchEnvironments();
      if (selectedEnvId === id) setSelectedEnvId("");
    } catch (e: any) {
      alert(`Delete failed: ${e.message}`);
    }
  };

  // Auth Functions CRUD
  const openAuthFuncCreate = () => {
    setEditingAuthFuncId(null);
    setAuthFuncName("");
    setAuthFuncDesc("");
    setAuthFuncScript(`// Write code to fetch token contextually\nconst response = fetchToken("https://api.example.com/oauth/token", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET })\n});\nconst data = JSON.parse(response);\nreturn data.access_token;`);
    setShowAuthFuncModal(true);
  };

  const openAuthFuncEdit = (func: AuthFunction) => {
    setEditingAuthFuncId(func.id);
    setAuthFuncName(func.name);
    setAuthFuncDesc(func.description);
    setAuthFuncScript(func.script);
    setShowAuthFuncModal(true);
  };

  const handleSaveAuthFunc = async () => {
    if (!authFuncName || !authFuncScript) return;
    try {
      if (editingAuthFuncId) {
        await apiCall(`/api/auth-functions/${editingAuthFuncId}`, {
          method: "PUT",
          body: JSON.stringify({ name: authFuncName, description: authFuncDesc, script: authFuncScript })
        });
      } else {
        await apiCall("/api/auth-functions", {
          method: "POST",
          body: JSON.stringify({ name: authFuncName, description: authFuncDesc, script: authFuncScript })
        });
      }
      setShowAuthFuncModal(false);
      fetchAuthFunctions();
    } catch (e: any) {
      alert(`Failed to save Auth function: ${e.message}`);
    }
  };

  const handleDeleteAuthFunc = async (id: string) => {
    if (!confirm("Are you sure you want to delete this Auth function?")) return;
    try {
      await apiCall(`/api/auth-functions/${id}`, { method: "DELETE" });
      fetchAuthFunctions();
    } catch (e: any) {
      alert(`Delete failed: ${e.message}`);
    }
  };

  // AI Response parsing generator
  const handleGenerateAiParser = async () => {
    if (!apiResponse || !apiResponse.body) {
      alert("No active API response body sample available to map.");
      return;
    }
    setIsGeneratingAiParser(true);
    try {
      const result = await apiCall("/api/ai/generate-parser", {
        method: "POST",
        body: JSON.stringify({
          responseBodySample: apiResponse.body,
          prompt: aiPrompt
        })
      });
      setReqParserScript(result.generatedScript);
      setShowAiModal(false);
      setAiPrompt("");
    } catch (e: any) {
      alert(`AI Parser generation failed: ${e.message}`);
    } finally {
      setIsGeneratingAiParser(false);
    }
  };

  // POM Element capture & generation
  const handleAddNewPomElement = () => {
    if (!selectedElement || !selectedElementLocators.length) return;
    
    // Get the selector strategy corresponding to best rank
    const bestLocator = selectedElementLocators[0];
    const newEl: RecordedElement = {
      element_id: selectedElementMethodName.replace(/^(click|fill|hover)_/, ""),
      method_name: selectedElementMethodName,
      strategy: bestLocator.strategy,
      selector: bestLocator.selector,
      action: selectedElementAction
    };

    setPomElements(prev => {
      const activeList = prev[activePomClass] || [];
      return {
        ...prev,
        [activePomClass]: [...activeList, newEl]
      };
    });

    // Reset inspection selected element
    setSelectedElement(null);
    setSelectedElementLocators([]);
    
    // Auto-update POM code representation
    setTimeout(() => updateGeneratedPomCode(), 100);
  };

  const handleAddNewPomClass = () => {
    if (!newClassName) return;
    // Format name to pascal case
    const formatted = newClassName.replace(/(?:^\w|[A-Z]|\b\w)/g, word => word.toUpperCase()).replace(/\s+/g, "");
    if (!pomClasses.includes(formatted)) {
      setPomClasses(prev => [...prev, formatted]);
      setPomElements(prev => ({ ...prev, [formatted]: [] }));
      setActivePomClass(formatted);
    }
    setNewClassName("");
    setShowNewClassModal(false);
  };

  const updateGeneratedPomCode = async () => {
    const list = pomElements[activePomClass] || [];
    try {
      const res = await apiCall("/api/browser/pom/generate", {
        method: "POST",
        body: JSON.stringify({
          className: activePomClass,
          url: browserUrl,
          parentLocator: "",
          elements: list
        })
      });
      setGeneratedPomCode(res.code);
    } catch (e) {
      console.error(e);
    }
  };

  // HTTP client generation from selected logs
  const handleGenerateHttpClient = async () => {
    if (!selectedLogsForClient.length) {
      alert("Please check at least one network request log.");
      return;
    }
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
      setActiveGenCodeTab("client");
    } catch (e: any) {
      alert(`Client generation failed: ${e.message}`);
    }
  };

  const downloadTextFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Helper arrays for Key-Value lists
  const handleKVChange = (list: any[], setList: any, index: number, field: string, val: string) => {
    const updated = [...list];
    updated[index][field] = val;
    
    // Add new blank line if last line is filled
    if (index === list.length - 1 && (updated[index].key !== "" || updated[index].value !== "")) {
      updated.push({ key: "", value: "" });
    }
    setList(updated);
  };

  const handleKVRemove = (list: any[], setList: any, index: number) => {
    if (list.length === 1) {
      setList([{ key: "", value: "" }]);
      return;
    }
    const updated = list.filter((_, idx) => idx !== index);
    setList(updated);
  };

  // Filtered network logs
  const filteredNetworkLogs = networkLogs.filter(log => {
    if (!networkFilter) return true;
    try {
      // Regex support
      const r = new RegExp(networkFilter, "i");
      return r.test(log.url) || r.test(log.method) || r.test(log.resourceType);
    } catch (e) {
      // String contains fallback
      return log.url.toLowerCase().includes(networkFilter.toLowerCase()) || 
             log.method.toLowerCase().includes(networkFilter.toLowerCase());
    }
  });

  if (isLoadingAuth) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-10 w-10 animate-spin text-indigo-500" />
          <p className="text-sm font-medium">Loading Lixionary Workspace...</p>
        </div>
      </div>
    );
  }

  // Render Authentication Portal if not logged in
  if (!token) {
    return (
      <div className="flex min-h-screen w-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black text-slate-200 px-4">
        <div className="w-full max-w-md space-y-8 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-8 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-lg shadow-indigo-500/30">
              <Cpu className="h-9 w-9 text-white" />
            </div>
            <h1 className="mt-6 text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-indigo-200 to-violet-300 bg-clip-text text-transparent">
              Lixionary Explorer
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              The collaborative API automation and POM client synthesiser.
            </p>
          </div>

          <div className="mt-8 space-y-4">
            <button
              onClick={() => {
                const email = prompt("Enter developer email (e.g. admin@lixionary.com):", "developer@lixionary.com");
                if (email) handleLogin(email);
              }}
              className="group flex w-full items-center justify-center gap-3 rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-900 px-4 py-3 text-sm font-semibold transition-all duration-200 hover:border-slate-700"
            >
              <Globe className="h-5 w-5 text-indigo-500 group-hover:scale-110 transition-transform" />
              Sign in via Lixionary Google SSO
            </button>

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-slate-800/60"></div>
              <span className="flex-shrink mx-4 text-xs font-semibold uppercase tracking-wider text-slate-500">OR</span>
              <div className="flex-grow border-t border-slate-800/60"></div>
            </div>

            <button
              onClick={handleGuestLogin}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 px-4 py-3 text-sm font-semibold shadow-lg shadow-indigo-600/20 transition-all duration-200"
            >
              Start in Guest Developer Mode
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-6 text-center text-xs text-slate-500">
            Developer sandbox bypass active for local deployments.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      
      {/* Sidebar Panel */}
      <aside className="w-64 flex-shrink-0 border-r border-slate-800/80 bg-slate-900/60 flex flex-col justify-between">
        <div>
          {/* Logo */}
          <div className="h-16 flex items-center gap-3 px-6 border-b border-slate-800/80">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 shadow-md shadow-indigo-500/20">
              <Cpu className="h-5 w-5 text-white" />
            </div>
            <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
              Lixionary
            </span>
          </div>

          {/* Navigation Menu */}
          <nav className="mt-6 px-4 space-y-1.5">
            <button
              onClick={() => setActiveTab("api")}
              className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${
                activeTab === "api" 
                  ? "bg-indigo-600/10 border border-indigo-500/30 text-indigo-400" 
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
              }`}
            >
              <Send className="h-4 w-4" />
              API Automation Explorer
            </button>

            <button
              onClick={() => setActiveTab("web")}
              className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${
                activeTab === "web" 
                  ? "bg-indigo-600/10 border border-indigo-500/30 text-indigo-400" 
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
              }`}
            >
              <Globe className="h-4 w-4" />
              Web Explorer & POM
            </button>

            <button
              onClick={() => setActiveTab("envs")}
              className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${
                activeTab === "envs" 
                  ? "bg-indigo-600/10 border border-indigo-500/30 text-indigo-400" 
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
              }`}
            >
              <Database className="h-4 w-4" />
              Environments ({environments.length})
            </button>

            <button
              onClick={() => setActiveTab("auth_funcs")}
              className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${
                activeTab === "auth_funcs" 
                  ? "bg-indigo-600/10 border border-indigo-500/30 text-indigo-400" 
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
              }`}
            >
              <Key className="h-4 w-4" />
              Auth Hook Functions
            </button>
          </nav>
        </div>

        {/* User Info Block */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-900/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="h-9 w-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
                <User className="h-4 w-4 text-slate-400" />
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-semibold text-slate-200 truncate">{user?.name}</p>
                <p className="text-[10px] text-slate-500 truncate">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Logout"
            >
              <LogOut className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Workspace Frame */}
      <div className="flex-grow flex flex-col overflow-hidden">
        
        {/* Header Block */}
        <header className="h-16 flex items-center justify-between px-8 border-b border-slate-800/80 bg-slate-900/20 backdrop-blur-md">
          <h2 className="text-lg font-bold tracking-tight text-slate-200">
            {activeTab === "api" && "API Automation Engine"}
            {activeTab === "web" && "Web Automation & POM Generator"}
            {activeTab === "envs" && "Workspace Environments"}
            {activeTab === "auth_funcs" && "Dynamic Authentication Hooks"}
          </h2>

          {/* Context Selector */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Env:</span>
              <select
                value={selectedEnvId}
                onChange={(e) => setSelectedEnvId(e.target.value)}
                className="bg-slate-900/80 border border-slate-850 hover:border-slate-700 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 text-slate-300"
              >
                <option value="">No Active Environment</option>
                {environments.map(env => (
                  <option key={env.id} value={env.id}>{env.name}</option>
                ))}
              </select>
            </div>
          </div>
        </header>

        {/* Dynamic Inner Tab Views */}
        <main className="flex-grow overflow-hidden relative">
          
          {/* ==================== TAB: API EXPLORER ==================== */}
          {activeTab === "api" && (
            <div className="h-full flex overflow-hidden">
              
              {/* Collection Left Sidebar */}
              <div className="w-72 border-r border-slate-850 bg-slate-900/10 flex-shrink-0 flex flex-col">
                <div className="p-4 border-b border-slate-850 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Collections</span>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCreateCollection}
                      className="p-1 rounded bg-slate-800 border border-slate-700 hover:bg-slate-750 text-indigo-400"
                      title="New Collection"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        const cid = prompt("Paste shared Collection ID to import:");
                        if (cid) {
                          setImportCollectionId(cid);
                          setTimeout(() => handleImportCollection(), 100);
                        }
                      }}
                      className="p-1 rounded bg-slate-800 border border-slate-700 hover:bg-slate-750 text-indigo-400"
                      title="Import Shared Collection"
                    >
                      <Share2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Import / Share bar */}
                <div className="px-4 py-2 border-b border-slate-850 flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter Collection ID"
                    value={importCollectionId}
                    onChange={(e) => setImportCollectionId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1 text-xs focus:outline-none"
                  />
                  <button 
                    onClick={handleImportCollection}
                    className="px-2 py-1 bg-indigo-600 text-xs rounded font-medium"
                  >
                    Import
                  </button>
                </div>

                {/* Collections list */}
                <div className="flex-grow overflow-y-auto p-4 space-y-4">
                  {collections.map(col => (
                    <div key={col.id} className="space-y-1.5">
                      <div className="flex items-center justify-between group">
                        <span className="text-xs font-semibold text-indigo-400 truncate max-w-[160px]">{col.name}</span>
                        <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => {
                              setSelectedCollectionId(col.id);
                              setShowShareModal(true);
                            }}
                            className="p-1 text-slate-400 hover:text-indigo-400"
                            title="Share Collection ID"
                          >
                            <Share2 className="h-3 w-3" />
                          </button>
                          <button
                            onClick={handleCreateRequest}
                            className="p-1 text-slate-400 hover:text-indigo-400"
                            title="Add Request"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      {/* Request nodes */}
                      <div className="pl-3 border-l border-slate-800/80 space-y-1">
                        {col.requests.map(req => (
                          <button
                            key={req.id}
                            onClick={() => {
                              setSelectedCollectionId(col.id);
                              setSelectedRequestId(req.id);
                            }}
                            className={`w-full flex items-center justify-between text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                              selectedRequestId === req.id 
                                ? "bg-slate-800 text-white" 
                                : "text-slate-400 hover:bg-slate-900/60 hover:text-slate-200"
                            }`}
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <span className={`text-[9px] font-extrabold px-1 py-0.5 rounded leading-none ${
                                req.method === "GET" && "bg-emerald-500/10 text-emerald-400"
                              } ${
                                req.method === "POST" && "bg-blue-500/10 text-blue-400"
                              } ${
                                req.method === "PUT" && "bg-amber-500/10 text-amber-400"
                              } ${
                                req.method === "DELETE" && "bg-red-500/10 text-red-400"
                              }`}>
                                {req.method}
                              </span>
                              <span className="truncate">{req.name}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* API Request Composer and Runner Workspace */}
              <div className="flex-grow flex flex-col overflow-hidden bg-slate-950">
                {selectedRequestId ? (
                  <div className="flex-grow flex flex-col overflow-hidden">
                    
                    {/* URL Bar */}
                    <div className="p-4 border-b border-slate-850 flex gap-2">
                      <select
                        value={reqMethod}
                        onChange={(e) => setReqMethod(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-bold text-slate-300"
                      >
                        <option>GET</option>
                        <option>POST</option>
                        <option>PUT</option>
                        <option>DELETE</option>
                        <option>PATCH</option>
                      </select>
                      <input
                        type="text"
                        value={reqUrl}
                        onChange={(e) => setReqUrl(e.target.value)}
                        placeholder="http://{{BASE_URL}}/api/endpoint"
                        className="flex-grow bg-slate-900/60 border border-slate-850 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/50"
                      />
                      <button
                        onClick={handleExecuteRequest}
                        disabled={isExecutingApi}
                        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 rounded-lg px-4.5 py-2 text-xs font-bold shadow-lg shadow-indigo-600/20"
                      >
                        {isExecutingApi ? <RefreshCw className="h-4.5 w-4.5 animate-spin" /> : <Play className="h-4 w-4" />}
                        Send
                      </button>
                      <button
                        onClick={handleSaveRequest}
                        className="bg-slate-850 hover:bg-slate-805 border border-slate-700 text-xs px-3.5 rounded-lg"
                      >
                        Save
                      </button>
                    </div>

                    {/* Editor Split screen (Top: Composer parameters, Bottom: Response panel) */}
                    <div className="flex-grow flex flex-col overflow-y-auto p-4 space-y-4">
                      
                      {/* Section: Params & Config */}
                      <div className="border border-slate-850 rounded-xl bg-slate-900/10 p-4 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-850 pb-2">
                          <span className="text-xs font-bold text-slate-400">Request Configuration</span>
                          <input
                            type="text"
                            value={reqName}
                            onChange={(e) => setReqName(e.target.value)}
                            className="bg-slate-950 border border-slate-850 text-xs px-2.5 py-1 rounded"
                            title="Request Name"
                          />
                        </div>

                        {/* Config tabs: Headers, Query, Body, Auth */}
                        <div className="space-y-4">
                          
                          {/* Headers */}
                          <div>
                            <span className="text-xs font-semibold text-slate-400">Headers</span>
                            <div className="mt-1.5 space-y-2">
                              {reqHeaders.map((h, idx) => (
                                <div key={idx} className="flex gap-2">
                                  <input
                                    type="text"
                                    placeholder="Header Name"
                                    value={h.key}
                                    onChange={(e) => handleKVChange(reqHeaders, setReqHeaders, idx, "key", e.target.value)}
                                    className="w-1/2 bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs"
                                  />
                                  <input
                                    type="text"
                                    placeholder="Header Value"
                                    value={h.value}
                                    onChange={(e) => handleKVChange(reqHeaders, setReqHeaders, idx, "value", e.target.value)}
                                    className="w-1/2 bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs"
                                  />
                                  <button
                                    onClick={() => handleKVRemove(reqHeaders, setReqHeaders, idx)}
                                    className="text-slate-500 hover:text-red-400 p-1"
                                  >
                                    <Trash className="h-4 w-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Body config */}
                          <div className="flex gap-4">
                            <div className="w-1/3">
                              <span className="text-xs font-semibold text-slate-400">Body Type</span>
                              <select
                                value={reqBodyType}
                                onChange={(e) => setReqBodyType(e.target.value)}
                                className="w-full mt-1.5 bg-slate-950 border border-slate-850 rounded px-2 py-1.5 text-xs"
                              >
                                <option>NONE</option>
                                <option>JSON</option>
                                <option>FORM</option>
                                <option>RAW</option>
                              </select>
                            </div>

                            <div className="w-2/3">
                              <span className="text-xs font-semibold text-slate-400">Auth Method</span>
                              <div className="flex gap-2 mt-1.5">
                                <select
                                  value={reqAuthType}
                                  onChange={(e) => setReqAuthType(e.target.value)}
                                  className="w-1/2 bg-slate-950 border border-slate-850 rounded px-2 py-1.5 text-xs"
                                >
                                  <option>NONE</option>
                                  <option>BEARER</option>
                                  <option>API_KEY</option>
                                  <option>HOOK</option>
                                </select>

                                {/* Auth params config */}
                                {reqAuthType === "BEARER" && (
                                  <input
                                    type="text"
                                    placeholder="Token (or {{VARIABLE}})"
                                    value={reqAuthConfig.token || ""}
                                    onChange={(e) => setReqAuthConfig({ ...reqAuthConfig, token: e.target.value })}
                                    className="w-1/2 bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs"
                                  />
                                )}
                                {reqAuthType === "API_KEY" && (
                                  <div className="w-1/2 flex gap-1">
                                    <input
                                      type="text"
                                      placeholder="Key"
                                      value={reqAuthConfig.key || ""}
                                      onChange={(e) => setReqAuthConfig({ ...reqAuthConfig, key: e.target.value })}
                                      className="w-1/2 bg-slate-950 border border-slate-850 rounded px-2 py-1 text-xs"
                                    />
                                    <input
                                      type="text"
                                      placeholder="Value"
                                      value={reqAuthConfig.value || ""}
                                      onChange={(e) => setReqAuthConfig({ ...reqAuthConfig, value: e.target.value })}
                                      className="w-1/2 bg-slate-950 border border-slate-850 rounded px-2 py-1 text-xs"
                                    />
                                  </div>
                                )}
                                {reqAuthType === "HOOK" && (
                                  <select
                                    value={reqAuthConfig.authFunctionId || ""}
                                    onChange={(e) => setReqAuthConfig({ ...reqAuthConfig, authFunctionId: e.target.value })}
                                    className="w-1/2 bg-slate-950 border border-slate-850 rounded px-2 py-1.5 text-xs"
                                  >
                                    <option value="">Select Auth Hook</option>
                                    {authFunctions.map(func => (
                                      <option key={func.id} value={func.id}>{func.name}</option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Body Content Editor */}
                          {reqBodyType !== "NONE" && (
                            <div>
                              <span className="text-xs font-semibold text-slate-400">Request Body</span>
                              <textarea
                                value={reqBody}
                                onChange={(e) => setReqBody(e.target.value)}
                                placeholder='{\n  "key": "value"\n}'
                                className="w-full h-24 mt-1.5 bg-slate-950 border border-slate-850 rounded p-2 text-xs font-mono focus:outline-none"
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Section: Response parser script & AI Agent */}
                      <div className="border border-slate-850 rounded-xl bg-slate-900/10 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Cpu className="h-4 w-4 text-indigo-400" />
                            <span className="text-xs font-bold text-slate-400">Variable Response Extractor (JS)</span>
                          </div>
                          
                          <button
                            onClick={() => setShowAiModal(true)}
                            className="flex items-center gap-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 rounded px-2.5 py-1 text-xs font-semibold text-indigo-400 transition-all"
                          >
                            <Cpu className="h-3.5 w-3.5 animate-pulse" />
                            AI Parser Agent
                          </button>
                        </div>
                        
                        <textarea
                          value={reqParserScript}
                          onChange={(e) => setReqParserScript(e.target.value)}
                          placeholder="// Set dynamic variables using: vars.set('var_name', response.body.token);"
                          className="w-full h-28 bg-slate-950 border border-slate-850 rounded p-2.5 text-xs font-mono focus:outline-none focus:border-slate-800"
                        />
                      </div>

                      {/* Section: API Output Response panel */}
                      {apiResponse && (
                        <div className="border border-slate-850 rounded-xl bg-slate-900/10 p-4 space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-850 pb-2">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-bold text-slate-400">Response Panel</span>
                              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                                apiResponse.status < 300 ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                              }`}>
                                {apiResponse.status} {apiResponse.statusText}
                              </span>
                              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                                {apiResponse.executionTimeMs} ms
                              </span>
                            </div>
                            
                            <div className="flex gap-2">
                              {(["pretty", "headers", "raw", "extracted"] as const).map(t => (
                                <button
                                  key={t}
                                  onClick={() => setResponseTab(t)}
                                  className={`text-xs font-semibold px-2 py-1 rounded ${
                                    responseTab === t ? "bg-slate-850 text-white" : "text-slate-500 hover:text-slate-300"
                                  }`}
                                >
                                  {t === "extracted" ? "Parsed Variables" : t}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Content */}
                          <div className="max-h-72 overflow-y-auto bg-slate-950 border border-slate-900 rounded-lg p-3 text-xs font-mono">
                            {responseTab === "pretty" && (
                              <pre className="text-emerald-400/90 leading-relaxed">
                                {typeof apiResponse.body === "object" 
                                  ? JSON.stringify(apiResponse.body, null, 2) 
                                  : apiResponse.body}
                              </pre>
                            )}
                            {responseTab === "raw" && (
                              <pre className="text-slate-300">
                                {typeof apiResponse.body === "object" ? JSON.stringify(apiResponse.body) : apiResponse.body}
                              </pre>
                            )}
                            {responseTab === "headers" && (
                              <div className="space-y-1">
                                {Object.entries(apiResponse.headers).map(([k, v]) => (
                                  <div key={k} className="flex">
                                    <span className="text-indigo-400 font-semibold w-1/3 truncate">{k}:</span>
                                    <span className="text-slate-300 w-2/3 break-all">{v as string}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {responseTab === "extracted" && (
                              <div className="space-y-2">
                                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Captured Variables:</div>
                                {Object.keys(apiResponse.parsedVariables).length ? (
                                  Object.entries(apiResponse.parsedVariables).map(([k, v]) => (
                                    <div key={k} className="flex items-center gap-2 bg-slate-900/60 border border-slate-850 px-3 py-2 rounded-lg">
                                      <span className="text-indigo-400 font-semibold">{k}:</span>
                                      <span className="text-slate-300">{v as string}</span>
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-slate-500 italic">No variables extracted. Configure your Parser Script.</div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-500 text-sm">
                    Select a request from the sidebar collections to begin testing.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ==================== TAB: WEB EXPLORER ==================== */}
          {activeTab === "web" && (
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
                    className="flex-grow bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs"
                    disabled={!isBrowserConnected}
                  />
                  {isBrowserConnected ? (
                    <>
                      <button
                        onClick={handleBrowserNavigate}
                        className="bg-indigo-600 hover:bg-indigo-500 text-xs px-3 py-1.5 rounded font-semibold transition-all"
                      >
                        Go
                      </button>
                      <button
                        onClick={handleToggleInspect}
                        className={`text-xs px-3 py-1.5 rounded font-semibold transition-all flex items-center gap-1.5 ${
                          inspectMode 
                            ? "bg-amber-600 hover:bg-amber-500 border border-amber-500/20" 
                            : "bg-slate-800 border border-slate-700 hover:bg-slate-750"
                        }`}
                      >
                        {inspectMode ? <Eye className="h-4 w-4 animate-pulse text-white" /> : <EyeOff className="h-4 w-4" />}
                        Inspect Target
                      </button>
                      <button
                        onClick={handleDisconnectBrowser}
                        className="bg-red-950/40 hover:bg-red-900/40 border border-red-900/30 text-red-400 text-xs px-3 py-1.5 rounded font-semibold transition-all"
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleStartBrowser}
                      className="bg-indigo-600 hover:bg-indigo-500 text-xs px-4 py-1.5 rounded font-semibold transition-all shadow-md shadow-indigo-600/10"
                    >
                      Connect VNC Browser
                    </button>
                  )}
                </div>

                {/* POM Class Tabs Selector */}
                {isBrowserConnected && (
                  <div className="flex items-center gap-2 border-l border-slate-800 pl-4">
                    <span className="text-xs font-semibold text-slate-400">Class POM:</span>
                    <select
                      value={activePomClass}
                      onChange={(e) => {
                        setActivePomClass(e.target.value);
                        setTimeout(() => updateGeneratedPomCode(), 100);
                      }}
                      className="bg-slate-950 border border-slate-850 text-xs rounded px-2 py-1 focus:outline-none"
                    >
                      {pomClasses.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setShowNewClassModal(true)}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-400"
                      title="New Page Object Class"
                    >
                      <Plus className="h-4.5 w-4.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Main panels: Split (Left: VNC canvas browser, Right: Code editor and selector analyzer) */}
              <div className="flex-grow flex overflow-hidden">
                {isBrowserConnected ? (
                  <div className="flex-grow flex overflow-hidden">
                    
                    {/* Embedded VNC/noVNC browser iframe */}
                    <div className="w-1/2 h-full bg-slate-950 border-r border-slate-850 flex flex-col justify-center items-center relative">
                      <iframe
                        src={vncUrl}
                        className="w-full h-full border-none bg-black"
                        title="Embedded VNC Browser Client"
                      />
                      
                      {inspectMode && (
                        <div className="absolute top-3 left-3 bg-amber-600/90 text-white font-bold text-[10px] px-2.5 py-1 rounded-md shadow-lg flex items-center gap-2 border border-amber-500/20 backdrop-blur-sm animate-pulse z-50">
                          <Eye className="h-3.5 w-3.5" />
                          INSPECTOR ACTIVE: CLICK TARGET ELEMENT ON FRAME TO CAPTURE LOCATORS
                        </div>
                      )}
                    </div>

                    {/* Right side drawers: tabs */}
                    <div className="w-1/2 h-full flex flex-col overflow-hidden bg-slate-950">
                      
                      {/* Code and selectors inspector split */}
                      <div className="h-2/5 border-b border-slate-850 flex flex-col overflow-hidden">
                        
                        {/* Selector analyzer (when inspect clicked) */}
                        <div className="flex-grow overflow-y-auto p-4 space-y-4">
                          {selectedElement ? (
                            <div className="space-y-3.5">
                              <div className="flex items-center justify-between border-b border-slate-850 pb-1.5">
                                <span className="text-xs font-bold text-amber-400">Captured DOM Node: &lt;{selectedElement.tagName}&gt;</span>
                                <span className="text-[10px] text-slate-500">Stability weight calculation</span>
                              </div>

                              <div className="flex gap-2 items-center">
                                <div className="w-1/2">
                                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Method Name</span>
                                  <input
                                    type="text"
                                    value={selectedElementMethodName}
                                    onChange={(e) => setSelectedElementMethodName(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-850 rounded px-2 py-1 text-xs text-white"
                                  />
                                </div>
                                <div className="w-1/2">
                                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Action</span>
                                  <select
                                    value={selectedElementAction}
                                    onChange={(e) => setSelectedElementAction(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-850 rounded px-2 py-1 text-xs text-white"
                                  >
                                    <option value="click">Click</option>
                                    <option value="fill">Fill (Input Text)</option>
                                    <option value="hover">Hover</option>
                                    <option value="check">Check (Checkbox)</option>
                                  </select>
                                </div>
                              </div>

                              {/* Locators list */}
                              <div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Ranked Locators</span>
                                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                                  {selectedElementLocators.map((loc, idx) => (
                                    <div key={idx} className="flex items-center justify-between bg-slate-900 border border-slate-850/80 px-2.5 py-1.5 rounded-lg text-xs font-mono">
                                      <div className="flex flex-col">
                                        <span className="text-[9px] text-slate-500 font-semibold uppercase">{loc.strategy} (Score: {loc.score})</span>
                                        <span className="text-slate-200">{loc.statement}</span>
                                      </div>
                                      
                                      {idx === 0 && (
                                        <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-bold px-1.5 py-0.5 rounded">
                                          Best Rank
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <button
                                onClick={handleAddNewPomElement}
                                className="w-full bg-indigo-600 hover:bg-indigo-500 text-xs py-2 rounded-lg font-bold transition-all"
                              >
                                Append Element to {activePomClass} POM
                              </button>
                            </div>
                          ) : (
                            <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs italic gap-1.5 text-center">
                              <Eye className="h-5 w-5 text-indigo-400/40" />
                              <span>Toggle Inspect Mode and click any button, link, or textbox on the browser frame to capture element locators automatically.</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Output code viewer / Network logs tabs */}
                      <div className="h-3/5 flex flex-col overflow-hidden bg-slate-950">
                        <div className="flex border-b border-slate-850 bg-slate-900/10">
                          <button
                            onClick={() => setActiveGenCodeTab("pom")}
                            className={`px-4 py-2 text-xs font-semibold border-r border-slate-850 flex items-center gap-1.5 ${
                              activeGenCodeTab === "pom" ? "bg-slate-950 text-white" : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <FileCode className="h-4 w-4 text-indigo-400" />
                            {activePomClass}.py Code
                          </button>
                          
                          <button
                            onClick={() => setActiveGenCodeTab("client")}
                            className={`px-4 py-2 text-xs font-semibold border-r border-slate-850 flex items-center gap-1.5 ${
                              activeGenCodeTab === "client" ? "bg-slate-950 text-white" : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <Terminal className="h-4 w-4 text-indigo-400" />
                            HTTP Client code
                          </button>

                          <button
                            onClick={() => setActiveGenCodeTab("pom")} // Placeholder tab trigger
                            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 flex-grow text-right pr-4"
                          >
                            {/* Actions bar */}
                            <span 
                              onClick={() => {
                                const code = activeGenCodeTab === "pom" ? generatedPomCode : generatedClientCode;
                                if(code) downloadTextFile(code, activeGenCodeTab === "pom" ? `${activePomClass}.py` : "http_client.py");
                              }}
                              className="text-xs text-indigo-400 font-semibold hover:underline cursor-pointer"
                            >
                              Download Asset
                            </span>
                          </button>
                        </div>

                        {/* Editor content */}
                        <div className="flex-grow overflow-hidden relative">
                          {activeGenCodeTab === "pom" && (
                            <Editor
                              height="100%"
                              defaultLanguage="python"
                              theme="vs-dark"
                              value={generatedPomCode}
                              options={{ readOnly: true, minimap: { enabled: false } }}
                            />
                          )}

                          {activeGenCodeTab === "client" && (
                            <div className="h-full flex flex-col overflow-hidden">
                              {/* If no code, render network selector */}
                              {!generatedClientCode ? (
                                <div className="h-full flex flex-col overflow-hidden p-4 space-y-4">
                                  <div className="flex items-center justify-between border-b border-slate-850 pb-2">
                                    <span className="text-xs font-bold text-slate-400">Generate Client: Select endpoints to group</span>
                                    <button
                                      onClick={handleGenerateHttpClient}
                                      className="bg-indigo-600 hover:bg-indigo-500 text-xs px-3 py-1.5 rounded font-semibold transition-all"
                                    >
                                      Compile Client
                                    </button>
                                  </div>

                                  <div className="flex gap-2">
                                    <input
                                      type="text"
                                      placeholder="Base API URL Filter (e.g. https://api.example.com)"
                                      value={clientBaseUrl}
                                      onChange={(e) => setClientBaseUrl(e.target.value)}
                                      className="w-full bg-slate-900 border border-slate-850 rounded px-2 py-1.5 text-xs text-white"
                                    />
                                  </div>

                                  {/* Logs select grid */}
                                  <div className="flex-grow overflow-y-auto space-y-2 border border-slate-850 rounded p-2">
                                    {filteredNetworkLogs.map(log => (
                                      <div key={log.id} className="flex items-center gap-2 bg-slate-900/60 p-2 rounded text-xs font-mono">
                                        <input
                                          type="checkbox"
                                          checked={selectedLogsForClient.includes(log.id)}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setSelectedLogsForClient(prev => [...prev, log.id]);
                                            } else {
                                              setSelectedLogsForClient(prev => prev.filter(x => x !== log.id));
                                            }
                                          }}
                                        />
                                        <span className={`text-[9px] font-bold px-1 rounded ${
                                          log.method === "GET" ? "bg-emerald-500/10 text-emerald-400" : "bg-blue-500/10 text-blue-400"
                                        }`}>{log.method}</span>
                                        <span className="truncate flex-grow text-slate-300">{log.url}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="h-full flex flex-col">
                                  <div className="flex justify-end p-2 border-b border-slate-900 bg-slate-900/20">
                                    <button 
                                      onClick={() => setGeneratedClientCode("")}
                                      className="text-xs text-slate-400 hover:text-indigo-400"
                                    >
                                      Reset and Reselect Logs
                                    </button>
                                  </div>
                                  <div className="flex-grow overflow-hidden">
                                    <Editor
                                      height="100%"
                                      defaultLanguage="python"
                                      theme="vs-dark"
                                      value={generatedClientCode}
                                      options={{ readOnly: true, minimap: { enabled: false } }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-500 text-sm gap-2">
                    <Globe className="h-5 w-5 animate-pulse text-indigo-500" />
                    Click "Connect VNC Browser" above to load the interactive web test automation stream.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ==================== TAB: ENVIRONMENTS ==================== */}
          {activeTab === "envs" && (
            <div className="h-full overflow-y-auto p-8 space-y-6">
              <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-200">Variable Environments</h3>
                  <p className="text-xs text-slate-500">Manage scopes for environment variables and base URLs substituted inside request parameters.</p>
                </div>
                <button
                  onClick={openEnvCreate}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-xs px-3.5 py-2 rounded-lg font-bold transition-all shadow-md shadow-indigo-600/10"
                >
                  <Plus className="h-4 w-4" />
                  Create Environment
                </button>
              </div>

              {/* Environments grids */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {environments.map(env => (
                  <div key={env.id} className="border border-slate-850 rounded-2xl bg-slate-900/40 p-5 space-y-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between border-b border-slate-850 pb-2.5">
                        <span className="font-bold text-slate-200">{env.name}</span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => openEnvEdit(env)}
                            className="text-xs text-indigo-400 hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteEnv(env.id)}
                            className="text-xs text-red-400 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      {/* Variables list */}
                      <div className="mt-4 space-y-2 max-h-48 overflow-y-auto font-mono text-[11px] text-slate-400">
                        {env.variables.length ? (
                          env.variables.map((v, idx) => (
                            <div key={idx} className="flex justify-between bg-slate-950/60 p-2 rounded border border-slate-900">
                              <span className="text-indigo-400 font-semibold truncate max-w-[120px]">{v.key}:</span>
                              <span className="text-slate-300 truncate max-w-[120px]" title={v.value}>
                                {v.isSecret ? "••••••••" : v.value}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="text-slate-500 italic">No variables defined.</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ==================== TAB: AUTH HOOKS ==================== */}
          {activeTab === "auth_funcs" && (
            <div className="h-full overflow-y-auto p-8 space-y-6">
              <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-200">Self-Refreshing Auth Functions</h3>
                  <p className="text-xs text-slate-500">Create sandboxed JS snippets to call APIs, get authorization tokens, and keep JWTs active in the background.</p>
                </div>
                <button
                  onClick={openAuthFuncCreate}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-xs px-3.5 py-2 rounded-lg font-bold transition-all shadow-md shadow-indigo-600/10"
                >
                  <Plus className="h-4 w-4" />
                  Create Auth Function
                </button>
              </div>

              {/* Grid lists */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {authFunctions.map(func => (
                  <div key={func.id} className="border border-slate-850 rounded-2xl bg-slate-900/40 p-5 space-y-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between border-b border-slate-850 pb-2.5">
                        <span className="font-bold text-slate-200">{func.name}</span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => openAuthFuncEdit(func)}
                            className="text-xs text-indigo-400 hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteAuthFunc(func.id)}
                            className="text-xs text-red-400 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-slate-400 mt-2">{func.description || "No description provided."}</p>

                      <div className="mt-4 bg-slate-950 p-3 rounded-lg border border-slate-900 max-h-40 overflow-y-auto font-mono text-[11px] text-slate-400">
                        <pre className="text-slate-300 leading-relaxed">{func.script}</pre>
                      </div>
                    </div>

                    <div className="text-[10px] text-slate-500 font-semibold border-t border-slate-850/80 pt-3 flex items-center justify-between">
                      <span>Token Status:</span>
                      <span className={func.cachedToken ? "text-emerald-400" : "text-amber-400"}>
                        {func.cachedToken ? "Cached Token Active" : "No Token Cached"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ==================== MODALS ==================== */}

      {/* MODAL: Share Collection */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-850 rounded-2xl p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-200">Share Collection</h3>
            <p className="text-xs text-slate-400">Share this unique ID with your colleague so they can import this workspace. Any edits will sync in real-time.</p>
            
            <div className="bg-slate-950 border border-slate-850 rounded px-3 py-2 text-xs text-indigo-400 font-mono select-all flex items-center justify-between">
              <span>{selectedCollectionId}</span>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(selectedCollectionId);
                  alert("Collection ID copied to clipboard!");
                }}
                className="text-slate-400 hover:text-white"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Invite Collaborator Email</span>
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="collaborator@lixionary.com"
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                  className="flex-grow bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs text-white"
                />
                <button
                  onClick={handleAddCollaborator}
                  className="bg-indigo-600 hover:bg-indigo-500 text-xs px-3 rounded font-semibold"
                >
                  Share
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowShareModal(false)}
                className="bg-slate-800 hover:bg-slate-750 text-xs px-4 py-2 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Manage Environment */}
      {showEnvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-850 rounded-2xl p-6 space-y-4 max-h-[85vh] flex flex-col">
            <h3 className="text-sm font-bold text-slate-200">{editingEnvId ? "Edit Environment" : "Create Environment"}</h3>
            
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Environment Name</span>
              <input
                type="text"
                placeholder="e.g. Staging"
                value={envModalName}
                onChange={(e) => setEnvModalName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs text-white"
              />
            </div>

            <div className="flex-grow overflow-y-auto space-y-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Variables</span>
              {envModalVariables.map((v, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Key"
                    value={v.key}
                    onChange={(e) => handleKVChange(envModalVariables, setEnvModalVariables, idx, "key", e.target.value)}
                    className="w-2/5 bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs text-white"
                  />
                  <input
                    type="text"
                    placeholder="Value"
                    value={v.value}
                    onChange={(e) => handleKVChange(envModalVariables, setEnvModalVariables, idx, "value", e.target.value)}
                    className="w-2/5 bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs text-white"
                  />
                  <label className="flex items-center gap-1 text-[10px] text-slate-400 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={v.isSecret}
                      onChange={(e) => handleKVChange(envModalVariables, setEnvModalVariables, idx, "isSecret", e.target.checked)}
                    />
                    Secret
                  </label>
                  <button
                    onClick={() => handleKVRemove(envModalVariables, setEnvModalVariables, idx)}
                    className="text-slate-500 hover:text-red-400 p-1"
                  >
                    <Trash className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/80">
              <button
                onClick={() => setShowEnvModal(false)}
                className="bg-slate-805 hover:bg-slate-800 text-xs px-4 py-2 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEnv}
                className="bg-indigo-600 hover:bg-indigo-500 text-xs px-4 py-2 rounded-lg font-bold"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Manage Auth Function */}
      {showAuthFuncModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-850 rounded-2xl p-6 space-y-4 max-h-[85vh] flex flex-col">
            <h3 className="text-sm font-bold text-slate-200">{editingAuthFuncId ? "Edit Auth Function" : "Create Auth Function"}</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Hook Name</span>
                <input
                  type="text"
                  placeholder="e.g. JWT Refresh"
                  value={authFuncName}
                  onChange={(e) => setAuthFuncName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Description</span>
                <input
                  type="text"
                  placeholder="Acquires fresh access credentials"
                  value={authFuncDesc}
                  onChange={(e) => setAuthFuncDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs text-white"
                />
              </div>
            </div>

            <div className="flex-grow flex flex-col space-y-1 overflow-hidden">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Sandbox Script (JS)</span>
              <div className="flex-grow border border-slate-850 rounded-lg overflow-hidden">
                <Editor
                  height="260px"
                  defaultLanguage="javascript"
                  theme="vs-dark"
                  value={authFuncScript}
                  onChange={(val) => setAuthFuncScript(val || "")}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/80">
              <button
                onClick={() => setShowAuthFuncModal(false)}
                className="bg-slate-805 hover:bg-slate-800 text-xs px-4 py-2 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAuthFunc}
                className="bg-indigo-600 hover:bg-indigo-500 text-xs px-4 py-2 rounded-lg font-bold"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: AI Prompt parser */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-850 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-indigo-400">
              <Cpu className="h-5 w-5 animate-pulse" />
              <h3 className="text-sm font-bold text-slate-200 font-sans">Lixionary AI Response Mapper</h3>
            </div>
            
            <p className="text-xs text-slate-400">Instruct the AI agent to map properties from the active response payload into your environment context.</p>
            
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Instruction Prompt</span>
              <textarea
                placeholder='e.g. Extract the token value from data.user.access_token and save it to access_token variable'
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                className="w-full h-24 bg-slate-950 border border-slate-850 rounded p-2.5 text-xs text-white focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setShowAiModal(false);
                  setAiPrompt("");
                }}
                className="bg-slate-850 hover:bg-slate-800 text-xs px-4 py-2 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateAiParser}
                disabled={isGeneratingAiParser}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-850 text-xs px-4 py-2 rounded-lg font-bold"
              >
                {isGeneratingAiParser ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Generate script
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Web Explorer: Add New Class */}
      {showNewClassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-850 rounded-2xl p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-200">New Page Object Class</h3>
            
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Class Name</span>
              <input
                type="text"
                placeholder="e.g. AdminDashboardPage"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs text-white"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setShowNewClassModal(false);
                  setNewClassName("");
                }}
                className="bg-slate-850 hover:bg-slate-800 text-xs px-4 py-2 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleAddNewPomClass}
                className="bg-indigo-600 hover:bg-indigo-500 text-xs px-4 py-2 rounded-lg font-bold"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
