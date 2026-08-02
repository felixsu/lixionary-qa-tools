"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { runAllSync, resolveConflictKeepLocal, resolveConflictKeepCloud } from "./syncEngine";
import type { SyncConflict } from "./syncEngine";
import { scanInputNames } from "../utils/requestTokens";
import type { Flow } from "../utils/flowTypes";
import { generateDuplicateName } from "../utils/uniqueName";
import { useBackendStatus } from "./BackendStatusContext";
import { useToast } from "./ToastContext";
import { isTauri } from "../utils/tauri";
import { copyDiagnostics, recordNetworkEntry, redactBodyForUrl } from "../utils/diagnostics";

const VPS_API_URL = process.env.NEXT_PUBLIC_VPS_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'http://localhost:8000' : 'https://qa-tools-api.lixionary.com');
const LOCAL_API_URL = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:8484';


// Types
export type LlmProvider = "claude" | "minimax" | "gemini";

// The full device-local llm_settings pref (raw API keys included) is only
// ever read/written by the Settings page; this summary is what the rest of
// the app needs to gate AI features.
export interface LlmSettingsSummary {
  activeProvider: LlmProvider | null;
  hasKey: boolean;
}

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
}

export interface UserGuideSummary {
  id: string;
  title: string;
  description: string;
  blockCount: number;
  updatedAt?: string;
  parentId?: string | null;
  order?: number;
  slug?: string | null;
}

export interface InputBinding {
  name: string;
  source: "literal" | "generator";
  // literal: free-typed value (may contain {{env.X}} / {{$...}} tokens);
  // generator: token body without braces, e.g. "$date:+1d:YYYY-MM-DD"
  value: string;
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
    tokenField?: string;
  };
  responseParserScript?: string;
  requestInterceptorScript?: string;
  testScript?: string;
  inputs?: InputBinding[];
  outputs?: string[];
  // Output name -> description, purely descriptive metadata (never sent to the executor).
  outputDescriptions?: Record<string, string>;
  // Markdown documentation for the request (never sent to the executor).
  description?: string;
  lastResponse?: any;
  // ISO timestamp of the last successful send — powers the Home page's Recent activity widget.
  lastRunAt?: string;
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

export interface BrowserProfile {
  id: string; // local-store localId — stable offline, before any cloud sync
  cloudId?: string | null; // Mongo _id once synced
  name: string;
  cookies: string;
  localStorage: string;
  authFunctionId?: string;
  authInjections?: Array<{ type: string; key: string; domainOrOrigin: string; sourceField?: string }>;
  defaultUrl?: string;
  headless?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
  createdAt?: string;
}

interface AppContextType {
  // Auth State
  token: string | null;
  user: any;
  isLoadingAuth: boolean;
  handleLogin: (email: string) => Promise<void>;
  handleLogout: () => void;

  // Databases & Shared States
  environments: Environment[];
  selectedEnvId: string;
  setSelectedEnvId: (id: string) => void;
  fetchEnvironments: () => Promise<Environment[]>;
  authFunctions: AuthFunction[];
  fetchAuthFunctions: () => Promise<AuthFunction[]>;
  syncConflicts: SyncConflict[];
  resolveSyncConflict: (conflict: SyncConflict, choice: "local" | "cloud") => Promise<void>;
  isOnline: boolean;
  lastSyncAt: string | null;
  syncStatus: "idle" | "syncing" | "error";
  triggerSync: (entityTypes?: import("./syncEngine").EntityType[], opts?: { notify?: boolean }) => Promise<void>;
  userGuides: UserGuideSummary[];
  fetchUserGuides: () => Promise<void>;
  collections: Collection[];
  selectedCollectionId: string;
  setSelectedCollectionId: (id: string) => void;
  selectedRequestId: string;
  setSelectedRequestId: (id: string) => void;
  fetchCollections: () => Promise<void>;

  // API Studio Flows
  flows: Flow[];
  fetchFlows: () => Promise<void>;
  createFlow: (name: string) => Promise<Flow>;
  updateFlow: (id: string, updates: Partial<Pick<Flow, "name" | "description" | "nodes" | "edges">>, baseFlow?: Flow) => Promise<void>;
  deleteFlow: (id: string) => Promise<void>;

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
  reqInterceptorScript: string;
  setReqInterceptorScript: (script: string) => void;
  reqTestScript: string;
  setReqTestScript: (script: string) => void;
  reqInputs: InputBinding[];
  setReqInputs: React.Dispatch<React.SetStateAction<InputBinding[]>>;
  reqOutputs: string[];
  setReqOutputs: React.Dispatch<React.SetStateAction<string[]>>;
  reqOutputDescriptions: Record<string, string>;
  setReqOutputDescriptions: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  reqDescription: string;
  setReqDescription: React.Dispatch<React.SetStateAction<string>>;

  // API Explorer Response State
  apiResponse: any;
  setApiResponse: (res: any) => void;
  isExecutingApi: boolean;
  setIsExecutingApi: (executing: boolean) => void;
  responseTab: "pretty" | "headers" | "raw" | "extracted" | "tests" | "last";
  setResponseTab: (tab: "pretty" | "headers" | "raw" | "extracted" | "tests" | "last") => void;
  showAiModal: boolean;
  setShowAiModal: (show: boolean) => void;
  aiPrompt: string;
  setAiPrompt: (prompt: string) => void;
  isGeneratingAiParser: boolean;
  setIsGeneratingAiParser: (generating: boolean) => void;

  // Browser Profiles State
  profiles: BrowserProfile[];
  fetchProfiles: () => Promise<void>;
  selectedProfileId: string;
  setSelectedProfileId: (id: string) => void;

  // Device-local prefs (sidecar SQLite; survive app updates, never sync to cloud)
  getPref: (key: string) => Promise<string | null>;
  setPref: (key: string, value: string) => Promise<void>;
  deletePref: (key: string) => Promise<void>;

  // BYOK LLM provider settings (summary for gating AI features; the Settings
  // page reads/writes the full llm_settings pref itself)
  llmSettings: LlmSettingsSummary | null;
  refreshLlmSettings: () => Promise<void>;

  // Common operations
  apiCall: (path: string, options?: RequestInit) => Promise<any>;
  apiFetch: (path: string, options?: RequestInit, record?: boolean) => Promise<Response>;
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
  handleDuplicateRequest: (req: RequestItem) => Promise<void>;
  handleCreateCollection: (name: string) => Promise<void>;
  handleImportCollection: (id: string) => Promise<void>;
  importCollectionTree: (payload: import("../utils/collectionTransfer").CollectionTransferPayload) => Promise<Collection>;
  handleAddCollaborator: (email: string) => Promise<void>;
  handleSaveEnv: (name: string, variables: { key: string; value: string; isSecret: boolean }[], id: string | null) => Promise<void>;
  handleDeleteEnv: (id: string) => Promise<void>;
  handleDuplicateEnv: (env: Environment) => Promise<void>;
  handleSaveAuthFunc: (name: string, description: string, script: string, expires_in: number | null, id: string | null) => Promise<void>;
  handleDeleteAuthFunc: (id: string) => Promise<void>;

  handleSaveProfile: (
    name: string,
    cookies: string,
    localStorage: string,
    authFunctionId: string | null,
    authInjections: Array<{ type: string; key: string; domainOrOrigin: string; sourceField?: string }> | null,
    defaultUrl: string,
    headless: boolean,
    viewportWidth: number,
    viewportHeight: number,
    id: string | null
  ) => Promise<void>;
  handleDeleteProfile: (id: string) => Promise<void>;
  handleDuplicateProfile: (profile: BrowserProfile) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { tauri, sidecar, localDb } = useBackendStatus();
  const { showToast } = useToast();

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
  // Holds the in-flight sync promise (not just a boolean) so overlapping
  // triggers await the same pass instead of one silently resolving with
  // nothing while the other is still running.
  const syncInFlightPromiseRef = useRef<Promise<void> | null>(null);
  const lastSyncAttemptRef = useRef<number>(0);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "error">("idle");

  // Databases & Shared States
  const [environments, setEnvironments] = useState<Environment[]>([]);
  // Persisted so a restart doesn't silently fall back to the first environment
  // (which made {{env.X}} tokens resolve against the wrong variable set).
  const [selectedEnvId, setSelectedEnvIdState] = useState<string>(() => {
    try {
      return localStorage.getItem("lixionary_selected_env") || "";
    } catch { return ""; }
  });
  const setSelectedEnvId = (id: string) => {
    setSelectedEnvIdState(id);
    try { localStorage.setItem("lixionary_selected_env", id); } catch { /* non-fatal */ }
  };
  const [authFunctions, setAuthFunctions] = useState<AuthFunction[]>([]);
  const [userGuides, setUserGuides] = useState<UserGuideSummary[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [selectedRequestId, setSelectedRequestId] = useState<string>("");
  // Mirror of the committed selection for async callbacks that run inside
  // stale closures — the background-sync effects (focus listener, 5-minute
  // interval) capture triggerSync/fetchCollections from an old render where
  // selectedCollectionId was still "", which made every background sync
  // re-trigger the first-load auto-select and yank the user back to the first
  // request of the first collection.
  const selectedCollectionIdRef = useRef(selectedCollectionId);
  // eslint-disable-next-line react-hooks/refs -- intentional latest-ref pattern; see comment above
  selectedCollectionIdRef.current = selectedCollectionId;

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
  const [reqInterceptorScript, setReqInterceptorScript] = useState("");
  const [reqTestScript, setReqTestScript] = useState("");
  const [reqInputs, setReqInputs] = useState<InputBinding[]>([]);
  const [reqOutputs, setReqOutputs] = useState<string[]>([]);
  const [reqOutputDescriptions, setReqOutputDescriptions] = useState<Record<string, string>>({});
  const [reqDescription, setReqDescription] = useState("");

  // API Explorer Response State
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [isExecutingApi, setIsExecutingApi] = useState(false);
  const [responseTab, setResponseTab] = useState<"pretty" | "headers" | "raw" | "extracted" | "tests" | "last">("pretty");
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGeneratingAiParser, setIsGeneratingAiParser] = useState(false);

  // Browser Profiles State
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");

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

  // The very first sync attempt on a fresh/cold launch (see the [token] effect
  // above) can lose the race against a still-booting sidecar and silently fail
  // — after that, the focus listener and 5-minute interval above are the only
  // retries, neither of which fires promptly right when the sidecar actually
  // becomes ready. Watch the backend-status panel's localDb signal (only "ok"
  // once the exact endpoint triggerSync needs has been proven reachable) and
  // fire an immediate sync the moment it flips ready. deviceIdRef being cached
  // after the first successful sync means this is a no-op on warm launches.
  const prevLocalDbStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const prevStatus = prevLocalDbStatusRef.current;
    prevLocalDbStatusRef.current = localDb?.status ?? null;
    if (token && user && localDb?.status === "ok" && prevStatus !== "ok") {
      triggerSync();
    }
  }, [localDb?.status, token, user]);

  // Ref to suppress the auth-persist write on the render right after a selection
  // change (when reqAuthType/reqAuthConfig haven't synced to the new request yet).
  const authPersistIdRef = useRef<string>("");

  // Same suppression, for the declared-outputs auto-persist effect below.
  const outputsPersistIdRef = useRef<string>("");

  // Same suppression, for the description auto-persist effect below.
  const descriptionPersistIdRef = useRef<string>("");

  // Ref to skip re-hydrating the editor when `collections` merely gets a new
  // array identity from a background refetch (e.g. after Save or an execute
  // auto-persist) while the same request stays selected — otherwise every
  // reqXxx field and apiResponse get reset, visibly flashing the UI.
  const prevSelectedRequestIdRef = useRef<string | null>(null);

  // Device-local key/value prefs — for per-request editor state that must
  // stay off the shared/synced collection document (e.g. a HOOK auth binding,
  // which is user-local) but must still survive an app update/reinstall,
  // unlike browser localStorage.
  const getPref = async (key: string): Promise<string | null> => {
    try {
      const res = await apiCall(`/api/local-store/pref/${encodeURIComponent(key)}`);
      return res.value ?? null;
    } catch {
      return null;
    }
  };
  const setPref = async (key: string, value: string): Promise<void> => {
    try {
      await apiCall(`/api/local-store/pref/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      });
    } catch { /* non-fatal */ }
  };
  const deletePref = async (key: string): Promise<void> => {
    try {
      await apiCall(`/api/local-store/pref/${encodeURIComponent(key)}`, { method: "DELETE" });
    } catch { /* non-fatal */ }
  };

  // BYOK LLM provider settings summary — enough to gate AI features without
  // holding the raw keys in shared state. Refreshed after the Settings page saves.
  const [llmSettings, setLlmSettings] = useState<LlmSettingsSummary | null>(null);
  const refreshLlmSettings = async (): Promise<void> => {
    const raw = await getPref("llm_settings");
    if (raw === null) {
      setLlmSettings({ activeProvider: null, hasKey: false });
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const provider: LlmProvider | null =
        parsed?.activeProvider === "claude" || parsed?.activeProvider === "minimax" || parsed?.activeProvider === "gemini"
          ? parsed.activeProvider
          : null;
      const key = provider ? parsed?.keys?.[provider] : null;
      setLlmSettings({
        activeProvider: provider,
        hasKey: typeof key === "string" && key.trim().length > 0,
      });
    } catch {
      setLlmSettings({ activeProvider: null, hasKey: false });
    }
  };
  const sidecarUp = sidecar?.status === "ok" || sidecar?.status === "degraded";
  useEffect(() => {
    if (sidecarUp && llmSettings === null) refreshLlmSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidecarUp]);

  // Synchronize request inputs when selection changes
  useEffect(() => {
    if (selectedRequestId) {
      const col = findRequestOwnerCollection(collections, selectedRequestId);
      const req = col ? findRequestInTree(col, selectedRequestId) : null;
      if (req) {
        const selectionChanged = prevSelectedRequestIdRef.current !== selectedRequestId;
        prevSelectedRequestIdRef.current = selectedRequestId;
        if (!selectionChanged) return;

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

        // Auth: start from the saved request value, then overlay an unsaved
        // HOOK-auth override (device-local pref, never embedded in the shared
        // collection document).
        setReqAuthType(req.authType);
        setReqAuthConfig(req.authConfig || { token: "", key: "", value: "", authFunctionId: "" });
        const reqId = selectedRequestId;
        getPref(`auth_override:${reqId}`).then((override) => {
          if (!override || prevSelectedRequestIdRef.current !== reqId) return;
          try {
            const parsed = JSON.parse(override);
            if (parsed.authType) setReqAuthType(parsed.authType);
            if (parsed.authConfig) setReqAuthConfig(parsed.authConfig);
          } catch { /* ignore malformed override */ }
        });

        setReqParserScript(req.responseParserScript || "");
        setReqInterceptorScript(req.requestInterceptorScript || "");
        setReqTestScript(req.testScript || "");
        setReqInputs(req.inputs || []);

        // Declared outputs: start from the saved request value, then overlay
        // an unsaved draft (device-local pref) so in-progress edits survive
        // navigating away and back before Save.
        setReqOutputs(req.outputs || []);
        setReqOutputDescriptions(req.outputDescriptions || {});
        getPref(`outputs_override:${reqId}`).then((override) => {
          if (!override || prevSelectedRequestIdRef.current !== reqId) return;
          try {
            const parsed = JSON.parse(override);
            if (Array.isArray(parsed.outputs)) setReqOutputs(parsed.outputs);
            if (parsed.outputDescriptions) setReqOutputDescriptions(parsed.outputDescriptions);
          } catch { /* ignore malformed override */ }
        });

        // Description: saved value first, then overlay an unsaved draft.
        // Stored as the raw markdown string; null means "no draft", while an
        // empty string is a deliberately cleared draft and must still apply.
        setReqDescription(req.description || "");
        getPref(`description_override:${reqId}`).then((override) => {
          if (override === null || prevSelectedRequestIdRef.current !== reqId) return;
          setReqDescription(override);
        });

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
    setPref(`auth_override:${selectedRequestId}`, JSON.stringify({ authType: reqAuthType, authConfig: reqAuthConfig }));
  }, [reqAuthType, reqAuthConfig, selectedRequestId]);

  // Auto-persist declared-outputs edits per request so they survive
  // switches/reloads without a manual Save.
  useEffect(() => {
    if (!selectedRequestId) return;
    if (outputsPersistIdRef.current !== selectedRequestId) {
      // Selection just changed; outputs state not yet synced to this request — skip
      // this run. The follow-up render (once outputs state updates) writes correctly.
      outputsPersistIdRef.current = selectedRequestId;
      return;
    }
    setPref(`outputs_override:${selectedRequestId}`, JSON.stringify({ outputs: reqOutputs, outputDescriptions: reqOutputDescriptions }));
  }, [reqOutputs, reqOutputDescriptions, selectedRequestId]);

  // Auto-persist description edits per request so they survive
  // switches/reloads without a manual Save.
  useEffect(() => {
    if (!selectedRequestId) return;
    if (descriptionPersistIdRef.current !== selectedRequestId) {
      // Selection just changed; description state not yet synced to this request — skip
      // this run. The follow-up render (once description state updates) writes correctly.
      descriptionPersistIdRef.current = selectedRequestId;
      return;
    }
    setPref(`description_override:${selectedRequestId}`, reqDescription);
  }, [reqDescription, selectedRequestId]);

  // REST API helpers
  // Authenticated fetch with local/cloud routing, token refresh + retry, and
  // session-expiry logout. Returns the raw Response (ok or not) — use this
  // directly for streaming endpoints; use apiCall for normal JSON calls.
  // record=false skips diagnostics capture: recording clones the body and
  // reads it to completion, which would buffer an entire response stream.
  const apiFetch = async (path: string, options: RequestInit = {}, record: boolean = true): Promise<Response> => {
    let startedAt: number | null = null;
    const isLocal = path.startsWith("/api/browser") || path.startsWith("/api/workspace") || path.startsWith("/api/local-store") || path.startsWith("/api/executor") || path.startsWith("/api/ai");
    const baseUrl = isLocal ? LOCAL_API_URL : VPS_API_URL;
    const fullUrl = `${baseUrl}${path}`;

    const makeRequest = async (tok: string | null) => {
      if (startedAt === null) startedAt = Date.now();
      const headers = {
        "Content-Type": "application/json",
        ...(tok ? { "Authorization": `Bearer ${tok}` } : {}),
        ...(options.headers || {})
      };
      return await fetch(fullUrl, { ...options, headers });
    };

    let response = await makeRequest(tokenRef.current);

    const currentRefreshToken = refreshTokenRef.current;
    if (response.status === 401 && currentRefreshToken && path !== "/api/auth/refresh") {
      try {
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

        const newAccessToken = await refreshPromiseRef.current;

        // Retry the request with the new access token
        response = await makeRequest(newAccessToken);
      } catch (e) {
        console.error("Token refresh failed:", e);
        handleLogout();
      }
    } else if (response.status === 401 && !currentRefreshToken && !isLocal && tokenRef.current) {
      // Held a token, cloud backend rejected it, nothing to refresh with —
      // the session is simply over (a session predating the refresh-token
      // rollout, or one whose refresh token was revoked). Without this the
      // 401 escaped as a raw error from whatever call happened to run first,
      // typically a sync-state, and the app sat there looking signed in.
      // Scoped to cloud calls: a sidecar hiccup must not end the session.
      console.warn("Session expired with no refresh token available; signing out.");
      handleLogout();
    }

    if (record) {
      response.clone().text().then((text) => {
        recordNetworkEntry({
          method: options.method || "GET",
          url: fullUrl,
          status: response.status,
          durationMs: startedAt !== null ? Date.now() - startedAt : 0,
          requestBody: typeof options.body === "string" ? redactBodyForUrl(fullUrl, options.body) : undefined,
          responseBody: redactBodyForUrl(fullUrl, text),
          timestamp: Date.now(),
        });
      }).catch(() => {});
    }

    return response;
  };

  const apiCall = async (path: string, options: RequestInit = {}) => {
    const response = await apiFetch(path, options);

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
  // Error toast with the same "Copy diagnostics" affordance as the global
  // unhandled-error handler, so backend/sync failures give the user something
  // concrete to paste into a bug report.
  const showBackendErrorToast = (message: string, details?: unknown) => {
    showToast(message, {
      type: "error",
      action: {
        label: "Copy diagnostics",
        onClick: async () => {
          const err = Object.assign(new Error(message), { details });
          const copied = await copyDiagnostics(err);
          showToast(copied ? "Diagnostics copied" : "Diagnostics downloaded", { type: "success" });
        },
      },
    });
  };
  // Dedupes background-sync error toasts: the same failing summary is toasted
  // once, then suppressed until a clean pass resets it (or the user syncs
  // manually with notify). Without this, the 5-minute interval would stack an
  // identical toast every pass while e.g. one push keeps 500ing.
  const lastSyncErrorToastRef = useRef<string | null>(null);

  const triggerSync = (entityTypes: import("./syncEngine").EntityType[] = ["environment", "auth_function", "browser_profile", "collection", "flow"], opts?: { notify?: boolean }): Promise<void> => {
    // A sync is already running — await that same pass instead of resolving
    // immediately with nothing, so callers that need the result (e.g. a
    // pre-launch resolution retry) don't race it and see stale data.
    if (syncInFlightPromiseRef.current) return syncInFlightPromiseRef.current;

    const run = async () => {
      lastSyncAttemptRef.current = Date.now();
      setSyncStatus("syncing");
      try {
        if (!deviceIdRef.current) {
          const { deviceId } = await apiCall("/api/local-store/device-id");
          deviceIdRef.current = deviceId;
        }
        const { conflicts, errors } = await runAllSync(apiCall, deviceIdRef.current!, entityTypes);
        setSyncConflicts((prev) => [...prev.filter((c) => !entityTypes.includes(c.entityType)), ...conflicts]);
        if (errors.length) {
          const summary = `Sync finished with ${errors.length} error${errors.length === 1 ? "" : "s"}: ${errors[0].message}${errors.length > 1 ? " (+ more)" : ""}`;
          if (opts?.notify || summary !== lastSyncErrorToastRef.current) {
            lastSyncErrorToastRef.current = summary;
            showBackendErrorToast(summary, errors);
          }
        } else {
          lastSyncErrorToastRef.current = null;
        }
        // Refetch whichever local state changed so the UI reflects synced content
        // (new cloudIds, pulled remote edits, FK-remapped references, etc).
        if (entityTypes.includes("environment")) fetchEnvironments();
        if (entityTypes.includes("auth_function")) fetchAuthFunctions();
        if (entityTypes.includes("browser_profile")) fetchProfiles();
        if (entityTypes.includes("collection")) fetchCollections();
        if (entityTypes.includes("flow")) fetchFlows();

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
        setSyncStatus(errors.length ? "error" : "idle");
      } catch (e) {
        // Reaching here means even the sidecar's device-id lookup failed (the
        // sidecar is down/booting). Keep background passes to the status pill
        // — offline laptops shouldn't toast every 5 minutes — but a manually
        // requested sync should say why it failed.
        console.warn("[sync] sync pass failed", e);
        if (opts?.notify) {
          showBackendErrorToast(`Sync failed: ${e instanceof Error ? e.message : String(e)}`, e);
        }
        setSyncStatus("error");
      } finally {
        syncInFlightPromiseRef.current = null;
      }
    };

    const promise = run();
    syncInFlightPromiseRef.current = promise;
    return promise;
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
      if (conflict.entityType === "flow") fetchFlows();
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
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem("lixionary_token", data.token);
      localStorage.setItem("lixionary_user", JSON.stringify(data.user));
      // Google sign-in now returns a refresh token alongside the access token,
      // so apiCall can renew silently instead of the session dying after
      // JWT_EXPIRY_MINUTES. Guarded because a client can be pointed at a
      // backend older than that change, which still returns only a flat JWT.
      if (data.refresh_token) {
        setRefreshToken(data.refresh_token);
        localStorage.setItem("lixionary_refresh_token", data.refresh_token);
      }
      router.push("/home");
    } catch (e: any) {
      throw new Error(`Login failed: ${e.message}`);
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
    localStorage.removeItem("oauth_state");
    if (isTauri()) {
      // Flush any stale code sitting in the sidecar's single-slot OAuth relay
      // mailbox so a leftover from this session can't poison the next sign-in
      // attempt's very first poll (see login/page.tsx's onGoogleLogin).
      fetch(`${LOCAL_API_URL}/api/auth-bridge/code`).catch(() => {});
    }
    // The Web Explorer WebSocket is torn down by WebExplorerProvider's
    // token-watcher effect when the token clears below.
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
      // Auto-select only when nothing is selected or the saved selection no
      // longer exists (deleted environment / different account).
      if (mapped.length && !mapped.some((e) => e.id === selectedEnvId)) {
        setSelectedEnvId(mapped[0].id);
      }
      return mapped;
    } catch (e) {
      console.error("Failed to fetch environments", e);
      return [];
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
      }));
      setAuthFunctions(mapped);
      return mapped;
    } catch (e) {
      console.error("Failed to fetch auth functions", e);
      return [];
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
      // Read the selection through its ref, not the closed-over state: this
      // function is often called from stale closures (background sync), and
      // the closed-over "" would re-run this first-load auto-select on every
      // sync, resetting whatever the user had selected.
      if (mapped.length && !selectedCollectionIdRef.current) {
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
    updates: Partial<Pick<Collection, "name" | "description" | "requests" | "children">>,
    // Callers that just created rootColId in the same tick (e.g. saving a
    // network request into a brand-new collection) must pass it here directly —
    // `collections` state won't reflect it yet since setState from that
    // creation hasn't re-rendered this closure, so the state lookup below
    // would wrongly throw "Collection not found."
    baseCollection?: Collection
  ): Promise<void> => {
    const current = baseCollection ?? collections.find((c) => c.id === rootColId);
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

  const fetchFlows = async () => {
    try {
      const data = await apiCall("/api/local-store/flow");
      const mapped: Flow[] = data.map((r: any) => ({
        id: r.localId,
        cloudId: r.cloudId,
        name: r.name,
        description: r.description,
        nodes: r.nodes || [],
        edges: r.edges || [],
      }));
      setFlows(mapped);
    } catch (e) {
      console.error("Failed to fetch flows", e);
    }
  };

  const createFlow = async (name: string): Promise<Flow> => {
    const record = await apiCall("/api/local-store/flow", {
      method: "POST",
      body: JSON.stringify({ payload: { name, description: "", nodes: [], edges: [] } }),
    });
    await fetchFlows();
    triggerSync(["flow"]);
    return {
      id: record.localId,
      cloudId: record.cloudId,
      name: record.name,
      description: record.description,
      nodes: record.nodes || [],
      edges: record.edges || [],
    };
  };

  // Whole-blob replace, like persistCollectionTree — the local-store PUT
  // overwrites the payload with the merged object.
  const updateFlow = async (
    id: string,
    updates: Partial<Pick<Flow, "name" | "description" | "nodes" | "edges">>,
    // Callers that just created `id` in the same tick (e.g. duplicating a
    // flow) must pass the just-created record here directly — `flows` state
    // won't reflect it yet since createFlow's setState hasn't re-rendered
    // this closure, so the state lookup below would wrongly throw "Flow not found."
    baseFlow?: Flow
  ): Promise<void> => {
    const current = baseFlow ?? flows.find((f) => f.id === id);
    if (!current) throw new Error("Flow not found.");
    const merged: Flow = { ...current, ...updates };
    await apiCall(`/api/local-store/flow/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        payload: {
          name: merged.name,
          description: merged.description || "",
          nodes: merged.nodes,
          edges: merged.edges,
        },
      }),
    });
    await fetchFlows();
    triggerSync(["flow"]);
  };

  const deleteFlow = async (id: string): Promise<void> => {
    await apiCall(`/api/local-store/flow/${id}`, { method: "DELETE" });
    await fetchFlows();
    triggerSync(["flow"]);
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
        // Local-store rows are untyped passthrough, so older records saved
        // before multi-field injections may still only have the legacy
        // singular `authInjection` — fall back to wrapping it in a list.
        authInjections: r.authInjections || (r.authInjection ? [r.authInjection] : []),
        defaultUrl: r.defaultUrl,
        headless: r.headless ?? false,
        viewportWidth: r.viewportWidth ?? 1280,
        viewportHeight: r.viewportHeight ?? 720,
      }));
      setProfiles(mapped);
      if (mapped.length && !selectedProfileId) {
        setSelectedProfileId(mapped[0].id);
      }
    } catch (e) {
      console.error("Failed to fetch browser profiles", e);
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
          authFunctionId: reqAuthConfig.authFunctionId || null,
          tokenField: reqAuthConfig.tokenField
        },
        responseParserScript: reqParserScript,
        requestInterceptorScript: reqInterceptorScript,
        testScript: reqTestScript,
        inputs: reqInputs,
        outputs: reqOutputs,
        // The sidecar executor resolves local (or cloud) ids against the
        // local store — unsynced environments work.
        environmentId: selectedEnvId || null
      };

      const result = await apiCall("/api/executor/run", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      setApiResponse(result);
      if (result.status < 400) {
        try {
          const col = collections.find(c => findRequestInTree(c, selectedRequestId) !== null);
          const req = col ? findRequestInTree(col, selectedRequestId) : null;
          if (col && req) {
            const updatedCol = updateRequestInTree(col, selectedRequestId, { ...req, lastResponse: result, lastRunAt: new Date().toISOString() });
            await persistCollectionTree(col.id, { requests: updatedCol.requests, children: updatedCol.children || [] });
          }
        } catch {
          // best-effort persistence — a failed write shouldn't block showing the fresh response
        }
      }
      fetchEnvironments();
      triggerSync(["environment"]);
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
          authFunctionId: reqAuthType === "HOOK" ? null : (reqAuthConfig.authFunctionId || null),
          tokenField: reqAuthConfig.tokenField
        },
        responseParserScript: reqParserScript,
        requestInterceptorScript: reqInterceptorScript,
        testScript: reqTestScript,
        // Drop bindings whose token no longer appears in any request field
        inputs: (() => {
          const detected = scanInputNames({
            url: reqUrl,
            headers: reqHeaders,
            queryParams: reqQueryParams,
            body: reqBody,
            authType: reqAuthType,
            authConfig: reqAuthConfig
          });
          return reqInputs.filter(b => detected.includes(b.name));
        })(),
        outputs: reqOutputs.filter(Boolean),
        outputDescriptions: Object.fromEntries(
          Object.entries(reqOutputDescriptions).filter(([name]) => reqOutputs.includes(name))
        ),
        description: reqDescription
      };

      const updatedCol = updateRequestInTree(col, selectedRequestId, updatedRequest);

      await persistCollectionTree(col.id, { requests: updatedCol.requests, children: updatedCol.children || [] });

      // Saved state is now authoritative — drop the unsaved auth override.
      // Exception: HOOK auth is kept user-local (not in the shared collection), so don't clear it.
      if (reqAuthType !== "HOOK") {
        deletePref(`auth_override:${selectedRequestId}`);
      }
      deletePref(`outputs_override:${selectedRequestId}`);
      deletePref(`description_override:${selectedRequestId}`);
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
        url: "{{env.BASE_URL}}/api/resource",
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

    await persistCollectionTree(col.id, { requests: updatedCol.requests, children: updatedCol.children || [] }, col);
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
      const sourceRootCol = collections.find(c => {
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

      if (nodeType === "request") {
        deletePref(`auth_override:${nodeId}`);
        deletePref(`outputs_override:${nodeId}`);
        if (selectedRequestId === nodeId) {
          setSelectedRequestId("");
        }
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

  const handleDuplicateRequest = async (req: RequestItem) => {
    try {
      const rootCol = findRequestOwnerCollection(collections, req.id);
      if (!rootCol) throw new Error("Request not found in any collection.");
      const parentNode = findParentNodeInTree(rootCol, req.id);
      if (!parentNode) throw new Error("Parent collection not found.");

      const newName = generateDuplicateName(req.name, (parentNode.requests || []).map(r => r.name));
      const newRequest: RequestItem = {
        ...req,
        id: `req_${Math.random().toString(36).substring(2, 9)}`,
        name: newName,
        lastResponse: undefined,
      };

      const updatedCol = addRequestToNode(rootCol, parentNode.id, newRequest);
      await persistCollectionTree(rootCol.id, { requests: updatedCol.requests, children: updatedCol.children || [] });
      setSelectedRequestId(newRequest.id);
    } catch (e: any) {
      throw new Error(`Failed to duplicate request: ${e.message}`);
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

  // Creates a new root collection from a full tree payload (file import).
  // The payload must already carry fresh child/request ids and have unresolvable
  // authFunctionId refs nulled — the sync engine defers the cloud push of any
  // collection whose auth references can't be resolved.
  const importCollectionTree = async (
    payload: import("../utils/collectionTransfer").CollectionTransferPayload
  ): Promise<Collection> => {
    const result = await apiCall("/api/local-store/collection", {
      method: "POST",
      body: JSON.stringify({
        payload: {
          name: payload.name,
          description: payload.description || "",
          requests: payload.requests || [],
          children: payload.children || [],
        },
      }),
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
      throw new Error(`Connect failed: ${e.message}`);
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

  const handleDuplicateEnv = async (env: Environment) => {
    const newName = generateDuplicateName(env.name, environments.map((e) => e.name));
    await handleSaveEnv(newName, env.variables, null);
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
    authInjections: Array<{ type: string; key: string; domainOrOrigin: string; sourceField?: string }> | null,
    defaultUrl: string,
    headless: boolean,
    viewportWidth: number,
    viewportHeight: number,
    id: string | null
  ) => {
    try {
      if (id) {
        await apiCall(`/api/local-store/browser_profile/${id}`, {
          method: "PUT",
          body: JSON.stringify({ payload: { name, cookies, localStorage, authFunctionId, authInjections, defaultUrl, headless, viewportWidth, viewportHeight } })
        });
      } else {
        await apiCall("/api/local-store/browser_profile", {
          method: "POST",
          body: JSON.stringify({ payload: { name, cookies, localStorage, authFunctionId, authInjections, defaultUrl, headless, viewportWidth, viewportHeight } })
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

  const handleDuplicateProfile = async (profile: BrowserProfile) => {
    const newName = generateDuplicateName(profile.name, profiles.map((p) => p.name));
    await handleSaveProfile(
      newName,
      profile.cookies,
      profile.localStorage,
      profile.authFunctionId ?? null,
      profile.authInjections ?? null,
      profile.defaultUrl ?? "",
      profile.headless ?? false,
      profile.viewportWidth ?? 1280,
      profile.viewportHeight ?? 720,
      null
    );
  };

  // These two effects live below the functions they call (apiCall, the
  // fetchers, triggerSync, showBackendErrorToast) so nothing is referenced
  // before its declaration.
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
        fetchFlows();
        fetchProfiles();
        fetchUserGuides();
        triggerSync();
      })();
    }
  }, [token]);

  // Toast once when the desktop backend flips into a hard failure (Tauri IPC
  // dead, sidecar process gone, local DB broken) so the user has something to
  // report instead of just a quiet status pill. Only on the transition into
  // "error" — "degraded" is the normal first-launch boot state, and vps
  // unreachability is already covered by the offline pill.
  const prevBackendBrokenRef = useRef(false);
  useEffect(() => {
    const brokenDetail =
      tauri?.status === "error" ? tauri.detail :
      sidecar?.status === "error" ? sidecar.detail :
      localDb?.status === "error" ? localDb.detail : null;
    if (brokenDetail && !prevBackendBrokenRef.current) {
      showBackendErrorToast(`Desktop backend problem: ${brokenDetail}`);
    }
    prevBackendBrokenRef.current = !!brokenDetail;
  }, [tauri?.status, sidecar?.status, localDb?.status]);

  return (
    <AppContext.Provider
      value={{
        token,
        user,
        isLoadingAuth,
        handleLogin,
        handleLogout,

        getPref,
        setPref,
        deletePref,
        llmSettings,
        refreshLlmSettings,

        environments,
        selectedEnvId,
        setSelectedEnvId,
        fetchEnvironments,
        authFunctions,
        fetchAuthFunctions,
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
        flows,
        fetchFlows,
        createFlow,
        updateFlow,
        deleteFlow,

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
        reqInterceptorScript,
        setReqInterceptorScript,
        reqTestScript,
        setReqTestScript,
        reqInputs,
        setReqInputs,
        reqOutputs,
        setReqOutputs,
        reqOutputDescriptions,
        setReqOutputDescriptions,
        reqDescription,
        setReqDescription,

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

        profiles,
        fetchProfiles,
        selectedProfileId,
        setSelectedProfileId,

        apiCall,
        apiFetch,
        handleExecuteRequest,
        handleSaveRequest,
        handleCreateRequest,
        handleSaveNetworkRequestToCollection,
        handleSaveNetworkRequestToNewCollection,
        handleCreateSubCollection,
        handleMoveNode,
        handleDeleteNode,
        handleRenameNode,
        handleDuplicateRequest,
        handleCreateCollection,
        handleImportCollection,
        importCollectionTree,
        handleAddCollaborator,
        handleSaveEnv,
        handleDeleteEnv,
        handleDuplicateEnv,
        handleSaveAuthFunc,
        handleDeleteAuthFunc,

        handleSaveProfile,
        handleDeleteProfile,
        handleDuplicateProfile
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
