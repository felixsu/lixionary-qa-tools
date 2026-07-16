"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { runAllSync, resolveConflictKeepLocal, resolveConflictKeepCloud } from "./syncEngine";
import type { SyncConflict } from "./syncEngine";
import { setScreencastFrame } from "../utils/screencastFrameStore";

const VPS_API_URL = process.env.NEXT_PUBLIC_VPS_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'http://localhost:8000' : 'https://qa-tools-api.lixionary.com');
const LOCAL_API_URL = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:8484';


// Types
export interface Environment {
  id: string; // local-store localId — stable offline, before any cloud sync
  cloudId?: string | null; // Mongo _id once synced; undefined/null until then
  name: string;
  variables: { key: string; value: string; isSecret: boolean }[];
}

export interface AuthFunction {
  id: string; // local-store localId — stable offline, before any cloud sync
  cloudId?: string | null; // Mongo _id once synced
  name: string;
  description: string;
  script: string;
  expires_in?: number;
  cachedToken?: string;
  expiresAt?: string;
}

export interface UserGuideSummary {
  id: string;
  title: string;
  description: string;
  blockCount: number;
  updatedAt?: string;
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
  id: string; // local-store localId (root collections only) — stable offline, before any cloud sync
  cloudId?: string | null; // Mongo _id once synced; only meaningful on root collections
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

// Finds the root-level collection that owns a request, regardless of nesting depth.
export const findRequestOwnerCollection = (collections: Collection[], requestId: string): Collection | null => {
  for (const col of collections) {
    if (findRequestInTree(col, requestId)) return col;
  }
  return null;
};

// Returns the chain of collection ids from root down to the collection directly
// containing the request (inclusive), or null if not found.
export const findAncestorPathToRequest = (collection: Collection, requestId: string, path: string[] = []): string[] | null => {
  const currentPath = [...path, collection.id];
  if (collection.requests?.some(r => r.id === requestId)) return currentPath;
  if (collection.children) {
    for (const child of collection.children) {
      const res = findAncestorPathToRequest(child, requestId, currentPath);
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
  id: string; // local-store localId — stable offline, before any cloud sync
  cloudId?: string | null; // Mongo _id once synced
  name: string;
  cookies: string;
  localStorage: string;
  authFunctionId?: string;
  authInjection?: { type: string; key: string; domainOrOrigin: string };
  defaultUrl?: string;
  createdAt?: string;
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
  selectedEnvCloudId: string | null; // cloud Mongo _id of the selected env, once synced — for cloud endpoints that expect one
  setSelectedEnvId: (id: string) => void;
  fetchEnvironments: () => Promise<void>;
  authFunctions: AuthFunction[];
  fetchAuthFunctions: () => Promise<void>;
  resolveAuthFunctionCloudId: (localId?: string | null) => string | null;
  syncConflicts: SyncConflict[];
  resolveSyncConflict: (conflict: SyncConflict, choice: "local" | "cloud") => Promise<void>;
  isOnline: boolean;
  lastSyncAt: string | null;
  syncStatus: "idle" | "syncing" | "error";
  triggerSync: (entityTypes?: import("./syncEngine").EntityType[]) => Promise<void>;
  userGuides: UserGuideSummary[];
  fetchUserGuides: () => Promise<void>;
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
  sendBrowserMouseEvent: (type: "click" | "move" | "down" | "up", x: number, y: number) => void;
  sendBrowserWheelEvent: (deltaX: number, deltaY: number) => void;
  sendBrowserKeyboardEvent: (key: string) => void;
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
  selectedElementStale: { stale: boolean; reason: string | null };
  setSelectedElementStale: (stale: { stale: boolean; reason: string | null }) => void;
  inspectError: string | null;
  setInspectError: (msg: string | null) => void;
  pageScanStatus: "idle" | "scanning" | "done" | "error";
  pageScanError: string | null;
  pageScanResults: any[] | null;
  pageScanScopeLabel: string | null;
  handleScanPage: (scope?: "page" | "selected") => void;
  resetPageScan: () => void;
  selectedElementAction: string;
  setSelectedElementAction: (action: string) => void;
  selectedElementMethodName: string;
  setSelectedElementMethodName: (name: string) => void;
  selectedElementTestValue: string;
  setSelectedElementTestValue: (value: string) => void;
  isVerifying: boolean;
  verifyAttempts: any[];
  verifyResult: { success: boolean; resultText?: string } | null;
  handleVerifyElement: () => void;
  isExploring: boolean;
  exploreSteps: any[];
  setExploreSteps: React.Dispatch<React.SetStateAction<any[]>>;
  explorePrompt: string;
  setExplorePrompt: (prompt: string) => void;
  handleStartExplore: (scope?: "page" | "selected") => void;
  handleStopExplore: () => void;
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
  handleSaveNetworkRequestToNewCollection: (
    newCollectionName: string,
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
  const [token, setTokenState] = useState<string | null>(null);
  const [refreshToken, setRefreshTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const tokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);

  const setToken = (t: string | null) => {
    tokenRef.current = t;
    setTokenState(t);
  };

  const setRefreshToken = (rt: string | null) => {
    refreshTokenRef.current = rt;
    setRefreshTokenState(rt);
  };

  const refreshPromiseRef = useRef<Promise<string> | null>(null);

  // Local-first sync: this device's id (from the sidecar's local store) and an
  // in-flight guard so overlapping triggers (login + focus + interval) collapse
  // into one pass instead of racing each other.
  const deviceIdRef = useRef<string | null>(null);
  const syncInFlightRef = useRef<boolean>(false);
  const lastSyncAttemptRef = useRef<number>(0);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "error">("idle");

  // Databases & Shared States
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedEnvId, setSelectedEnvId] = useState<string>("");
  const selectedEnvCloudId = environments.find((e) => e.id === selectedEnvId)?.cloudId || null;
  const [authFunctions, setAuthFunctions] = useState<AuthFunction[]>([]);
  // Cloud endpoints that resolve HOOK auth (executor run/preview, profile token
  // fetch) expect a Mongo _id — an auth function that hasn't synced yet only has
  // a local id, so this resolves to null rather than send an id the cloud can't parse.
  // id may be a local id (set via this device's own UI, which never changes even
  // after the record syncs) or a cloud id (pulled from a record another device
  // wrote) — check both rather than assume.
  const resolveAuthFunctionCloudId = (id?: string | null): string | null =>
    id ? (authFunctions.find((af) => af.id === id || af.cloudId === id)?.cloudId || null) : null;
  const [userGuides, setUserGuides] = useState<UserGuideSummary[]>([]);
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
  const [selectedElementStale, setSelectedElementStale] = useState<{ stale: boolean; reason: string | null }>({ stale: false, reason: null });
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [pageScanStatus, setPageScanStatus] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const [pageScanError, setPageScanError] = useState<string | null>(null);
  const [pageScanResults, setPageScanResults] = useState<any[] | null>(null);
  const [pageScanScopeLabel, setPageScanScopeLabel] = useState<string | null>(null);
  const [selectedElementAction, setSelectedElementAction] = useState("click");
  const [selectedElementMethodName, setSelectedElementMethodName] = useState("");
  const [selectedElementTestValue, setSelectedElementTestValue] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyAttempts, setVerifyAttempts] = useState<any[]>([]);
  const [verifyResult, setVerifyResult] = useState<{ success: boolean; resultText?: string } | null>(null);
  const [isExploring, setIsExploring] = useState(false);
  const [exploreSteps, setExploreSteps] = useState<any[]>([]);
  const [explorePrompt, setExplorePrompt] = useState("");
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
    if (token && user) {
      (async () => {
        // The local sync cache is device-wide, not per-user — if a different
        // account than last time just signed in (e.g. someone with two
        // Google accounts on this machine), wipe it before syncing so the
        // previous account's browser profiles/environments/etc. never leak
        // into view. Best-effort: if the sidecar isn't up yet, sync below
        // already tolerates that and will just retry later.
        try {
          await apiCall("/api/local-store/active-user", {
            method: "POST",
            body: JSON.stringify({ userId: user.id }),
          });
        } catch {
          // ignored — see comment above
        }
        fetchEnvironments();
        fetchAuthFunctions();
        fetchCollections();
        fetchProfiles();
        fetchUserSessions();
        fetchUserGuides();
        triggerSync();
      })();
    }
  }, [token]);

  // Keep local-first data fresh without the user having to think about it:
  // re-sync when the window regains focus (debounced — skip if we just synced
  // within the last minute, e.g. quick tab-switching) and on a slow background
  // interval as a fallback while the tab stays open.
  useEffect(() => {
    if (!token) return;

    const handleFocus = () => {
      if (Date.now() - lastSyncAttemptRef.current < 60_000) return;
      triggerSync();
    };
    window.addEventListener("focus", handleFocus);

    const interval = setInterval(() => {
      triggerSync();
    }, 5 * 60 * 1000);

    return () => {
      window.removeEventListener("focus", handleFocus);
      clearInterval(interval);
    };
  }, [token]);

  // Ref to suppress the auth-persist write on the render right after a selection
  // change (when reqAuthType/reqAuthConfig haven't synced to the new request yet).
  const authPersistIdRef = useRef<string>("");

  // Synchronize request inputs when selection changes
  useEffect(() => {
    if (selectedRequestId) {
      const col = findRequestOwnerCollection(collections, selectedRequestId);
      const req = col ? findRequestInTree(col, selectedRequestId) : null;
      if (req) {
        if (col && col.id !== selectedCollectionId) {
          setSelectedCollectionId(col.id);
        }
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
    const makeRequest = async (tok: string | null) => {
      const headers = {
        "Content-Type": "application/json",
        ...(tok ? { "Authorization": `Bearer ${tok}` } : {}),
        ...(options.headers || {})
      };
      const isLocal = path.startsWith("/api/browser") || path.startsWith("/api/workspace") || path.startsWith("/api/browser-helper") || path.startsWith("/api/local-store");
      const baseUrl = isLocal ? LOCAL_API_URL : VPS_API_URL;
      const fullUrl = `${baseUrl}${path}`;
      return await fetch(fullUrl, { ...options, headers });
    };

    let response = await makeRequest(tokenRef.current);

    const currentRefreshToken = refreshTokenRef.current;
    if (response.status === 401 && currentRefreshToken && path !== "/api/auth/refresh" && path !== "/api/auth/oauth-token") {
      try {
        let newAccessToken: string;

        if (!refreshPromiseRef.current) {
          refreshPromiseRef.current = (async () => {
            try {
              const refreshRes = await fetch(`${VPS_API_URL}/api/auth/refresh`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refresh_token: currentRefreshToken })
              });

              if (!refreshRes.ok) {
                throw new Error("Refresh response was not OK");
              }

              const refreshData = await refreshRes.json();
              const tokenVal = refreshData.access_token;
              
              setToken(tokenVal);
              localStorage.setItem("lixionary_token", tokenVal);
              
              if (refreshData.refresh_token) {
                setRefreshToken(refreshData.refresh_token);
                localStorage.setItem("lixionary_refresh_token", refreshData.refresh_token);
              }
              
              return tokenVal;
            } finally {
              // Reset the promise on the next tick so future token expirations can trigger a new refresh,
              // while concurrent requests on the same tick all share this single promise.
              setTimeout(() => {
                refreshPromiseRef.current = null;
              }, 1000);
            }
          })();
        }

        newAccessToken = await refreshPromiseRef.current;

        // Retry the request with the new access token
        response = await makeRequest(newAccessToken);
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

  // Local-first sync: reconciles the sidecar's local store against the cloud
  // for the given entity types. Conflicts (dirty locally AND moved on cloud
  // since last sync) accumulate in syncConflicts for the SyncConflictModal to
  // resolve — resolved elsewhere or no longer applicable, they're replaced with
  // whatever this pass finds for the same entity types, never silently dropped.
  const triggerSync = async (entityTypes: import("./syncEngine").EntityType[] = ["environment", "auth_function", "browser_profile", "collection"]) => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    lastSyncAttemptRef.current = Date.now();
    setSyncStatus("syncing");
    try {
      if (!deviceIdRef.current) {
        const { deviceId } = await apiCall("/api/local-store/device-id");
        deviceIdRef.current = deviceId;
      }
      const conflicts = await runAllSync(apiCall, deviceIdRef.current!, entityTypes);
      setSyncConflicts((prev) => [...prev.filter((c) => !entityTypes.includes(c.entityType)), ...conflicts]);
      // Refetch whichever local state changed so the UI reflects synced content
      // (new cloudIds, pulled remote edits, FK-remapped references, etc).
      if (entityTypes.includes("environment")) fetchEnvironments();
      if (entityTypes.includes("auth_function")) fetchAuthFunctions();
      if (entityTypes.includes("browser_profile")) fetchProfiles();
      if (entityTypes.includes("collection")) fetchCollections();

      // runAllSync deliberately never throws on connectivity issues (each entity
      // type's pass is independently resilient), so it can't tell us whether the
      // cloud was actually reachable this pass — probe its lightest endpoint
      // directly rather than changing that contract.
      try {
        await apiCall("/api/environments/sync-state");
        setIsOnline(true);
        setLastSyncAt(new Date().toISOString());
      } catch {
        setIsOnline(false);
      }
      setSyncStatus("idle");
    } catch (e) {
      console.warn("[sync] sync pass failed", e);
      setSyncStatus("error");
    } finally {
      syncInFlightRef.current = false;
    }
  };

  // User resolved a conflict card in SyncConflictModal.
  const resolveSyncConflict = async (conflict: SyncConflict, choice: "local" | "cloud") => {
    try {
      if (choice === "local") {
        await resolveConflictKeepLocal(conflict, apiCall, deviceIdRef.current!);
      } else {
        await resolveConflictKeepCloud(conflict, apiCall);
      }
      setSyncConflicts((prev) => prev.filter((c) => !(c.entityType === conflict.entityType && c.localId === conflict.localId)));
      if (conflict.entityType === "environment") fetchEnvironments();
      if (conflict.entityType === "auth_function") fetchAuthFunctions();
      if (conflict.entityType === "browser_profile") fetchProfiles();
      if (conflict.entityType === "collection") fetchCollections();
    } catch (e: any) {
      throw new Error(`Failed to resolve conflict: ${e.message}`);
    }
  };

  const handleLogin = async (code: string) => {
    try {
      const data = await apiCall("/api/auth/google/exchange", {
        method: "POST",
        body: JSON.stringify({ code, redirect_uri: process.env.NEXT_PUBLIC_REDIRECT_URI || "http://localhost:8481/callback" })
      });
      // Direct Google sign-in issues a flat JWT with no refresh token — the
      // session simply expires after JWT_EXPIRY_MINUTES and requires a fresh
      // login, rather than the old IAM flow's silent access/refresh pair.
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
      const data = await apiCall("/api/local-store/environment");
      const mapped: Environment[] = data.map((r: any) => ({
        id: r.localId,
        cloudId: r.cloudId,
        name: r.name,
        variables: r.variables || [],
      }));
      setEnvironments(mapped);
      if (mapped.length && !selectedEnvId) {
        setSelectedEnvId(mapped[0].id);
      }
    } catch (e) {
      console.error("Failed to fetch environments", e);
    }
  };

  const fetchAuthFunctions = async () => {
    try {
      const data = await apiCall("/api/local-store/auth_function");
      const mapped: AuthFunction[] = data.map((r: any) => ({
        id: r.localId,
        cloudId: r.cloudId,
        name: r.name,
        description: r.description,
        script: r.script,
        expires_in: r.expires_in,
        cachedToken: r.cachedToken,
        expiresAt: r.expiresAt,
      }));
      setAuthFunctions(mapped);
    } catch (e) {
      console.error("Failed to fetch auth functions", e);
    }
  };

  const fetchUserGuides = async () => {
    try {
      const data = await apiCall("/api/user-guides");
      setUserGuides(data);
    } catch (e) {
      console.error("Failed to fetch user guides", e);
    }
  };

  const fetchCollections = async () => {
    try {
      const data = await apiCall("/api/local-store/collection");
      const mapped: Collection[] = data.map((r: any) => ({
        id: r.localId,
        cloudId: r.cloudId,
        name: r.name,
        description: r.description,
        ownerId: r.ownerId,
        collaboratorIds: r.collaboratorIds,
        requests: r.requests || [],
        children: r.children || [],
      }));
      setCollections(mapped);
      if (mapped.length && !selectedCollectionId) {
        setSelectedCollectionId(mapped[0].id);
        if (mapped[0].requests.length) {
          setSelectedRequestId(mapped[0].requests[0].id);
        }
      }
    } catch (e) {
      console.error("Failed to fetch collections", e);
    }
  };

  // Shared by every collection-tree mutation (add/rename/move/delete a request
  // or sub-collection): merges `updates` onto the current root collection and
  // writes the FULL merged object to local-store (a whole-blob replace, unlike
  // the cloud route's partial $set), then refetches + kicks a background sync.
  const persistCollectionTree = async (
    rootColId: string,
    updates: Partial<Pick<Collection, "name" | "description" | "requests" | "children">>
  ): Promise<void> => {
    const current = collections.find((c) => c.id === rootColId);
    if (!current) throw new Error("Collection not found.");
    const merged: Collection = { ...current, ...updates };
    await apiCall(`/api/local-store/collection/${rootColId}`, {
      method: "PUT",
      body: JSON.stringify({
        payload: {
          name: merged.name,
          description: merged.description,
          ownerId: merged.ownerId,
          collaboratorIds: merged.collaboratorIds,
          requests: merged.requests,
          children: merged.children,
        }
      })
    });
    await fetchCollections();
    triggerSync(["auth_function", "collection"]);
  };

  const fetchProfiles = async () => {
    try {
      const data = await apiCall("/api/local-store/browser_profile");
      const mapped: BrowserProfile[] = data.map((r: any) => ({
        id: r.localId,
        cloudId: r.cloudId,
        name: r.name,
        cookies: r.cookies,
        localStorage: r.localStorage,
        authFunctionId: r.authFunctionId,
        authInjection: r.authInjection,
        defaultUrl: r.defaultUrl,
      }));
      setProfiles(mapped);
      if (mapped.length && !selectedProfileId) {
        setSelectedProfileId(mapped[0].id);
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

    const localWsHost = LOCAL_API_URL.replace(/^http(s)?:\/\//, "ws$1://");
    let wsUrl = `${localWsHost}/api/browser/ws/browser-session/${sessId}?token=${token}`;
    if (profileId) {
      wsUrl += `&profileId=${profileId}`;
    }
    if (selectedEnvId) {
      wsUrl += `&envId=${selectedEnvId}`;
    }

    console.log(`Connecting WebSocket browser stream: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = async () => {
      console.log("WebSocket browser stream opened. Sending init data...");
      const profile = profiles.find((p) => p.id === profileId);
      let cookies: any[] = [];
      let localStorageData: any = null;
      let defaultUrl = "";

      if (profile) {
        defaultUrl = profile.defaultUrl || "";
        try {
          cookies = profile.cookies ? JSON.parse(profile.cookies) : [];
        } catch {}
        try {
          localStorageData = profile.localStorage ? JSON.parse(profile.localStorage) : null;
        } catch {}

        // The cloud endpoint resolves the auth function id (a path segment, not
        // optional) as a Mongo _id — skip the token fetch entirely if it hasn't
        // synced yet rather than send an id the cloud can't parse.
        const authFunctionCloudId = resolveAuthFunctionCloudId(profile.authFunctionId);
        if (authFunctionCloudId && profile.authInjection) {
          try {
            // Same reasoning for envId — an environment that hasn't synced yet
            // only has a local id, so omit the param instead.
            const tokenUrl = selectedEnvCloudId
              ? `/api/auth-functions/${authFunctionCloudId}/token?envId=${selectedEnvCloudId}`
              : `/api/auth-functions/${authFunctionCloudId}/token`;
            const tokenData = await apiCall(tokenUrl);
            if (tokenData && tokenData.token) {
              const tokenVal = tokenData.token;

              const injType = profile.authInjection.type;
              const injKey = profile.authInjection.key;
              const domainOrOrigin = profile.authInjection.domainOrOrigin;

              if (injType === "cookie") {
                cookies = cookies.filter((c: any) => c.name !== injKey);
                cookies.push({ name: injKey, value: tokenVal, domain: domainOrOrigin, path: "/" });
              } else if (injType === "localStorage") {
                if (!localStorageData) localStorageData = { origins: [] };
                if (!localStorageData.origins) localStorageData.origins = [];
                const targetOrigin = domainOrOrigin.toLowerCase().replace(/\/$/, "");
                let originEntry = localStorageData.origins.find(
                  (e: any) => e.origin.toLowerCase().replace(/\/$/, "") === targetOrigin
                );
                if (!originEntry) {
                  originEntry = { origin: domainOrOrigin, localStorage: [] };
                  localStorageData.origins.push(originEntry);
                }
                originEntry.localStorage = originEntry.localStorage.filter((kv: any) => kv.name !== injKey);
                originEntry.localStorage.push({ name: injKey, value: tokenVal });
              }
            }
          } catch (err) {
            console.error("Failed to resolve auth function hook on frontend:", err);
          }
        }
      }

      ws.send(JSON.stringify({
        action: "init",
        cookies,
        localStorage: localStorageData,
        defaultUrl
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      console.log("WS Event:", msg.type, msg);

      switch (msg.type) {
        case "status":
          setIsBrowserConnected(true);
          setBrowserUrl(msg.data.url);
          setBrowserTabs([{ index: 0, url: msg.data.url }]);
          setActiveTabIndex(0);
          setVncUrl("");
          break;
        case "screencast_frame":
          setScreencastFrame(msg.data.image);
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
        case "element_selected": {
          setSelectedElement(msg.data.element);
          setSelectedElementLocators(msg.data.locators);
          setSelectedElementStale({ stale: !!msg.data.stale, reason: msg.data.staleReason || null });
          setSelectedElementTestValue("");
          setIsVerifying(false);
          setVerifyAttempts([]);
          setVerifyResult(null);
          if (msg.data.locators.length) {
            const actionPrefixes: Record<string, string> = {
              click: "click", fill: "fill", type: "type", check: "check",
              select_option: "select", hover: "hover", getText: "get",
            };
            const prefix = actionPrefixes[selectedElementAction] || "click";
            setSelectedElementMethodName(`${prefix}_${msg.data.element.tagName}_${msg.data.locators[0].strategy}`);
          }
          break;
        }
        case "element_selected_error":
          setInspectError(msg.data.message || "Failed to inspect element");
          break;
        case "verify_started":
          setIsVerifying(true);
          setVerifyAttempts([]);
          setVerifyResult(null);
          break;
        case "verify_attempt":
          setVerifyAttempts((prev) => [...prev, msg.data]);
          break;
        case "verify_result":
          setIsVerifying(false);
          setVerifyResult({ success: msg.data.success, resultText: msg.data.resultText });
          if (msg.data.success && msg.data.winningLocator) {
            const winner = msg.data.winningLocator;
            setSelectedElementLocators((prev) => {
              const idx = prev.findIndex((l) => l.strategy === winner.strategy && l.selector === winner.selector);
              if (idx > 0) return [prev[idx], ...prev.filter((_, i) => i !== idx)];
              if (idx === -1) return [winner, ...prev];
              return prev;
            });
          }
          break;
        case "page_scan_started":
          setPageScanStatus("scanning");
          setPageScanError(null);
          break;
        case "page_scan_result":
          setPageScanResults(msg.data.elements);
          setPageScanScopeLabel(msg.data.scopeLabel || null);
          setPageScanStatus("done");
          break;
        case "page_scan_error":
          setPageScanError(msg.data.message || "Page scan failed");
          setPageScanStatus("error");
          break;
        case "explore_started":
          setIsExploring(true);
          setExploreSteps([]);
          setPageScanResults(null);
          setPageScanScopeLabel(null);
          setPageScanError(null);
          setPageScanStatus("scanning");
          break;
        case "explore_step":
          setExploreSteps((prev) => [...prev, msg.data]);
          break;
        case "explore_result":
          setIsExploring(false);
          // Reuse the Scan result slots so the existing review drawer picks this up unchanged.
          setPageScanResults(msg.data.elements);
          setPageScanScopeLabel(msg.data.scopeLabel || null);
          setPageScanStatus("done");
          break;
        case "explore_error":
          setIsExploring(false);
          setPageScanError(msg.data.message || "Exploration failed");
          setPageScanStatus("error");
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
      setPageScanStatus("idle");
      setPageScanError(null);
      setPageScanResults(null);
      setPageScanScopeLabel(null);
      // Don't leave the VNC view stuck watch-only if the connection drops
      // mid-Verify/Explore — there'd be no other signal left to clear these.
      setIsVerifying(false);
      setIsExploring(false);
      
      // Auto-terminate the session on WebSocket close since the browser was shut down or connection dropped/errored.
      setTimeout(() => {
        handleCloseSession(sessId);
      }, 100);
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
        setScreencastFrame(null);
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
    setSelectedElementStale({ stale: false, reason: null });
    setPageScanStatus("idle");
    setPageScanError(null);
    setPageScanResults(null);
    setPageScanScopeLabel(null);
    setBrowserTabs([]);
    setActiveTabIndex(0);
    setVncUrl(""); // Empty initially; will be populated dynamically by the WebSocket status message
    setScreencastFrame(null);
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
      setSelectedElementStale({ stale: false, reason: null });
      setBrowserTabs([]);
      setActiveTabIndex(0);
      setVncUrl(""); // Empty initially; will be populated dynamically by the WebSocket status message
      setScreencastFrame(null);
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
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
    }
    setIsBrowserConnected(false);
    setInspectMode(false);
    setVncUrl("");
    setScreencastFrame(null);
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

  const handleScanPage = (scope: "page" | "selected" = "page") => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setPageScanStatus("scanning");
      setPageScanError(null);
      setPageScanResults(null);
      setPageScanScopeLabel(null);
      wsRef.current.send(JSON.stringify({ action: "scan-page", scope }));
    } else {
      console.warn("[Lixionary] WebSocket not open, cannot scan page");
    }
  };

  const handleVerifyElement = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!selectedElementLocators.length) return;
    wsRef.current.send(JSON.stringify({
      action: "verify",
      verifyAction: selectedElementAction,
      locators: selectedElementLocators.map((l) => ({ strategy: l.strategy, selector: l.selector })),
      value: ["fill", "type", "select_option"].includes(selectedElementAction) ? selectedElementTestValue : undefined,
      element: selectedElement,
    }));
  };

  const resetPageScan = () => {
    setPageScanStatus("idle");
    setPageScanError(null);
    setPageScanResults(null);
    setPageScanScopeLabel(null);
  };

  const handleStartExplore = (scope: "page" | "selected" = "page") => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "explore", prompt: explorePrompt, scope }));
  };

  const handleStopExplore = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "stop-explore" }));
    }
    // Unlock the VNC view and toolbar immediately rather than waiting for the
    // backend's finalization pass (resolving + naming every discovered element,
    // which can take several seconds) to send explore_result/explore_error.
    // Finalization only counts/reads locators and calls Gemini — it never
    // drives the live page — so it's safe to hand control back to the user
    // right away; pageScanStatus stays "scanning" until the real result lands,
    // which still keeps the Scan button disabled to avoid a result-overwrite race.
    setIsExploring(false);
  };

  const handleClearNetworkLogs = () => {
    setNetworkLogs([]);
    setSelectedLogId(null);
    setLogDetails(null);
    setNetworkPillFilter("all");
  };

  const sendBrowserMouseEvent = (type: "click" | "move" | "down" | "up", x: number, y: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: `mouse_${type}`,
        x,
        y
      }));
    }
  };

  const sendBrowserWheelEvent = (deltaX: number, deltaY: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: "mouse_wheel",
        deltaX,
        deltaY
      }));
    }
  };

  const sendBrowserKeyboardEvent = (key: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: "keyboard_press",
        key
      }));
    }
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
       const res = await fetch(`${LOCAL_API_URL}/api/browser/network/${sessId}/logs`, {
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
       const res = await fetch(`${LOCAL_API_URL}/api/browser/network/${sessionId}/details/${encodeURIComponent(logId)}`, {
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
          authFunctionId: resolveAuthFunctionCloudId(reqAuthConfig.authFunctionId)
        },
        responseParserScript: reqParserScript,
        // Cloud resolves this as a Mongo _id — fall back to none if the selected
        // environment hasn't synced to the cloud yet (only has a local id so far).
        environmentId: selectedEnvCloudId
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
          // HOOK auth function is user-local — don't embed in the shared collection document
          authFunctionId: reqAuthType === "HOOK" ? null : (reqAuthConfig.authFunctionId || null)
        },
        responseParserScript: reqParserScript
      };

      const updatedCol = updateRequestInTree(col, selectedRequestId, updatedRequest);

      await persistCollectionTree(col.id, { requests: updatedCol.requests, children: updatedCol.children || [] });

      // Saved state is now authoritative — drop the unsaved auth override.
      // Exception: HOOK auth is kept user-local in localStorage (not in DB), so don't clear it.
      if (reqAuthType !== "HOOK") {
        try { localStorage.removeItem(`lixionary_auth_${selectedRequestId}`); } catch { /* non-fatal */ }
      }
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

      await persistCollectionTree(col.id, { requests: updatedCol.requests, children: updatedCol.children || [] });
      setSelectedRequestId(newRequest.id);
    } catch (e: any) {
      throw new Error(`Failed to add request: ${e.message}`);
    }
  };

  const persistRequestToCollection = async (
    col: Collection,
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
  ): Promise<void> => {
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

    await persistCollectionTree(col.id, { requests: updatedCol.requests, children: updatedCol.children || [] });
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
    await persistRequestToCollection(col, targetColId, requestName, requestData);
  };

  const handleSaveNetworkRequestToNewCollection = async (
    newCollectionName: string,
    requestName: string,
    requestData: {
      method: string;
      url: string;
      headers: { key: string; value: string }[];
      queryParams: { key: string; value: string }[];
      bodyType: string;
      body: string;
    }
  ): Promise<void> => {
    const newCol = await createCollection(newCollectionName);
    await persistRequestToCollection(newCol, newCol.id, requestName, requestData);
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

      await persistCollectionTree(col.id, { requests: updatedCol.requests, children: updatedCol.children || [] });
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

        await persistCollectionTree(sourceRootCol.id, { requests: updatedCol.requests, children: updatedCol.children || [] });
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
        await persistCollectionTree(targetRootCol.id, { requests: updatedTargetCol.requests, children: updatedTargetCol.children || [] });

        // Save source second
        await persistCollectionTree(sourceRootCol.id, { requests: updatedSourceCol.requests, children: updatedSourceCol.children || [] });
      }
    } catch (e: any) {
      throw new Error(`Failed to move item: ${e.message}`);
    }
  };

  const handleDeleteNode = async (nodeId: string, nodeType: "request" | "collection") => {
    try {
      if (nodeType === "collection" && collections.some(c => c.id === nodeId)) {
        await apiCall(`/api/local-store/collection/${nodeId}`, { method: "DELETE" });
        if (selectedCollectionId === nodeId) {
          setSelectedCollectionId("");
          setSelectedRequestId("");
        }
        await fetchCollections();
        triggerSync(["collection"]);
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

      await persistCollectionTree(col.id, { requests: updatedCol.requests, children: updatedCol.children || [] });

      if (nodeType === "request" && selectedRequestId === nodeId) {
        setSelectedRequestId("");
      }
    } catch (e: any) {
      throw new Error(`Failed to delete item: ${e.message}`);
    }
  };

  const handleRenameNode = async (nodeId: string, nodeType: "request" | "collection", newName: string) => {
    try {
      if (nodeType === "collection" && collections.some(c => c.id === nodeId)) {
        await persistCollectionTree(nodeId, { name: newName });
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

      await persistCollectionTree(col.id, { requests: updatedCol.requests, children: updatedCol.children || [] });

      if (nodeType === "request" && selectedRequestId === nodeId) {
        setReqName(newName);
      }
    } catch (e: any) {
      throw new Error(`Failed to rename item: ${e.message}`);
    }
  };

  const createCollection = async (name: string): Promise<Collection> => {
    const result = await apiCall("/api/local-store/collection", {
      method: "POST",
      body: JSON.stringify({ payload: { name, description: "", requests: [], children: [] } })
    });
    await fetchCollections();
    triggerSync(["collection"]);
    return {
      id: result.localId,
      cloudId: result.cloudId,
      name: result.name,
      description: result.description,
      requests: result.requests || [],
      children: result.children || [],
    };
  };

  const handleCreateCollection = async (name: string) => {
    try {
      const result = await createCollection(name);
      setSelectedCollectionId(result.id);
    } catch (e: any) {
      throw new Error(`Failed to create collection: ${e.message}`);
    }
  };

  // Importing/sharing a collection is inherently a cloud operation (resolving
  // another user's identity, granting cloud-side access) — stays cloud-only,
  // unlike the local-first CRUD above. Once it succeeds, a sync pass pulls the
  // now-shared collection into this device's local store.
  const handleImportCollection = async (id: string) => {
    try {
      await apiCall(`/api/collections/${id}`);
      await apiCall(`/api/collections/${id}/collaborators`, {
        method: "POST",
        body: JSON.stringify({ userId: user.id })
      });
      await triggerSync(["collection"]);
      const localRecords = await apiCall("/api/local-store/collection");
      const imported = localRecords.find((r: any) => r.cloudId === id);
      if (imported) setSelectedCollectionId(imported.localId);
    } catch (e: any) {
      throw new Error(`Import failed: ${e.message}`);
    }
  };

  const handleAddCollaborator = async (email: string) => {
    if (!selectedCollectionId) return;
    const col = collections.find((c) => c.id === selectedCollectionId);
    if (!col?.cloudId) throw new Error("This collection hasn't finished syncing yet — try again in a moment.");
    try {
      await apiCall(`/api/collections/${col.cloudId}/collaborators`, {
        method: "POST",
        body: JSON.stringify({ email })
      });
      triggerSync(["collection"]);
    } catch (e: any) {
      throw new Error(`Sharing failed: ${e.message}`);
    }
  };

  const handleSaveEnv = async (name: string, variables: { key: string; value: string; isSecret: boolean }[], id: string | null) => {
    try {
      if (id) {
        await apiCall(`/api/local-store/environment/${id}`, {
          method: "PUT",
          body: JSON.stringify({ payload: { name, variables } })
        });
      } else {
        await apiCall("/api/local-store/environment", {
          method: "POST",
          body: JSON.stringify({ payload: { name, variables } })
        });
      }
      fetchEnvironments();
      triggerSync(["environment"]);
    } catch (e: any) {
      throw new Error(`Failed to save environment: ${e.message}`);
    }
  };

  const handleDeleteEnv = async (id: string) => {
    try {
      await apiCall(`/api/local-store/environment/${id}`, { method: "DELETE" });
      fetchEnvironments();
      triggerSync(["environment"]);
      if (selectedEnvId === id) setSelectedEnvId("");
    } catch (e: any) {
      throw new Error(`Delete failed: ${e.message}`);
    }
  };

  const handleSaveAuthFunc = async (name: string, description: string, script: string, expires_in: number | null, id: string | null) => {
    try {
      if (id) {
        await apiCall(`/api/local-store/auth_function/${id}`, {
          method: "PUT",
          body: JSON.stringify({ payload: { name, description, script, expires_in } })
        });
      } else {
        await apiCall("/api/local-store/auth_function", {
          method: "POST",
          body: JSON.stringify({ payload: { name, description, script, expires_in } })
        });
      }
      fetchAuthFunctions();
      triggerSync(["auth_function", "browser_profile", "collection"]);
    } catch (e: any) {
      throw new Error(`Failed to save auth function: ${e.message}`);
    }
  };

  const handleDeleteAuthFunc = async (id: string) => {
    try {
      await apiCall(`/api/local-store/auth_function/${id}`, { method: "DELETE" });
      fetchAuthFunctions();
      triggerSync(["auth_function"]);
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
        await apiCall(`/api/local-store/browser_profile/${id}`, {
          method: "PUT",
          body: JSON.stringify({ payload: { name, cookies, localStorage, authFunctionId, authInjection, defaultUrl } })
        });
      } else {
        await apiCall("/api/local-store/browser_profile", {
          method: "POST",
          body: JSON.stringify({ payload: { name, cookies, localStorage, authFunctionId, authInjection, defaultUrl } })
        });
      }
      await fetchProfiles();
      triggerSync(["auth_function", "browser_profile"]);
    } catch (e: any) {
      throw new Error(`Failed to save browser profile: ${e.message}`);
    }
  };

  const handleDeleteProfile = async (id: string) => {
    try {
      await apiCall(`/api/local-store/browser_profile/${id}`, { method: "DELETE" });
      await fetchProfiles();
      triggerSync(["browser_profile"]);
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
        selectedEnvCloudId,
        setSelectedEnvId,
        fetchEnvironments,
        authFunctions,
        fetchAuthFunctions,
        resolveAuthFunctionCloudId,
        syncConflicts,
        resolveSyncConflict,
        isOnline,
        lastSyncAt,
        syncStatus,
        triggerSync,
        userGuides,
        fetchUserGuides,
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
        sendBrowserMouseEvent,
        sendBrowserWheelEvent,
        sendBrowserKeyboardEvent,
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
        handleSaveNetworkRequestToNewCollection,
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
