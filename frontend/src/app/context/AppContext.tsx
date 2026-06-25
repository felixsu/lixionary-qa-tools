"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Types
export interface Environment {
  id: string;
  name: string;
  variables: { key: string; value: string; isSecret: boolean }[];
}

export interface AuthFunction {
  id: string;
  name: string;
  description: string;
  script: string;
  cachedToken?: string;
  expiresAt?: string;
}

export interface RequestItem {
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

export interface Collection {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  collaboratorIds: string[];
  requests: RequestItem[];
}

export interface NetworkLog {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  resourceType: string;
  status: number | null;
  statusText: string;
}

export interface NetworkDetails {
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

export interface RecordedElement {
  element_id: string;
  method_name: string;
  strategy: string;
  selector: string;
  action: string;
}

export interface BrowserProfile {
  id: string;
  name: string;
  cookies: string;
  localStorage: string;
  createdAt: string;
}

interface AppContextType {
  // Auth State
  token: string | null;
  user: any;
  isLoadingAuth: boolean;
  handleLogin: (email: string) => Promise<void>;
  handleGuestLogin: () => Promise<void>;
  handleLogout: () => void;

  // Databases & Shared States
  environments: Environment[];
  selectedEnvId: string;
  setSelectedEnvId: (id: string) => void;
  fetchEnvironments: () => Promise<void>;
  authFunctions: AuthFunction[];
  fetchAuthFunctions: () => Promise<void>;
  collections: Collection[];
  selectedCollectionId: string;
  setSelectedCollectionId: (id: string) => void;
  selectedRequestId: string;
  setSelectedRequestId: (id: string) => void;
  fetchCollections: () => Promise<void>;

  // API Explorer Active Request Editor State
  reqName: string;
  setReqName: (name: string) => void;
  reqMethod: string;
  setReqMethod: (method: string) => void;
  reqUrl: string;
  setReqUrl: (url: string) => void;
  reqHeaders: { key: string; value: string }[];
  setReqHeaders: React.Dispatch<React.SetStateAction<{ key: string; value: string }[]>>;
  reqQueryParams: { key: string; value: string }[];
  setReqQueryParams: React.Dispatch<React.SetStateAction<{ key: string; value: string }[]>>;
  reqBodyType: string;
  setReqBodyType: (type: string) => void;
  reqBody: string;
  setReqBody: (body: string) => void;
  reqAuthType: string;
  setReqAuthType: (type: string) => void;
  reqAuthConfig: any;
  setReqAuthConfig: (config: any) => void;
  reqParserScript: string;
  setReqParserScript: (script: string) => void;

  // API Explorer Response State
  apiResponse: any;
  setApiResponse: (res: any) => void;
  isExecutingApi: boolean;
  setIsExecutingApi: (executing: boolean) => void;
  responseTab: "pretty" | "headers" | "raw" | "extracted";
  setResponseTab: (tab: "pretty" | "headers" | "raw" | "extracted") => void;
  showAiModal: boolean;
  setShowAiModal: (show: boolean) => void;
  aiPrompt: string;
  setAiPrompt: (prompt: string) => void;
  isGeneratingAiParser: boolean;
  setIsGeneratingAiParser: (generating: boolean) => void;

  // Web Explorer State
  browserUrl: string;
  setBrowserUrl: (url: string) => void;
  isBrowserConnected: boolean;
  setIsBrowserConnected: (connected: boolean) => void;
  inspectMode: boolean;
  setInspectMode: (inspect: boolean) => void;
  vncUrl: string;
  setVncUrl: (url: string) => void;
  sessionId: string;
  setSessionId: (id: string) => void;
  networkLogs: NetworkLog[];
  setNetworkLogs: React.Dispatch<React.SetStateAction<NetworkLog[]>>;
  networkFilter: string;
  setNetworkFilter: (filter: string) => void;
  selectedLogId: string | null;
  setSelectedLogId: (id: string | null) => void;
  logDetails: NetworkDetails | null;
  setLogDetails: (details: NetworkDetails | null) => void;
  activePomClass: string;
  setActivePomClass: (className: string) => void;
  pomClasses: string[];
  setPomClasses: React.Dispatch<React.SetStateAction<string[]>>;
  pomElements: Record<string, RecordedElement[]>;
  setPomElements: React.Dispatch<React.SetStateAction<Record<string, RecordedElement[]>>>;
  selectedElement: any;
  setSelectedElement: (el: any) => void;
  selectedElementLocators: any[];
  setSelectedElementLocators: (locators: any[]) => void;
  selectedElementAction: string;
  setSelectedElementAction: (action: string) => void;
  selectedElementMethodName: string;
  setSelectedElementMethodName: (name: string) => void;
  activeGenCodeTab: "pom" | "client";
  setActiveGenCodeTab: (tab: "pom" | "client") => void;
  generatedPomCode: string;
  setGeneratedPomCode: (code: string) => void;
  generatedClientCode: string;
  setGeneratedClientCode: (code: string) => void;
  selectedLogsForClient: string[];
  setSelectedLogsForClient: React.Dispatch<React.SetStateAction<string[]>>;
  clientBaseUrl: string;
  setClientBaseUrl: (url: string) => void;

  // Browser Profiles State
  profiles: BrowserProfile[];
  fetchProfiles: () => Promise<void>;
  selectedProfileId: string;
  setSelectedProfileId: (id: string) => void;

  // Common operations
  apiCall: (path: string, options?: RequestInit) => Promise<any>;
  handleBrowserNavigate: () => void;
  handleToggleInspect: () => void;
  handlePasteText: (text: string) => void;
  connectBrowserSession: (sessId: string, profileId?: string) => void;
  handleStartBrowser: (profileId?: string) => void;
  handleDisconnectBrowser: () => void;
  fetchNetworkLogs: (sessId: string) => Promise<void>;
  handleLogClick: (logId: string) => Promise<void>;
  handleExecuteRequest: () => Promise<void>;
  handleSaveRequest: () => Promise<void>;
  handleCreateRequest: (name: string) => Promise<void>;
  handleCreateCollection: (name: string) => Promise<void>;
  handleImportCollection: (id: string) => Promise<void>;
  handleAddCollaborator: (email: string) => Promise<void>;
  handleSaveEnv: (name: string, variables: { key: string; value: string; isSecret: boolean }[], id: string | null) => Promise<void>;
  handleDeleteEnv: (id: string) => Promise<void>;
  handleSaveAuthFunc: (name: string, description: string, script: string, id: string | null) => Promise<void>;
  handleDeleteAuthFunc: (id: string) => Promise<void>;

  // Profile operations
  handleSaveProfile: (name: string, cookies: string, localStorage: string, id: string | null) => Promise<void>;
  handleDeleteProfile: (id: string) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  // Authentication State
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

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
  const [selectedElement, setSelectedElement] = useState<any>(null);
  const [selectedElementLocators, setSelectedElementLocators] = useState<any[]>([]);
  const [selectedElementAction, setSelectedElementAction] = useState("click");
  const [selectedElementMethodName, setSelectedElementMethodName] = useState("");
  const [activeGenCodeTab, setActiveGenCodeTab] = useState<"pom" | "client">("pom");
  const [generatedPomCode, setGeneratedPomCode] = useState("");
  const [generatedClientCode, setGeneratedClientCode] = useState("");
  const [selectedLogsForClient, setSelectedLogsForClient] = useState<string[]>([]);
  const [clientBaseUrl, setClientBaseUrl] = useState("https://example.com");

  // Browser Profiles State
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");

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

  // Synchronize global paste event to VNC remote browser
  useEffect(() => {
    if (!isBrowserConnected) return;

    const handleGlobalPaste = (e: ClipboardEvent) => {
      const activeEl = document.activeElement;
      // Do not intercept if focused on a standard input or textbox in the frontend UI
      const isInput = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        (activeEl as HTMLElement).isContentEditable
      );
      if (isInput) return;

      const text = e.clipboardData?.getData("text");
      if (text) {
        handlePasteText(text);
      }
    };

    document.addEventListener("paste", handleGlobalPaste);
    return () => {
      document.removeEventListener("paste", handleGlobalPaste);
    };
  }, [isBrowserConnected]);

  // Fetch data when authenticated
  useEffect(() => {
    if (token) {
      fetchEnvironments();
      fetchAuthFunctions();
      fetchCollections();
      fetchProfiles();
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

  // REST API helpers
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
      const data = await apiCall("/api/auth/google", {
        method: "POST",
        body: JSON.stringify({ idToken: email })
      });
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem("lixionary_token", data.token);
      localStorage.setItem("lixionary_user", JSON.stringify(data.user));
      router.push("/api-explorer");
    } catch (e: any) {
      throw new Error(`Login failed: ${e.message}`);
    }
  };

  const handleGuestLogin = async () => {
    try {
      // Exchange email for token
      const data = await apiCall("/api/auth/google", {
        method: "POST",
        body: JSON.stringify({ idToken: "guest@lixionary.com" })
      });
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem("lixionary_token", data.token);
      localStorage.setItem("lixionary_user", JSON.stringify(data.user));
      router.push("/api-explorer");
    } catch (e: any) {
      throw new Error(`Guest login failed: ${e.message}`);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("lixionary_token");
    localStorage.removeItem("lixionary_user");
    handleDisconnectBrowser();
    router.push("/");
  };

  const fetchEnvironments = async () => {
    try {
      const data = await apiCall("/api/environments");
      setEnvironments(data);
      if (data.length && !selectedEnvId) {
        setSelectedEnvId(data[0].id);
      }
    } catch (e) {
      console.error("Failed to fetch environments", e);
    }
  };

  const fetchAuthFunctions = async () => {
    try {
      const data = await apiCall("/api/auth-functions");
      setAuthFunctions(data);
    } catch (e) {
      console.error("Failed to fetch auth functions", e);
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
      console.error("Failed to fetch collections", e);
    }
  };

  const fetchProfiles = async () => {
    try {
      const data = await apiCall("/api/profiles");
      setProfiles(data);
      if (data.length && !selectedProfileId) {
        setSelectedProfileId(data[0].id);
      }
    } catch (e) {
      console.error("Failed to fetch browser profiles", e);
    }
  };

  // Browser WebSocket interaction methods
  const connectBrowserSession = (sessId: string, profileId?: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let wsUrl = `ws://localhost:8000/api/browser/ws/browser-session/${sessId}?token=${token}`;
    if (profileId) {
      wsUrl += `&profileId=${profileId}`;
    }

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
          fetchNetworkLogs(sessId);
          break;
        case "network_request":
          setNetworkLogs(prev => {
            if (prev.some(log => log.id === msg.data.id)) return prev;
            return [...prev, { ...msg.data, status: null, statusText: "Pending" }];
          });
          break;
        case "network_response":
          setNetworkLogs(prev =>
            prev.map(log =>
              log.id === msg.data.id
                ? { ...log, status: msg.data.status, statusText: msg.data.statusText }
                : log
            )
          );
          break;
        case "element_selected":
          setSelectedElement(msg.data.element);
          setSelectedElementLocators(msg.data.locators);
          if (msg.data.locators.length) {
            setSelectedElementMethodName(`click_${msg.data.element.tagName}_${msg.data.locators[0].strategy}`);
          }
          break;
        case "error":
          alert(`Browser session error: ${msg.message}`);
          setIsBrowserConnected(false);
          break;
      }
    };

    ws.onclose = () => {
      console.log("WS Control Connection Closed");
      setIsBrowserConnected(false);
      setInspectMode(false);
    };

    ws.onerror = (err) => {
      console.error("WS error:", err);
      setIsBrowserConnected(false);
    };
  };

  const handleStartBrowser = (profileId?: string) => {
    const sessId = `session_${Math.random().toString(36).substring(2, 9)}`;
    setSessionId(sessId);
    setNetworkLogs([]);
    setSelectedElement(null);
    setSelectedElementLocators([]);

    setVncUrl(`http://localhost:8080/vnc.html?autoconnect=true&resize=scale&password=`);

    connectBrowserSession(sessId, profileId);
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

  const handlePasteText = (text: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: "paste",
        text: text
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

  const handleExecuteRequest = async () => {
    if (!selectedCollectionId || !selectedRequestId) {
      throw new Error("Please select or create a request to execute.");
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
    } catch (e: any) {
      throw new Error(`Save failed: ${e.message}`);
    }
  };

  const handleCreateRequest = async (name: string) => {
    if (!selectedCollectionId) {
      throw new Error("Please select a collection first.");
    }

    try {
      const col = collections.find(c => c.id === selectedCollectionId);
      if (!col) return;

      const newRequest: RequestItem = {
        id: `req_${Math.random().toString(36).substring(2, 9)}`,
        name: name || "New Request",
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
      throw new Error(`Failed to add request: ${e.message}`);
    }
  };

  const handleCreateCollection = async (name: string) => {
    try {
      const result = await apiCall("/api/collections", {
        method: "POST",
        body: JSON.stringify({ name })
      });
      await fetchCollections();
      setSelectedCollectionId(result.id);
    } catch (e: any) {
      throw new Error(`Failed to create collection: ${e.message}`);
    }
  };

  const handleImportCollection = async (id: string) => {
    try {
      await apiCall(`/api/collections/${id}`);
      await apiCall(`/api/collections/${id}/collaborators`, {
        method: "POST",
        body: JSON.stringify({ userId: user.id })
      });
      await fetchCollections();
      setSelectedCollectionId(id);
    } catch (e: any) {
      throw new Error(`Import failed: ${e.message}`);
    }
  };

  const handleAddCollaborator = async (email: string) => {
    if (!selectedCollectionId) return;
    try {
      await apiCall(`/api/collections/${selectedCollectionId}/collaborators`, {
        method: "POST",
        body: JSON.stringify({ email })
      });
      fetchCollections();
    } catch (e: any) {
      throw new Error(`Sharing failed: ${e.message}`);
    }
  };

  const handleSaveEnv = async (name: string, variables: { key: string; value: string; isSecret: boolean }[], id: string | null) => {
    try {
      if (id) {
        await apiCall(`/api/environments/${id}`, {
          method: "PUT",
          body: JSON.stringify({ name, variables })
        });
      } else {
        await apiCall("/api/environments", {
          method: "POST",
          body: JSON.stringify({ name, variables })
        });
      }
      fetchEnvironments();
    } catch (e: any) {
      throw new Error(`Failed to save environment: ${e.message}`);
    }
  };

  const handleDeleteEnv = async (id: string) => {
    try {
      await apiCall(`/api/environments/${id}`, { method: "DELETE" });
      fetchEnvironments();
      if (selectedEnvId === id) setSelectedEnvId("");
    } catch (e: any) {
      throw new Error(`Delete failed: ${e.message}`);
    }
  };

  const handleSaveAuthFunc = async (name: string, description: string, script: string, id: string | null) => {
    try {
      if (id) {
        await apiCall(`/api/auth-functions/${id}`, {
          method: "PUT",
          body: JSON.stringify({ name, description, script })
        });
      } else {
        await apiCall("/api/auth-functions", {
          method: "POST",
          body: JSON.stringify({ name, description, script })
        });
      }
      fetchAuthFunctions();
    } catch (e: any) {
      throw new Error(`Failed to save auth function: ${e.message}`);
    }
  };

  const handleDeleteAuthFunc = async (id: string) => {
    try {
      await apiCall(`/api/auth-functions/${id}`, { method: "DELETE" });
      fetchAuthFunctions();
    } catch (e: any) {
      throw new Error(`Delete failed: ${e.message}`);
    }
  };

  const handleSaveProfile = async (name: string, cookies: string, localStorage: string, id: string | null) => {
    try {
      if (id) {
        await apiCall(`/api/profiles/${id}`, {
          method: "PUT",
          body: JSON.stringify({ name, cookies, localStorage })
        });
      } else {
        await apiCall("/api/profiles", {
          method: "POST",
          body: JSON.stringify({ name, cookies, localStorage })
        });
      }
      await fetchProfiles();
    } catch (e: any) {
      throw new Error(`Failed to save browser profile: ${e.message}`);
    }
  };

  const handleDeleteProfile = async (id: string) => {
    try {
      await apiCall(`/api/profiles/${id}`, { method: "DELETE" });
      await fetchProfiles();
      if (selectedProfileId === id) setSelectedProfileId("");
    } catch (e: any) {
      throw new Error(`Delete failed: ${e.message}`);
    }
  };

  return (
    <AppContext.Provider
      value={{
        token,
        user,
        isLoadingAuth,
        handleLogin,
        handleGuestLogin,
        handleLogout,

        environments,
        selectedEnvId,
        setSelectedEnvId,
        fetchEnvironments,
        authFunctions,
        fetchAuthFunctions,
        collections,
        selectedCollectionId,
        setSelectedCollectionId,
        selectedRequestId,
        setSelectedRequestId,
        fetchCollections,

        reqName,
        setReqName,
        reqMethod,
        setReqMethod,
        reqUrl,
        setReqUrl,
        reqHeaders,
        setReqHeaders,
        reqQueryParams,
        setReqQueryParams,
        reqBodyType,
        setReqBodyType,
        reqBody,
        setReqBody,
        reqAuthType,
        setReqAuthType,
        reqAuthConfig,
        setReqAuthConfig,
        reqParserScript,
        setReqParserScript,

        apiResponse,
        setApiResponse,
        isExecutingApi,
        setIsExecutingApi,
        responseTab,
        setResponseTab,
        showAiModal,
        setShowAiModal,
        aiPrompt,
        setAiPrompt,
        isGeneratingAiParser,
        setIsGeneratingAiParser,

        browserUrl,
        setBrowserUrl,
        isBrowserConnected,
        setIsBrowserConnected,
        inspectMode,
        setInspectMode,
        vncUrl,
        setVncUrl,
        sessionId,
        setSessionId,
        networkLogs,
        setNetworkLogs,
        networkFilter,
        setNetworkFilter,
        selectedLogId,
        setSelectedLogId,
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

        profiles,
        fetchProfiles,
        selectedProfileId,
        setSelectedProfileId,

        apiCall,
        handleBrowserNavigate,
        handleToggleInspect,
        handlePasteText,
        connectBrowserSession,
        handleStartBrowser,
        handleDisconnectBrowser,
        fetchNetworkLogs,
        handleLogClick,
        handleExecuteRequest,
        handleSaveRequest,
        handleCreateRequest,
        handleCreateCollection,
        handleImportCollection,
        handleAddCollaborator,
        handleSaveEnv,
        handleDeleteEnv,
        handleSaveAuthFunc,
        handleDeleteAuthFunc,

        handleSaveProfile,
        handleDeleteProfile
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useAppContext must be used within an AppProvider");
  }
  return context;
}
