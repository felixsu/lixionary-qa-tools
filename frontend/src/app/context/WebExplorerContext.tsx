"use client";

// Web Explorer browser-session state, extracted from AppContext. Owns the
// sidecar browser WebSocket (screencast, inspect, scan, verify, explore,
// record) and everything only the Web Explorer page consumes. Mounted in the
// ROOT layout inside AppProvider — deliberately not in the web-explorer route
// layout, because the static-export build unmounts route segments on
// navigation and the live browser session must survive visiting other modules.

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { setScreencastFrame } from "../utils/screencastFrameStore";
import { useAppContext } from "./AppContext";
import { useToast } from "./ToastContext";

const LOCAL_API_URL = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:8484';

// Types
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

export interface SessionInfo {
  session_id: string;
  status: "pending" | "active" | "disconnected" | "error";
  created_at: string;
  profile_id: string | null;
}

export interface SelectorTestResult {
  selector: string;
  totalCount: number;
  frames: { frameLocators: string[]; count: number }[];
  error: string | null;
}

interface WebExplorerContextType {
  // Web Explorer State
  browserUrl: string;
  setBrowserUrl: (url: string) => void;
  isBrowserConnected: boolean;
  setIsBrowserConnected: (connected: boolean) => void;
  viewportSize: { width: number; height: number };
  inspectMode: boolean;
  setInspectMode: (inspect: boolean) => void;
  sessionId: string;
  setSessionId: (id: string) => void;
  networkLogs: NetworkLog[];
  setNetworkLogs: React.Dispatch<React.SetStateAction<NetworkLog[]>>;
  networkFilter: string;
  setNetworkFilter: (filter: string) => void;
  logDetails: NetworkDetails | null;
  setLogDetails: (details: NetworkDetails | null) => void;
  networkPillFilter: "all" | "api";
  setNetworkPillFilter: (filter: "all" | "api") => void;
  handleClearNetworkLogs: () => void;
  sendBrowserMouseEvent: (type: "click" | "move" | "down" | "up", x: number, y: number) => void;
  sendBrowserWheelEvent: (deltaX: number, deltaY: number) => void;
  sendBrowserKeyboardEvent: (key: string) => void;
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

  // Manual selector testing
  selectorTestResult: SelectorTestResult | null;
  isTestingSelector: boolean;
  handleTestSelector: (selector: string) => void;
  handleClearHighlights: () => void;
  handleVerifyCustomSelector: (selector: string, action: string, value?: string, frameLocators?: string[]) => void;

  // Live browser window
  handleFocusBrowserWindow: () => void;
  isExploring: boolean;
  exploreSteps: any[];
  setExploreSteps: React.Dispatch<React.SetStateAction<any[]>>;
  explorePrompt: string;
  setExplorePrompt: (prompt: string) => void;
  handleStartExplore: (scope?: "page" | "selected") => void;
  handleStopExplore: () => void;
  isRecording: boolean;
  handleStartRecording: () => void;
  handleStopRecording: () => void;

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

  // Session lifecycle
  connectBrowserSession: (sessId: string, profileId?: string) => void;
  handleStartBrowser: (profileId?: string) => Promise<void>;
  handleDisconnectBrowser: () => void;
  handleBrowserNavigate: () => void;
  handleToggleInspect: () => void;
  fetchNetworkLogs: (sessId: string) => Promise<void>;
  handleLogClick: (logId: string) => Promise<void>;
}

const WebExplorerContext = createContext<WebExplorerContextType | undefined>(undefined);

export function WebExplorerProvider({ children }: { children: React.ReactNode }) {
  const { token, apiCall, profiles, selectedEnvId } = useAppContext();
  const { showToast } = useToast();

  // Web Explorer State
  const [browserUrl, setBrowserUrl] = useState("https://example.com");
  const [isBrowserConnected, setIsBrowserConnected] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 1280, height: 720 });
  const [inspectMode, setInspectMode] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [networkLogs, setNetworkLogs] = useState<NetworkLog[]>([]);
  const [networkFilter, setNetworkFilter] = useState("");
  const [networkPillFilter, setNetworkPillFilter] = useState<"all" | "api">("all");
  const [logDetails, setLogDetails] = useState<NetworkDetails | null>(null);
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
  const [selectorTestResult, setSelectorTestResult] = useState<SelectorTestResult | null>(null);
  const [isTestingSelector, setIsTestingSelector] = useState(false);
  const [isExploring, setIsExploring] = useState(false);
  const [exploreSteps, setExploreSteps] = useState<any[]>([]);
  const [explorePrompt, setExplorePrompt] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [anchorElement, setAnchorElement] = useState<{ tagName: string; id: string; text: string } | null>(null);

  // Browser Session Management
  const [userSessions, setUserSessions] = useState<SessionInfo[]>([]);

  // Browser Tab State
  const [browserTabs, setBrowserTabs] = useState<{ index: number; url: string }[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  // WebSocket Ref for browser interactions
  const wsRef = useRef<WebSocket | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBrowserConnected]);

  // Browser WebSocket interaction methods
  const connectBrowserSession = (sessId: string, profileId?: string) => {
    if (wsRef.current) {
      wsRef.current.close();
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

        if (profile.authFunctionId && profile.authInjections && profile.authInjections.length > 0) {
          try {
            // The sidecar executor resolves local or cloud ids against the
            // local store, so unsynced auth functions/environments work
            // immediately — no pre-launch sync pass needed.
            const tokenUrl = selectedEnvId
              ? `/api/executor/auth-token/${profile.authFunctionId}?envId=${selectedEnvId}`
              : `/api/executor/auth-token/${profile.authFunctionId}`;
            const tokenData = await apiCall(tokenUrl);
            const authResult = tokenData?.result;
            if (authResult === undefined || authResult === null || authResult === "") {
              showToast(
                `Profile "${profile.name}"'s auth function did not return a token — check the auth function's script.`,
                { type: "error" }
              );
            } else {
              // Auth hook is called once above; each mapping just picks a
              // field out of that single result (or the whole string).
              for (const injection of profile.authInjections) {
                const { type: injType, key: injKey, domainOrOrigin, sourceField } = injection;

                let tokenVal: string;
                if (typeof authResult === "object") {
                  if (!sourceField) {
                    showToast(
                      `Profile "${profile.name}": mapping for "${injKey}" needs a source field — the auth function returned multiple fields.`,
                      { type: "error" }
                    );
                    continue;
                  }
                  if (!(sourceField in authResult)) {
                    showToast(
                      `Profile "${profile.name}": auth function result has no field named "${sourceField}".`,
                      { type: "error" }
                    );
                    continue;
                  }
                  tokenVal = authResult[sourceField];
                } else {
                  if (sourceField) {
                    showToast(
                      `Profile "${profile.name}": mapping for "${injKey}" expects field "${sourceField}", but the auth function returned a plain string.`,
                      { type: "error" }
                    );
                    continue;
                  }
                  tokenVal = authResult;
                }

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
            }
          } catch (err: any) {
            console.error("Failed to resolve auth function hook on frontend:", err);
            showToast(
              `Failed to resolve auth-function hook for profile "${profile.name}": ${err?.message || err}`,
              { type: "error" }
            );
          }
        }
      }

      ws.send(JSON.stringify({
        action: "init",
        cookies,
        localStorage: localStorageData,
        defaultUrl,
        headless: profile?.headless ?? false,
        viewportWidth: profile?.viewportWidth ?? 1280,
        viewportHeight: profile?.viewportHeight ?? 720
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
          if (msg.data.viewport?.width && msg.data.viewport?.height) {
            setViewportSize({ width: msg.data.viewport.width, height: msg.data.viewport.height });
          }
          break;
        case "screencast_frame": {
          setScreencastFrame(msg.data.image);
          // Frame metadata carries the live page size (CSS px), which tracks
          // manual window resizes — keep viewportSize in sync so the preview's
          // click-coordinate letterbox math matches what's actually rendered.
          // The functional bailout avoids a context re-render per frame.
          const meta = msg.data.metadata;
          if (meta?.deviceWidth && meta?.deviceHeight) {
            setViewportSize((prev) =>
              prev.width === meta.deviceWidth && prev.height === meta.deviceHeight
                ? prev
                : { width: meta.deviceWidth, height: meta.deviceHeight }
            );
          }
          break;
        }
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
        case "recording_started":
          setIsRecording(true);
          break;
        case "recording_stopped":
          setIsRecording(false);
          break;
        case "recording_step_added":
          window.dispatchEvent(new CustomEvent("recording-step-added", { detail: msg.data }));
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
        case "selector_test_result":
          setIsTestingSelector(false);
          setSelectorTestResult(msg.data);
          break;
        case "window_focused":
          break;
        case "window_focus_error":
          showToast(msg.data?.message || "Could not raise the browser window", { type: "error" });
          break;
        case "error":
          showToast(`Browser session error: ${msg.message}`, { type: "error" });
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
      setIsTestingSelector(false);
      setSelectorTestResult(null);

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
      showToast("Please enter a URL.", { type: "error" });
      return;
    }
    // Allow about:blank
    if (browserUrl !== "about:blank") {
      if (!browserUrl.startsWith("http://") && !browserUrl.startsWith("https://")) {
        showToast("URL must start with http:// or https://", { type: "error" });
        return;
      }
      try {
        new URL(browserUrl);
      } catch {
        showToast("Please enter a valid URL format.", { type: "error" });
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

  const handleTestSelector = (selector: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setIsTestingSelector(true);
    setSelectorTestResult(null);
    wsRef.current.send(JSON.stringify({ action: "test-selector", selector }));
  };

  const handleClearHighlights = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "clear-highlight" }));
  };

  // Runs an action with a user-typed selector through the same verify path the
  // inspector uses; frameLocators (from the selector test) target an iframe.
  const handleVerifyCustomSelector = (selector: string, action: string, value?: string, frameLocators?: string[]) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      action: "verify",
      verifyAction: action,
      locators: [{ strategy: "locator (Custom)", selector }],
      value: ["fill", "type", "select_option"].includes(action) ? (value ?? "") : undefined,
      frameLocators: frameLocators && frameLocators.length ? frameLocators : undefined,
    }));
  };

  const handleFocusBrowserWindow = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "focus-window" }));
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

  const handleStartRecording = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "start-recording" }));
    setIsRecording(true);
  };

  const handleStopRecording = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "stop-recording" }));
    }
    setIsRecording(false);
  };

  const handleClearNetworkLogs = () => {
    setNetworkLogs([]);
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
      const data = await apiCall(`/api/browser/network/${sessId}/logs`);
      setNetworkLogs(data);
    } catch (e) {
      console.error("Error fetching network logs", e);
    }
  };

  const handleLogClick = async (logId: string) => {
    setLogDetails(null);
    try {
      const data = await apiCall(`/api/browser/network/${sessionId}/details/${encodeURIComponent(logId)}`);
      setLogDetails(data);
    } catch (e) {
      console.error("Error fetching network log details", e);
    }
  };

  // Session list on sign-in, browser teardown on sign-out — these replace the
  // direct fetchUserSessions()/handleDisconnectBrowser() calls that lived in
  // AppContext's auth flow before the browser state was extracted here.
  useEffect(() => {
    if (token) {
      fetchUserSessions();
    } else {
      handleDisconnectBrowser();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <WebExplorerContext.Provider
      value={{
        browserUrl,
        setBrowserUrl,
        isBrowserConnected,
        setIsBrowserConnected,
        viewportSize,
        inspectMode,
        setInspectMode,
        sessionId,
        setSessionId,
        networkLogs,
        setNetworkLogs,
        networkFilter,
        setNetworkFilter,
        logDetails,
        setLogDetails,
        networkPillFilter,
        setNetworkPillFilter,
        handleClearNetworkLogs,
        sendBrowserMouseEvent,
        sendBrowserWheelEvent,
        sendBrowserKeyboardEvent,
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
        handleStartRecording,
        handleStopRecording,

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

        connectBrowserSession,
        handleStartBrowser,
        handleDisconnectBrowser,
        handleBrowserNavigate,
        handleToggleInspect,
        fetchNetworkLogs,
        handleLogClick,
      }}
    >
      {children}
    </WebExplorerContext.Provider>
  );
}

export const useWebExplorer = () => {
  const context = useContext(WebExplorerContext);
  if (context === undefined) {
    throw new Error("useWebExplorer must be used within a WebExplorerProvider");
  }
  return context;
};
