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
  expires_in?: number;
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
  description?: string;
  ownerId?: string;
  collaboratorIds?: string[];
  requests: RequestItem[];
  children?: Collection[];
}

// Tree helper functions
export const findRequestInTree = (collection: Collection, requestId: string): RequestItem | null => {
  const found = collection.requests?.find(r => r.id === requestId);
  if (found) return found;
  if (collection.children) {
    for (const child of collection.children) {
      const res = findRequestInTree(child, requestId);
      if (res) return res;
    }
  }
  return null;
};

export const updateRequestInTree = (collection: Collection, requestId: string, updatedRequest: RequestItem): Collection => {
  const requests = collection.requests?.map(r => r.id === requestId ? updatedRequest : r) || [];
  const children = collection.children?.map(child => updateRequestInTree(child, requestId, updatedRequest)) || [];
  return { ...collection, requests, children };
};

export const deleteRequestInTree = (collection: Collection, requestId: string): Collection => {
  const requests = collection.requests?.filter(r => r.id !== requestId) || [];
  const children = collection.children?.map(child => deleteRequestInTree(child, requestId)) || [];
  return { ...collection, requests, children };
};

export const findParentNodeInTree = (collection: Collection, targetId: string): Collection | null => {
  if (collection.requests?.some(r => r.id === targetId)) {
    return collection;
  }
  if (collection.children?.some(c => c.id === targetId)) {
    return collection;
  }
  if (collection.children) {
    for (const child of collection.children) {
      const res = findParentNodeInTree(child, targetId);
      if (res) return res;
    }
  }
  return null;
};

export const findNodeDepthInTree = (collection: Collection, targetId: string, currentDepth: number = 1): number | null => {
  if (collection.id === targetId) {
    return currentDepth;
  }
  if (collection.children) {
    for (const child of collection.children) {
      const res = findNodeDepthInTree(child, targetId, currentDepth + 1);
      if (res) return res;
    }
  }
  return null;
};

export const getCollectionHeight = (collection: Collection): number => {
  if (!collection.children || collection.children.length === 0) {
    return 1;
  }
  const heights = collection.children.map(c => getCollectionHeight(c));
  return 1 + Math.max(...heights);
};

export const addRequestToNode = (collection: Collection, targetCollectionId: string, newRequest: RequestItem): Collection => {
  if (collection.id === targetCollectionId) {
    return { ...collection, requests: [...(collection.requests || []), newRequest] };
  }
  const children = collection.children?.map(child => addRequestToNode(child, targetCollectionId, newRequest)) || [];
  return { ...collection, children };
};

export const addSubCollectionToNode = (collection: Collection, targetCollectionId: string, newSubCollection: Collection): Collection => {
  if (collection.id === targetCollectionId) {
    return { ...collection, children: [...(collection.children || []), newSubCollection] };
  }
  const children = collection.children?.map(child => addSubCollectionToNode(child, targetCollectionId, newSubCollection)) || [];
  return { ...collection, children };
};

// Helper to remove a request or sub-collection from a node recursively
export const removeNodeFromTree = (collection: Collection, targetId: string): Collection => {
  const requests = collection.requests?.filter(r => r.id !== targetId) || [];
  const filteredChildren = collection.children?.filter(c => c.id !== targetId) || [];
  const children = filteredChildren.map(child => removeNodeFromTree(child, targetId));
  return { ...collection, requests, children };
};

// Helper to find a specific collection node in a tree recursively
export const findCollectionInTree = (collection: Collection, targetId: string): Collection | null => {
  if (collection.id === targetId) {
    return collection;
  }
  if (collection.children) {
    for (const child of collection.children) {
      const res = findCollectionInTree(child, targetId);
      if (res) return res;
    }
  }
  return null;
};

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
    postData?: string;
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
  authFunctionId?: string;
  authInjection?: { type: string; key: string; domainOrOrigin: string };
  defaultUrl?: string;
  createdAt: string;
}

export interface SessionInfo {
  session_id: string;
  status: "pending" | "active" | "disconnected" | "error";
  created_at: string;
  profile_id: string | null;
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
  lastApiResponse: any;
  setLastApiResponse: (res: any) => void;
  isExecutingApi: boolean;
  setIsExecutingApi: (executing: boolean) => void;
  responseTab: "pretty" | "headers" | "raw" | "extracted" | "last";
  setResponseTab: (tab: "pretty" | "headers" | "raw" | "extracted" | "last") => void;
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
  networkPillFilter: "all" | "api";
  setNetworkPillFilter: (filter: "all" | "api") => void;
  handleClearNetworkLogs: () => void;
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

  // Browser Session Management
  userSessions: SessionInfo[];
  fetchUserSessions: () => Promise<void>;
  handleCloseSession: (sessionId: string) => Promise<void>;
  handleReconnectSession: (sessionId: string, profileId?: string) => void;

  // Browser Tab State
  browserTabs: { index: number; url: string }[];
  activeTabIndex: number;
  handleSwitchTab: (index: number) => void;
  handleCloseTab: (index: number) => void;

  // Anchor element for relative XPath generation
  anchorElement: { tagName: string; id: string; text: string } | null;
  handleSetAnchor: () => void;
  handleClearAnchor: () => void;

  // Common operations
  apiCall: (path: string, options?: RequestInit) => Promise<any>;
  handleBrowserNavigate: () => void;
  handleToggleInspect: () => void;
  handlePasteText: (text: string) => void;
  connectBrowserSession: (sessId: string, profileId?: string) => void;
  handleStartBrowser: (profileId?: string) => Promise<void>;
  handleDisconnectBrowser: () => void;
  fetchNetworkLogs: (sessId: string) => Promise<void>;
  handleLogClick: (logId: string) => Promise<void>;
  handleExecuteRequest: () => Promise<void>;
  handleSaveRequest: () => Promise<void>;
  handleCreateRequest: (name: string, targetColId?: string) => Promise<void>;
  handleSaveNetworkRequestToCollection: (
    collectionId: string,
    targetColId: string,
    requestName: string,
    requestData: {
      method: string;
      url: string;
      headers: { key: string; value: string }[];
      queryParams: { key: string; value: string }[];
      bodyType: string;
      body: string;
    }
  ) => Promise<void>;
  handleCreateSubCollection: (name: string, parentColId: string) => Promise<void>;
  handleMoveNode: (nodeId: string, nodeType: "request" | "collection", targetColId: string) => Promise<void>;
  handleDeleteNode: (nodeId: string, nodeType: "request" | "collection") => Promise<void>;
  handleRenameNode: (nodeId: string, nodeType: "request" | "collection", newName: string) => Promise<void>;
  handleCreateCollection: (name: string) => Promise<void>;
  handleImportCollection: (id: string) => Promise<void>;
  handleAddCollaborator: (email: string) => Promise<void>;
  handleSaveEnv: (name: string, variables: { key: string; value: string; isSecret: boolean }[], id: string | null) => Promise<void>;
  handleDeleteEnv: (id: string) => Promise<void>;
  handleSaveAuthFunc: (name: string, description: string, script: string, expires_in: number | null, id: string | null) => Promise<void>;
  handleDeleteAuthFunc: (id: string) => Promise<void>;

  handleSaveProfile: (
    name: string,
    cookies: string,
    localStorage: string,
    authFunctionId: string | null,
    authInjection: { type: string; key: string; domainOrOrigin: string } | null,
    defaultUrl: string,
    id: string | null
  ) => Promise<void>;
  handleDeleteProfile: (id: string) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  // Authentication State
  const [token, setToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
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
  const [lastApiResponse, setLastApiResponseState] = useState<any>(() => {
    try {
      const s = localStorage.getItem("nv_last_api_response");
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });
  const setLastApiResponse = (res: any) => {
    setLastApiResponseState(res);
    try { localStorage.setItem("nv_last_api_response", JSON.stringify(res)); } catch {}
  };
  const [isExecutingApi, setIsExecutingApi] = useState(false);
  const [responseTab, setResponseTab] = useState<"pretty" | "headers" | "raw" | "extracted" | "last">("pretty");
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
  const [networkPillFilter, setNetworkPillFilter] = useState<"all" | "api">("all");
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [logDetails, setLogDetails] = useState<NetworkDetails | null>(null);
  const [activePomClass, setActivePomClass] = useState("MyPage");
  const [pomClasses, setPomClasses] = useState<string[]>(["MyPage"]);
  const [pomElements, setPomElements] = useState<Record<string, RecordedElement[]>>({ "MyPage": [] });
  const [selectedElement, setSelectedElement] = useState<any>(null);
  const [selectedElementLocators, setSelectedElementLocators] = useState<any[]>([]);
  const [selectedElementAction, setSelectedElementAction] = useState("click");
  const [selectedElementMethodName, setSelectedElementMethodName] = useState("");
  const [anchorElement, setAnchorElement] = useState<{ tagName: string; id: string; text: string } | null>(null);
  const [activeGenCodeTab, setActiveGenCodeTab] = useState<"pom" | "client">("pom");
  const [generatedPomCode, setGeneratedPomCode] = useState("");
  const [generatedClientCode, setGeneratedClientCode] = useState("");
  const [selectedLogsForClient, setSelectedLogsForClient] = useState<string[]>([]);
  const [clientBaseUrl, setClientBaseUrl] = useState("https://example.com");

  // Browser Profiles State
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");

  // Browser Session Management
  const [userSessions, setUserSessions] = useState<SessionInfo[]>([]);

  // Browser Tab State
  const [browserTabs, setBrowserTabs] = useState<{ index: number; url: string }[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  // WebSocket Ref for browser interactions
  const wsRef = useRef<WebSocket | null>(null);

  // Run on mount
  useEffect(() => {
    const savedToken = localStorage.getItem("lixionary_token");
    const savedUser = localStorage.getItem("lixionary_user");
    const savedRefreshToken = localStorage.getItem("lixionary_refresh_token");
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
    }
    if (savedRefreshToken) {
      setRefreshToken(savedRefreshToken);
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
      fetchUserSessions();
    }
  }, [token]);

  // Ref to suppress the auth-persist write on the render right after a selection
  // change (when reqAuthType/reqAuthConfig haven't synced to the new request yet).
  const authPersistIdRef = useRef<string>("");

  // Synchronize request inputs when selection changes
  useEffect(() => {
    if (selectedCollectionId && selectedRequestId) {
      const col = collections.find(c => c.id === selectedCollectionId);
      const req = col ? findRequestInTree(col, selectedRequestId) : null;
      if (req) {
        setReqName(req.name);
        setReqMethod(req.method);
        setReqUrl(req.url);
        setReqHeaders(req.headers.length ? req.headers : [{ key: "", value: "" }]);
        setReqQueryParams(req.queryParams.length ? req.queryParams : [{ key: "", value: "" }]);
        setReqBodyType(req.bodyType);
        setReqBody(req.body || "");

        // Auth: prefer unsaved override from localStorage, else the saved request value.
        let authType = req.authType;
        let authConfig = req.authConfig || { token: "", key: "", value: "", authFunctionId: "" };
        try {
          const override = localStorage.getItem(`lixionary_auth_${selectedRequestId}`);
          if (override) {
            const parsed = JSON.parse(override);
            authType = parsed.authType ?? authType;
            authConfig = parsed.authConfig ?? authConfig;
          }
        } catch { /* ignore malformed override */ }
        setReqAuthType(authType);
        setReqAuthConfig(authConfig);

        setReqParserScript(req.responseParserScript || "");
        setApiResponse(null);
      }
    }
  }, [selectedRequestId, selectedCollectionId, collections]);

  // Auto-persist auth selection per request so it survives switches/reloads
  // without a manual Save.
  useEffect(() => {
    if (!selectedRequestId) return;
    if (authPersistIdRef.current !== selectedRequestId) {
      // Selection just changed; auth state not yet synced to this request — skip
      // this run. The follow-up render (once auth state updates) writes correctly.
      authPersistIdRef.current = selectedRequestId;
      return;
    }
    try {
      localStorage.setItem(
        `lixionary_auth_${selectedRequestId}`,
        JSON.stringify({ authType: reqAuthType, authConfig: reqAuthConfig })
      );
    } catch { /* storage unavailable — non-fatal */ }
  }, [reqAuthType, reqAuthConfig, selectedRequestId]);

  // REST API helpers
  const apiCall = async (path: string, options: RequestInit = {}) => {
    let currentToken = token;
    const makeRequest = async (tok: string | null) => {
      const headers = {
        "Content-Type": "application/json",
        ...(tok ? { "Authorization": `Bearer ${tok}` } : {}),
        ...(options.headers || {})
      };
      return await fetch(path, { ...options, headers });
    };

    let response = await makeRequest(currentToken);

    if (response.status === 401 && refreshToken && path !== "/api/auth/refresh" && path !== "/api/auth/oauth-token") {
      try {
        const refreshRes = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken })
        });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          const newAccessToken = refreshData.access_token;
          setToken(newAccessToken);
          localStorage.setItem("lixionary_token", newAccessToken);
          
          // Retry the request with the new access token
          response = await makeRequest(newAccessToken);
        } else {
          handleLogout();
        }
      } catch (e) {
        console.error("Token refresh failed:", e);
        handleLogout();
      }
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: "Unknown error occurred" }));
      const errorMsg = typeof err.detail === "string"
        ? err.detail
        : (err.detail?.message || `Server responded with ${response.status}`);
      const error = new Error(errorMsg);
      (error as any).status = response.status;
      (error as any).detail = err.detail;
      throw error;
    }
    return response.json();
  };

  const handleLogin = async (code: string) => {
    try {
      const data = await apiCall("/api/auth/oauth-token", {
        method: "POST",
        body: JSON.stringify({ code, redirect_uri: process.env.NEXT_PUBLIC_REDIRECT_URI || "http://localhost:8481/callback" })
      });
      setToken(data.access_token);
      setRefreshToken(data.refresh_token);
      setUser(data.user);
      localStorage.setItem("lixionary_token", data.access_token);
      localStorage.setItem("lixionary_refresh_token", data.refresh_token);
      localStorage.setItem("lixionary_user", JSON.stringify(data.user));
      router.push("/api-explorer");
    } catch (e: any) {
      throw new Error(`Login failed: ${e.message}`);
    }
  };

  const handleGuestLogin = async () => {
    try {
      const data = await apiCall("/api/auth/guest", {
        method: "POST"
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
    if (refreshToken) {
      // Non-blocking fire and forget revoke call
      apiCall("/api/auth/revoke", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken })
      }).catch((e) => console.error("Failed to revoke token on server:", e));
    }
    setToken(null);
    setRefreshToken(null);
    setUser(null);
    localStorage.removeItem("lixionary_token");
    localStorage.removeItem("lixionary_refresh_token");
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
    
    // Determine the base WebSocket host dynamically to handle both local development (Docker / non-Docker)
    // and production/QA deployment reverse proxy routing.
    let wsHost = "";
    if (process.env.NEXT_PUBLIC_WS_URL) {
      wsHost = process.env.NEXT_PUBLIC_WS_URL;
      if (!wsHost.startsWith("ws://") && !wsHost.startsWith("wss://")) {
        wsHost = `${protocol}//${wsHost}`;
      }
    } else {
      const hostname = window.location.hostname;
      const port = window.location.port;
      
      if (hostname === "localhost" || hostname === "127.0.0.1") {
        if (port === "8481") {
          // Frontend runs on host port 8481, backend runs on host port 8480 in docker-compose.
          wsHost = `${protocol}//localhost:8480`;
        } else if (port === "3000") {
          // Frontend runs on port 3000 (local Node dev server), backend runs on port 8000.
          wsHost = `${protocol}//localhost:8000`;
        } else {
          wsHost = `${protocol}//${window.location.host}`;
        }
      } else {
        // Standard production/QA reverse proxy setup where /api routes directly to backend
        wsHost = `${protocol}//${window.location.host}`;
      }
    }

    let wsUrl = `${wsHost}/api/browser/ws/browser-session/${sessId}?token=${token}`;
    if (profileId) {
      wsUrl += `&profileId=${profileId}`;
    }
    if (selectedEnvId) {
      wsUrl += `&envId=${selectedEnvId}`;
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
          setBrowserTabs([{ index: 0, url: msg.data.url }]);
          setActiveTabIndex(0);
          
          // Compute VNC HTTP and WebSocket URLs using the dynamic wsHost proxy endpoints
          const httpHost = wsHost.replace(/^ws(s)?:\/\//, "http$1://");
          // Use path query parameter in noVNC to route WebSocket connections through the backend proxy
          const vncPath = `api/browser/vnc-ws/${sessId}`;
          setVncUrl(`${httpHost}/api/browser/vnc/${sessId}/vnc.html?autoconnect=true&resize=scale&path=${vncPath}&password=`);
          break;
        case "navigation":
          const navUrl = msg.data?.url || msg.url;
          setBrowserUrl(navUrl);
          fetchNetworkLogs(sessId);
          setActiveTabIndex((ai) => {
            setBrowserTabs((prev) => prev.map((t, i) => i === ai ? { ...t, url: navUrl } : t));
            return ai;
          });
          break;
        case "tab_opened":
          setBrowserTabs((prev) => [...prev, { index: msg.data.index, url: msg.data.url }]);
          break;
        case "tab_closed":
          setBrowserTabs((prev) => prev.filter((_, i) => i !== msg.data.index));
          setActiveTabIndex(msg.data.active_index);
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
        case "anchor_set":
          setAnchorElement(msg.data.anchorInfo);
          break;
        case "anchor_cleared":
          setAnchorElement(null);
          break;
        case "error":
          alert(`Browser session error: ${msg.message}`);
          setIsBrowserConnected(false);
          fetchUserSessions();
          break;
      }
    };

    ws.onclose = () => {
      console.log("WS Control Connection Closed");
      setIsBrowserConnected(false);
      setInspectMode(false);
      fetchUserSessions();
    };

    ws.onerror = (err) => {
      console.error("WS error:", err);
      setIsBrowserConnected(false);
    };
  };

  const fetchUserSessions = async () => {
    try {
      const data = await apiCall("/api/browser/sessions");
      setUserSessions(data);
    } catch (e) {
      console.error("Failed to fetch user sessions", e);
    }
  };

  const handleCloseSession = async (sessId: string) => {
    try {
      await apiCall(`/api/browser/sessions/${sessId}`, { method: "DELETE" });
      if (sessId === sessionId) {
        if (wsRef.current) wsRef.current.close();
        setIsBrowserConnected(false);
        setInspectMode(false);
        setVncUrl("");
        setSessionId("");
      }
      await fetchUserSessions();
    } catch (e) {
      console.error("Failed to close session", e);
    }
  };

  const handleReconnectSession = (sessId: string, profileId?: string) => {
    setSessionId(sessId);
    setNetworkLogs([]);
    setSelectedElement(null);
    setSelectedElementLocators([]);
    setBrowserTabs([]);
    setActiveTabIndex(0);
    setVncUrl(""); // Empty initially; will be populated dynamically by the WebSocket status message
    connectBrowserSession(sessId, profileId);
  };

  const handleStartBrowser = async (profileId?: string) => {
    try {
      // Find the profile defaultUrl
      let targetUrl = "about:blank";
      if (profileId) {
        const prof = profiles.find((p) => p.id === profileId);
        if (prof && prof.defaultUrl) {
          targetUrl = prof.defaultUrl;
        }
      }
      setBrowserUrl(targetUrl);

      const { session_id: sessId } = await apiCall("/api/browser/sessions", { method: "POST" });
      setSessionId(sessId);
      setNetworkLogs([]);
      setSelectedElement(null);
      setSelectedElementLocators([]);
      setBrowserTabs([]);
      setActiveTabIndex(0);
      setVncUrl(""); // Empty initially; will be populated dynamically by the WebSocket status message
      connectBrowserSession(sessId, profileId);
      await fetchUserSessions();
    } catch (e: any) {
      console.error("Failed to create browser session:", e.message);
      throw e;
    }
  };

  const handleDisconnectBrowser = () => {
    // Close the WebSocket only — the browser session stays alive in the backend
    // so the user can reconnect later. Use handleCloseSession to fully terminate.
    if (wsRef.current) {
      wsRef.current.close();
    }
    setIsBrowserConnected(false);
    setInspectMode(false);
    setVncUrl("");
    setBrowserTabs([]);
    setActiveTabIndex(0);
    // Keep sessionId so the UI can show the disconnected state and offer reconnect.
  };

  const handleSwitchTab = (index: number) => {
    setActiveTabIndex(index);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "switch_tab", page_index: index }));
    }
  };

  const handleCloseTab = (index: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "close_tab", page_index: index }));
    }
  };

  const handleBrowserNavigate = () => {
    if (!browserUrl) {
      alert("Please enter a URL.");
      return;
    }
    // Allow about:blank
    if (browserUrl !== "about:blank") {
      if (!browserUrl.startsWith("http://") && !browserUrl.startsWith("https://")) {
        alert("URL must start with http:// or https://");
        return;
      }
      try {
        new URL(browserUrl);
      } catch {
        alert("Please enter a valid URL format.");
        return;
      }
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: "navigate",
        url: browserUrl
      }));
    }
  };

  const handleToggleInspect = () => {
    const nextMode = !inspectMode;
    console.log(`[Lixionary] Toggling Inspect Mode: ${inspectMode} -> ${nextMode}`);
    setInspectMode(nextMode);
    if (!nextMode) {
      setAnchorElement(null);
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log(`[Lixionary] Sending toggle-inspect: ${nextMode} to WebSocket`);
      wsRef.current.send(JSON.stringify({
        action: "toggle-inspect",
        enabled: nextMode
      }));
    } else {
      console.warn("[Lixionary] WebSocket not open, cannot toggle inspect mode on backend");
    }
  };

  const handleSetAnchor = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "set-anchor" }));
    }
  };

  const handleClearNetworkLogs = () => {
    setNetworkLogs([]);
    setSelectedLogId(null);
    setLogDetails(null);
    setNetworkPillFilter("all");
  };

  const handleClearAnchor = () => {
    setAnchorElement(null);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "clear-anchor" }));
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
      if (result.status < 400) {
        setLastApiResponse(result);
      }
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
    if (!selectedRequestId) return;

    try {
      const col = collections.find(c => findRequestInTree(c, selectedRequestId) !== null);
      if (!col) return;

      const req = findRequestInTree(col, selectedRequestId);
      if (!req) return;

      const updatedRequest: RequestItem = {
        ...req,
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

      const updatedCol = updateRequestInTree(col, selectedRequestId, updatedRequest);

      await apiCall(`/api/collections/${col.id}`, {
        method: "PUT",
        body: JSON.stringify({
          requests: updatedCol.requests,
          children: updatedCol.children || []
        })
      });

      // Saved state is now authoritative — drop the unsaved auth override.
      try { localStorage.removeItem(`lixionary_auth_${selectedRequestId}`); } catch { /* non-fatal */ }

      await fetchCollections();
    } catch (e: any) {
      throw new Error(`Save failed: ${e.message}`);
    }
  };

  const handleCreateRequest = async (name: string, targetColId?: string) => {
    try {
      const actualTargetId = targetColId || selectedCollectionId;
      if (!actualTargetId) {
        throw new Error("Please select a collection first.");
      }

      const col = collections.find(c => findCollectionInTree(c, actualTargetId) !== null);
      if (!col) {
        throw new Error("Target collection not found in any collection tree.");
      }

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

      const updatedCol = addRequestToNode(col, actualTargetId, newRequest);

      await apiCall(`/api/collections/${col.id}`, {
        method: "PUT",
        body: JSON.stringify({
          requests: updatedCol.requests,
          children: updatedCol.children || []
        })
      });

      await fetchCollections();
      setSelectedRequestId(newRequest.id);
    } catch (e: any) {
      throw new Error(`Failed to add request: ${e.message}`);
    }
  };

  const handleSaveNetworkRequestToCollection = async (
    collectionId: string,
    targetColId: string,
    requestName: string,
    requestData: {
      method: string;
      url: string;
      headers: { key: string; value: string }[];
      queryParams: { key: string; value: string }[];
      bodyType: string;
      body: string;
    }
  ) => {
    const col = collections.find(c => c.id === collectionId);
    if (!col) throw new Error("Collection not found.");
    
    const newRequest: RequestItem = {
      id: `req_${Math.random().toString(36).substring(2, 9)}`,
      name: requestName,
      method: requestData.method,
      url: requestData.url,
      headers: requestData.headers,
      queryParams: requestData.queryParams,
      bodyType: requestData.bodyType,
      body: requestData.body,
      authType: "NONE",
      authConfig: {}
    };

    const updatedCol = addRequestToNode(col, targetColId, newRequest);

    await apiCall(`/api/collections/${collectionId}`, {
      method: "PUT",
      body: JSON.stringify({
        requests: updatedCol.requests,
        children: updatedCol.children || []
      })
    });
    await fetchCollections();
  };

  const handleCreateSubCollection = async (name: string, parentColId: string) => {
    try {
      const col = collections.find(c => findCollectionInTree(c, parentColId) !== null);
      if (!col) {
        throw new Error("Parent collection not found in any collection tree.");
      }

      const currentDepth = findNodeDepthInTree(col, parentColId);
      if (currentDepth === null) {
        throw new Error("Parent collection not found in this tree.");
      }
      if (currentDepth >= 5) {
        throw new Error("Cannot create collection. Maximum depth limit of 5 levels exceeded.");
      }

      const newSub: Collection = {
        id: `col_${Math.random().toString(36).substring(2, 9)}`,
        name: name || "New Sub-collection",
        requests: [],
        children: []
      };

      const updatedCol = addSubCollectionToNode(col, parentColId, newSub);

      await apiCall(`/api/collections/${col.id}`, {
        method: "PUT",
        body: JSON.stringify({
          requests: updatedCol.requests,
          children: updatedCol.children || []
        })
      });

      await fetchCollections();
    } catch (e: any) {
      throw new Error(`Failed to create sub-collection: ${e.message}`);
    }
  };

  const handleMoveNode = async (nodeId: string, nodeType: "request" | "collection", targetColId: string) => {
    try {
      // Find target root collection
      const targetRootCol = collections.find(c => findCollectionInTree(c, targetColId) !== null);
      if (!targetRootCol) {
        throw new Error("Target parent collection not found.");
      }

      // Find source root collection
      let sourceRootCol = collections.find(c => {
        if (nodeType === "request") {
          return findRequestInTree(c, nodeId) !== null;
        } else {
          return findCollectionInTree(c, nodeId) !== null;
        }
      });

      if (!sourceRootCol) {
        throw new Error("Source item to move not found.");
      }

      // Prevent dragging a collection into itself
      if (nodeType === "collection" && nodeId === targetColId) {
        throw new Error("Cannot move a collection into itself.");
      }

      // If moving a collection, check if target is a descendant of the moved collection
      if (nodeType === "collection") {
        const movedNode = findCollectionInTree(sourceRootCol, nodeId);
        if (movedNode && findCollectionInTree(movedNode, targetColId)) {
          throw new Error("Cannot move a collection into its own sub-collections.");
        }
      }

      // Check depth limit
      const targetDepth = findNodeDepthInTree(targetRootCol, targetColId);
      if (targetDepth === null) {
        throw new Error("Target parent collection not found in tree.");
      }

      let subtreeHeight = 1;
      if (nodeType === "collection") {
        const movedNode = findCollectionInTree(sourceRootCol, nodeId);
        if (movedNode) {
          subtreeHeight = getCollectionHeight(movedNode);
        }
      }

      if (targetDepth + subtreeHeight > 5) {
        throw new Error(`Cannot move. The nesting would exceed the maximum depth limit of 5 levels (maximum depth reached: ${targetDepth + subtreeHeight}).`);
      }

      // Find the item to move
      let itemToMove: any = null;
      if (nodeType === "request") {
        itemToMove = findRequestInTree(sourceRootCol, nodeId);
      } else {
        itemToMove = findCollectionInTree(sourceRootCol, nodeId);
      }

      if (!itemToMove) {
        throw new Error("Source node to move not found.");
      }

      if (sourceRootCol.id === targetRootCol.id) {
        // Same root tree movement
        let updatedCol = removeNodeFromTree(sourceRootCol, nodeId);
        if (nodeType === "request") {
          updatedCol = addRequestToNode(updatedCol, targetColId, itemToMove as RequestItem);
        } else {
          updatedCol = addSubCollectionToNode(updatedCol, targetColId, itemToMove as Collection);
        }

        await apiCall(`/api/collections/${sourceRootCol.id}`, {
          method: "PUT",
          body: JSON.stringify({
            requests: updatedCol.requests,
            children: updatedCol.children || []
          })
        });
      } else {
        // Cross root tree movement
        const updatedSourceCol = removeNodeFromTree(sourceRootCol, nodeId);
        let updatedTargetCol = targetRootCol;
        if (nodeType === "request") {
          updatedTargetCol = addRequestToNode(targetRootCol, targetColId, itemToMove as RequestItem);
        } else {
          updatedTargetCol = addSubCollectionToNode(targetRootCol, targetColId, itemToMove as Collection);
        }

        // Save target first
        await apiCall(`/api/collections/${targetRootCol.id}`, {
          method: "PUT",
          body: JSON.stringify({
            requests: updatedTargetCol.requests,
            children: updatedTargetCol.children || []
          })
        });

        // Save source second
        await apiCall(`/api/collections/${sourceRootCol.id}`, {
          method: "PUT",
          body: JSON.stringify({
            requests: updatedSourceCol.requests,
            children: updatedSourceCol.children || []
          })
        });
      }

      await fetchCollections();
    } catch (e: any) {
      throw new Error(`Failed to move item: ${e.message}`);
    }
  };

  const handleDeleteNode = async (nodeId: string, nodeType: "request" | "collection") => {
    try {
      if (nodeType === "collection" && collections.some(c => c.id === nodeId)) {
        await apiCall(`/api/collections/${nodeId}`, { method: "DELETE" });
        if (selectedCollectionId === nodeId) {
          setSelectedCollectionId("");
          setSelectedRequestId("");
        }
        await fetchCollections();
        return;
      }

      const col = collections.find(c => {
        if (nodeType === "request") {
          return findRequestInTree(c, nodeId) !== null;
        } else {
          return findCollectionInTree(c, nodeId) !== null;
        }
      });

      if (!col) {
        throw new Error("Item not found in any collection tree.");
      }

      const updatedCol = removeNodeFromTree(col, nodeId);

      await apiCall(`/api/collections/${col.id}`, {
        method: "PUT",
        body: JSON.stringify({
          requests: updatedCol.requests,
          children: updatedCol.children || []
        })
      });

      if (nodeType === "request" && selectedRequestId === nodeId) {
        setSelectedRequestId("");
      }

      await fetchCollections();
    } catch (e: any) {
      throw new Error(`Failed to delete item: ${e.message}`);
    }
  };

  const handleRenameNode = async (nodeId: string, nodeType: "request" | "collection", newName: string) => {
    try {
      if (nodeType === "collection" && collections.some(c => c.id === nodeId)) {
        await apiCall(`/api/collections/${nodeId}`, {
          method: "PUT",
          body: JSON.stringify({ name: newName })
        });
        await fetchCollections();
        return;
      }

      const col = collections.find(c => {
        if (nodeType === "request") {
          return findRequestInTree(c, nodeId) !== null;
        } else {
          return findCollectionInTree(c, nodeId) !== null;
        }
      });

      if (!col) {
        throw new Error("Item not found in any collection tree.");
      }

      const renameInTree = (node: Collection): Collection => {
        if (nodeType === "collection" && node.id === nodeId) {
          return { ...node, name: newName };
        }
        const requests = node.requests?.map(r => {
          if (nodeType === "request" && r.id === nodeId) {
            return { ...r, name: newName };
          }
          return r;
        }) || [];
        const children = node.children?.map(child => renameInTree(child)) || [];
        return { ...node, requests, children };
      };

      const updatedCol = renameInTree(col);

      await apiCall(`/api/collections/${col.id}`, {
        method: "PUT",
        body: JSON.stringify({
          requests: updatedCol.requests,
          children: updatedCol.children || []
        })
      });

      if (nodeType === "request" && selectedRequestId === nodeId) {
        setReqName(newName);
      }

      await fetchCollections();
    } catch (e: any) {
      throw new Error(`Failed to rename item: ${e.message}`);
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

  const handleSaveAuthFunc = async (name: string, description: string, script: string, expires_in: number | null, id: string | null) => {
    try {
      if (id) {
        await apiCall(`/api/auth-functions/${id}`, {
          method: "PUT",
          body: JSON.stringify({ name, description, script, expires_in })
        });
      } else {
        await apiCall("/api/auth-functions", {
          method: "POST",
          body: JSON.stringify({ name, description, script, expires_in })
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

  const handleSaveProfile = async (
    name: string,
    cookies: string,
    localStorage: string,
    authFunctionId: string | null,
    authInjection: { type: string; key: string; domainOrOrigin: string } | null,
    defaultUrl: string,
    id: string | null
  ) => {
    try {
      if (id) {
        await apiCall(`/api/profiles/${id}`, {
          method: "PUT",
          body: JSON.stringify({ name, cookies, localStorage, authFunctionId, authInjection, defaultUrl })
        });
      } else {
        await apiCall("/api/profiles", {
          method: "POST",
          body: JSON.stringify({ name, cookies, localStorage, authFunctionId, authInjection, defaultUrl })
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
        lastApiResponse,
        setLastApiResponse,
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
        networkPillFilter,
        setNetworkPillFilter,
        handleClearNetworkLogs,
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

        userSessions,
        fetchUserSessions,
        handleCloseSession,
        handleReconnectSession,

        browserTabs,
        activeTabIndex,
        handleSwitchTab,
        handleCloseTab,

        anchorElement,
        handleSetAnchor,
        handleClearAnchor,

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
        handleSaveNetworkRequestToCollection,
        handleCreateSubCollection,
        handleMoveNode,
        handleDeleteNode,
        handleRenameNode,
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
