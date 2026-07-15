"use client";

import React, { useState, useEffect } from "react";
import { Plus, Trash2, Pencil, X, Key, Globe, RefreshCw, Layers } from "lucide-react";
import { useAppContext, BrowserProfile } from "../../context/AppContext";
import Dropdown from "../../components/Dropdown";

const LOCAL_API_URL = process.env.NEXT_PUBLIC_LOCAL_API_URL || "http://localhost:8484";

const DEFAULT_PROFILE_COOKIES = `[
  {
    "name": "ninja_access_token",
    "value": "YOUR_TOKEN",
    "domain": ".ninjavan.co",
    "path": "/",
    "secure": true,
    "sameSite": "Lax"
  }
]`;

type SetupMethod = "manual" | "extension";
type WizardStep = "method" | "localStorage" | "cookies" | "import" | "details";

const STEP_LABELS: Record<WizardStep, string> = {
  method: "Setup method",
  localStorage: "Local storage",
  cookies: "Cookies",
  import: "Import from Chrome",
  details: "Details & save",
};

export default function BrowserProfilesPage() {
  const { profiles, authFunctions, handleSaveProfile, handleDeleteProfile, apiCall } = useAppContext();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileDefaultUrl, setProfileDefaultUrl] = useState("");
  const [profileCookies, setProfileCookies] = useState("");
  const [profileLocalStorage, setProfileLocalStorage] = useState("");
  const [rawLsOrigin, setRawLsOrigin] = useState("");
  const [rawLsKey, setRawLsKey] = useState("");
  const [rawLsValue, setRawLsValue] = useState("");
  const [profileAuthFunctionId, setProfileAuthFunctionId] = useState<string>("");
  const [profileAuthInjectionType, setProfileAuthInjectionType] = useState<"cookie" | "localStorage">("cookie");
  const [profileAuthInjectionKey, setProfileAuthInjectionKey] = useState("");
  const [profileAuthInjectionDomainOrOrigin, setProfileAuthInjectionDomainOrOrigin] = useState("");

  // Wizard states
  const [wizardStep, setWizardStep] = useState(0);
  const [setupMethod, setSetupMethod] = useState<SetupMethod | null>(null);
  const [importSummary, setImportSummary] = useState<{ cookies: number; ls: number; origin: string } | null>(null);

  // Chrome Extension states
  const [extensionReady, setExtensionReady] = useState(false);
  const [helperConnected, setHelperConnected] = useState(false);
  const [openTabs, setOpenTabs] = useState<any[]>([]);
  const [selectedTabId, setSelectedTabId] = useState("");
  const [isFetchingTabs, setIsFetchingTabs] = useState(false);
  const [isFetchingData, setIsFetchingData] = useState(false);
  const [fetchedData, setFetchedData] = useState<any | null>(null);
  const [selectedCookies, setSelectedCookies] = useState<string[]>([]);
  const [selectedLocalStorageKeys, setSelectedLocalStorageKeys] = useState<string[]>([]);

  // Setup extension window listeners (for direct Chrome page running)
  useEffect(() => {
    const handleExtensionMessage = (event: MessageEvent) => {
      if (!event.data || event.data.source !== "ae-chrome-extension") {
        return;
      }

      const { type, success, payload, error } = event.data;

      if (type === "EXTENSION_READY") {
        setExtensionReady(true);
      } else if (type === "GET_TABS_RESPONSE") {
        setIsFetchingTabs(false);
        if (success && Array.isArray(payload)) {
          setOpenTabs(payload);
        } else {
          console.error("Failed to fetch tabs from extension:", error);
        }
      } else if (type === "GET_DATA_RESPONSE") {
        setIsFetchingData(false);
        if (success && payload) {
          setFetchedData(payload);
          setSelectedCookies([]);
          setSelectedLocalStorageKeys([]);
        } else {
          alert("Failed to fetch data from tab: " + (error || "Unknown error"));
        }
      }
    };

    window.addEventListener("message", handleExtensionMessage);

    // Ping extension to check if it's already loaded
    window.postMessage({ source: "ae-web-app", type: "PING_EXTENSION" }, "*");

    return () => {
      window.removeEventListener("message", handleExtensionMessage);
    };
  }, []);

  // Poll Local Sidecar helper status (for Tauri/desktop mode)
  useEffect(() => {
    if (!showModal) return;

    const checkHelperStatus = async () => {
      try {
        const res = await apiCall("/api/browser-helper/status");
        setHelperConnected(res?.connected || false);
      } catch (err) {
        setHelperConnected(false);
      }
    };

    checkHelperStatus();
    const interval = setInterval(checkHelperStatus, 2000);
    return () => clearInterval(interval);
  }, [showModal, apiCall]);

  // Fetch tabs when extension or helper becomes active, or modal is shown
  useEffect(() => {
    if ((extensionReady || helperConnected) && showModal) {
      handleFetchTabs();
    }
  }, [extensionReady, helperConnected, showModal]);

  const handleFetchTabs = async () => {
    setIsFetchingTabs(true);
    setOpenTabs([]);
    setSelectedTabId("");
    setFetchedData(null);

    if (extensionReady) {
      window.postMessage({ source: "ae-web-app", type: "GET_TABS" }, "*");
    } else if (helperConnected) {
      try {
        const tabs = await apiCall("/api/browser-helper/tabs");
        setOpenTabs(tabs || []);
      } catch (err: any) {
        console.error("Failed to fetch tabs via sidecar:", err);
      } finally {
        setIsFetchingTabs(false);
      }
    } else {
      setIsFetchingTabs(false);
    }
  };

  const handleFetchTabData = async () => {
    if (!selectedTabId) return;
    const selectedTab = openTabs.find(t => String(t.id) === selectedTabId);
    if (!selectedTab) return;

    setIsFetchingData(true);
    setFetchedData(null);

    if (extensionReady) {
      window.postMessage({
        source: "ae-web-app",
        type: "GET_DATA",
        payload: { tabId: Number(selectedTabId), url: selectedTab.url }
      }, "*");
    } else if (helperConnected) {
      try {
        const data = await apiCall("/api/browser-helper/data", {
          method: "POST",
          body: JSON.stringify({ tabId: Number(selectedTabId), url: selectedTab.url })
        });
        setFetchedData(data);
        setSelectedCookies([]);
        setSelectedLocalStorageKeys([]);
      } catch (err: any) {
        alert("Failed to fetch tab data: " + (err.message || "Unknown error"));
      } finally {
        setIsFetchingData(false);
      }
    } else {
      setIsFetchingData(false);
    }
  };

  const handleApplyImport = () => {
    if (!fetchedData) return;

    let origin = "";
    try {
      const u = new URL(fetchedData.url);
      origin = u.origin;
    } catch (e) {
      alert("Invalid tab URL: " + fetchedData.url);
      return;
    }

    // 1. Process cookies
    const importedCookies = (fetchedData.cookies || [])
      .filter((c: any) => selectedCookies.includes(c.name))
      .map((c: any) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        sameSite: c.sameSite
      }));

    let currentCookies: any[] = [];
    if (profileCookies) {
      try {
        currentCookies = JSON.parse(profileCookies);
        if (!Array.isArray(currentCookies)) currentCookies = [];
      } catch (e) {
        // ignore invalid JSON
      }
    }

    const mergedCookies = [...currentCookies];
    importedCookies.forEach((newCookie: any) => {
      const idx = mergedCookies.findIndex(
        (c) => c.name === newCookie.name && c.domain === newCookie.domain
      );
      if (idx !== -1) {
        mergedCookies[idx] = newCookie;
      } else {
        mergedCookies.push(newCookie);
      }
    });

    // 2. Process localStorage
    const importedLsItems = Object.entries(fetchedData.localStorage || {})
      .filter(([k]) => selectedLocalStorageKeys.includes(k))
      .map(([k, v]) => ({ name: k, value: v }));

    let currentLs: any = { origins: [] };
    if (profileLocalStorage) {
      try {
        const parsed = JSON.parse(profileLocalStorage);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.origins)) {
          currentLs = parsed;
        }
      } catch (e) {
        // ignore
      }
    }

    const origins = [...(currentLs.origins || [])];
    let originEntry = origins.find(
      (o: any) => (o?.origin || "").toLowerCase().replace(/\/$/, "") === origin.toLowerCase().replace(/\/$/, "")
    );
    if (!originEntry) {
      originEntry = { origin, localStorage: [] };
      origins.push(originEntry);
    }

    const mergedLs = [...(originEntry.localStorage || [])];
    importedLsItems.forEach((newKv: any) => {
      const idx = mergedLs.findIndex((kv: any) => kv?.name === newKv.name);
      if (idx !== -1) {
        mergedLs[idx] = newKv;
      } else {
        mergedLs.push(newKv);
      }
    });
    originEntry.localStorage = mergedLs;
    currentLs.origins = origins;

    setProfileCookies(JSON.stringify(mergedCookies, null, 2));
    setProfileLocalStorage(JSON.stringify(currentLs, null, 2));

    setImportSummary({ cookies: importedCookies.length, ls: importedLsItems.length, origin });
    setFetchedData(null);
    setSelectedTabId("");
  };

  const resetWizard = () => {
    setWizardStep(0);
    setSetupMethod(null);
    setImportSummary(null);
    setSelectedTabId("");
    setFetchedData(null);
    setRawLsOrigin("");
    setRawLsKey("");
    setRawLsValue("");
  };

  const openCreate = () => {
    setEditingId(null);
    setProfileName("");
    setProfileCookies("");
    setProfileLocalStorage("");
    setProfileAuthFunctionId("");
    setProfileDefaultUrl("");
    setProfileAuthInjectionType("cookie");
    setProfileAuthInjectionKey("");
    setProfileAuthInjectionDomainOrOrigin("");
    resetWizard();
    setShowModal(true);
  };

  const openEdit = (profile: BrowserProfile) => {
    setEditingId(profile.id);
    setProfileName(profile.name);
    setProfileCookies(profile.cookies || "");
    setProfileLocalStorage(profile.localStorage || "");
    setProfileAuthFunctionId(profile.authFunctionId || "");
    setProfileDefaultUrl(profile.defaultUrl || "");
    if (profile.authInjection) {
      setProfileAuthInjectionType((profile.authInjection.type as "cookie" | "localStorage") || "cookie");
      setProfileAuthInjectionKey(profile.authInjection.key || "");
      setProfileAuthInjectionDomainOrOrigin(profile.authInjection.domainOrOrigin || "");
    } else {
      setProfileAuthInjectionType("cookie");
      setProfileAuthInjectionKey("");
      setProfileAuthInjectionDomainOrOrigin("");
    }
    resetWizard();
    setShowModal(true);
  };

  // Lets users paste a raw target value (e.g. a transit/JSON blob that already
  // contains literal backslashes) without hand-escaping it. Hand-typing such a
  // value directly into a JSON textarea is error-prone: JSON.parse
  // (both the validation above and the backend's json.loads) treats `\"` as an
  // escaped quote and silently drops the backslash. JSON.stringify here does
  // the escaping correctly so the raw value round-trips byte-for-byte.
  const handleInsertRawLocalStorageValue = () => {
    if (!rawLsOrigin || !rawLsKey) {
      alert("Origin and key are required.");
      return;
    }
    let parsed: any;
    try {
      parsed = profileLocalStorage ? JSON.parse(profileLocalStorage) : { origins: [] };
    } catch {
      alert("The stored localStorage JSON is currently invalid — clear it before inserting.");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = { origins: [] };
    if (!Array.isArray(parsed.origins)) parsed.origins = [];

    const targetOrigin = rawLsOrigin.toLowerCase().replace(/\/$/, "");
    let originEntry = parsed.origins.find(
      (o: any) => (o?.origin || "").toLowerCase().replace(/\/$/, "") === targetOrigin
    );
    if (!originEntry) {
      originEntry = { origin: rawLsOrigin, localStorage: [] };
      parsed.origins.push(originEntry);
    }
    if (!Array.isArray(originEntry.localStorage)) originEntry.localStorage = [];
    originEntry.localStorage = originEntry.localStorage.filter((kv: any) => kv?.name !== rawLsKey);
    originEntry.localStorage.push({ name: rawLsKey, value: rawLsValue });

    setProfileLocalStorage(JSON.stringify(parsed, null, 2));
    setRawLsKey("");
    setRawLsValue("");
  };

  // The zip is served by the local sidecar (which ships with the extension
  // source). Open it in the system browser: downloads initiated inside the
  // Tauri webview itself are unreliable across platforms.
  const handleDownloadExtension = async () => {
    const url = `${LOCAL_API_URL}/api/browser-helper/extension`;
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("open_external", { url });
        return;
      } catch (e) {
        console.error("Tauri open_external failed, falling back to window.open", e);
      }
    }
    window.open(url, "_blank");
  };

  const handleRemoveLsEntry = (originVal: string, keyName: string) => {
    try {
      const parsed = JSON.parse(profileLocalStorage);
      if (!parsed || !Array.isArray(parsed.origins)) return;
      parsed.origins = parsed.origins
        .map((o: any) =>
          o?.origin === originVal
            ? { ...o, localStorage: (o.localStorage || []).filter((kv: any) => kv?.name !== keyName) }
            : o
        )
        .filter((o: any) => (o?.localStorage || []).length > 0);
      setProfileLocalStorage(parsed.origins.length ? JSON.stringify(parsed, null, 2) : "");
    } catch {
      // invalid JSON — nothing to remove from
    }
  };

  // Wizard derived state
  const wizardSteps: WizardStep[] = setupMethod === "extension"
    ? ["method", "import", "details"]
    : ["method", "localStorage", "cookies", "details"];
  const currentStep = wizardSteps[Math.min(wizardStep, wizardSteps.length - 1)];
  const helperActive = extensionReady || helperConnected;
  const hasProfileData = Boolean((profileCookies || "").trim() || (profileLocalStorage || "").trim());

  // Parsed localStorage for the read-only entries view and summary counts
  let lsOrigins: any[] = [];
  let lsParseFailed = false;
  if (profileLocalStorage.trim()) {
    try {
      const parsed = JSON.parse(profileLocalStorage);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.origins)) {
        lsOrigins = parsed.origins;
      } else {
        lsParseFailed = true;
      }
    } catch {
      lsParseFailed = true;
    }
  }
  const lsKeyCount = lsOrigins.reduce((n: number, o: any) => n + (o?.localStorage?.length || 0), 0);
  let cookieCount = 0;
  if (profileCookies.trim()) {
    try {
      const parsed = JSON.parse(profileCookies);
      if (Array.isArray(parsed)) cookieCount = parsed.length;
    } catch {
      // counted as 0 until valid
    }
  }

  const nextDisabled =
    (currentStep === "method" && !setupMethod) ||
    (currentStep === "import" && !hasProfileData);

  const onSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentStep !== "details") return; // Enter mid-wizard must not save
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
      await handleSaveProfile(profileName, profileCookies, profileLocalStorage, profileAuthFunctionId || null, authInjectionVal, profileDefaultUrl, editingId);
      setShowModal(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Action bar */}
      <div className="h-14 flex items-center justify-end px-6 border-b border-line flex-shrink-0">
        <button
          onClick={openCreate}
          className="h-[38px] px-4 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white flex items-center gap-2 transition-colors"
        >
          <Plus className="h-4 w-4" /> Create browser profile
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <div className="text-base font-medium text-graphite">No browser profiles yet</div>
            <div className="text-[13px] text-mute max-w-sm leading-relaxed">
              Save cookie and localStorage presets to seed authenticated Web Explorer sessions instantly.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 content-start">
            {profiles.map((p) => {
              const linkedAuthFunc = authFunctions.find((f) => f.id === p.authFunctionId);
              return (
                <div key={p.id} className="bg-cream border border-line rounded-xl overflow-hidden flex flex-col">
                  <div className="px-5 pt-4 pb-3 flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink mb-1 truncate">{p.name}</div>
                      <div className="text-xs text-stone leading-relaxed truncate font-mono">ID: {p.id}</div>
                    </div>
                    <button
                      onClick={() => openEdit(p)}
                      className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-panel transition-colors flex-shrink-0"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5 text-graphite" />
                    </button>
                    <button
                      onClick={async () => {
                        if (confirm("Delete this profile?")) await handleDeleteProfile(p.id);
                      }}
                      className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-danger-soft hover:text-danger transition-colors flex-shrink-0"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-graphite" />
                    </button>
                  </div>

                  <div className="px-5 pb-4 flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-graphite">
                      <Globe className="h-3.5 w-3.5 text-mute flex-shrink-0" />
                      <span className="truncate font-mono text-[11px]">{p.defaultUrl || "No default URL"}</span>
                    </div>
                  </div>

                  <div className="px-5 py-3 border-t border-line flex items-center gap-2">
                    <Key className={`h-3.5 w-3.5 ${linkedAuthFunc ? "text-sage" : "text-mute"}`} />
                    <span
                      className="text-xs font-medium"
                      style={{ color: linkedAuthFunc ? "#276749" : "#8e8b82" }}
                    >
                      {linkedAuthFunc ? `Auth hook: ${linkedAuthFunc.name}` : "No auth hook linked"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Wizard modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(20,20,19,0.5)", backdropFilter: "blur(2px)" }}
        >
          <form
            onSubmit={onSaveSubmit}
            className="bg-cream rounded-2xl p-8 w-[620px] max-h-[85vh] overflow-y-auto shadow-[0_24px_48px_-12px_rgba(20,20,19,0.18)] flex flex-col gap-5"
          >
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <h2 className="m-0 font-serif text-xl font-medium text-ink">
                  {editingId ? "Edit browser profile" : "Create browser profile"}
                </h2>
                <span className="text-xs text-mute">
                  Step {wizardStep + 1} of {wizardSteps.length} — {STEP_LABELS[currentStep]}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="h-8 w-8 rounded-lg border border-line flex items-center justify-center hover:bg-panel transition-colors"
              >
                <X className="h-4 w-4 text-graphite" />
              </button>
            </div>

            {/* Step: setup method choice */}
            {currentStep === "method" && (
              <div className="flex flex-col gap-3">
                <p className="text-[13px] text-graphite m-0">
                  How do you want to set up the session data for this profile?
                </p>
                <button
                  type="button"
                  onClick={() => setSetupMethod("manual")}
                  className={`text-left p-4 rounded-xl border flex items-start gap-3 transition-colors ${setupMethod === "manual" ? "border-clay bg-panel shadow-[0_0_0_3px_rgba(204,120,92,0.12)]" : "border-line hover:bg-panel"}`}
                >
                  <Layers className="h-5 w-5 text-clay flex-shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-ink">Manual setup</span>
                    <span className="text-xs text-mute leading-relaxed">
                      Add localStorage entries through the raw value helper, then paste a cookies JSON array yourself.
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSetupMethod("extension")}
                  className={`text-left p-4 rounded-xl border flex items-start gap-3 transition-colors ${setupMethod === "extension" ? "border-clay bg-panel shadow-[0_0_0_3px_rgba(204,120,92,0.12)]" : "border-line hover:bg-panel"}`}
                >
                  <Globe className="h-5 w-5 text-clay flex-shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink">Use Chrome Extension Helper</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${helperActive ? "bg-sage-soft text-sage" : "bg-danger-soft text-danger"}`}>
                        {helperActive ? "Connected" : "Not connected"}
                      </span>
                    </div>
                    <span className="text-xs text-mute leading-relaxed">
                      Fetch cookies & localStorage from an open Chrome tab and pick which items to import.
                    </span>
                  </div>
                </button>
              </div>
            )}

            {/* Step (manual): localStorage — read-only JSON, input via raw helper only */}
            {currentStep === "localStorage" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[13px] font-medium text-graphite">Inject localStorage</label>
                  {!profileLocalStorage.trim() ? (
                    <div className="text-xs text-mute italic border border-dashed border-line rounded-lg p-4 text-center">
                      No localStorage entries yet. Add them with the raw value helper below.
                    </div>
                  ) : lsParseFailed ? (
                    <div className="flex flex-col gap-2">
                      <div className="text-xs text-danger">
                        The stored localStorage JSON is invalid and can’t be shown as entries. Clear it to start over.
                      </div>
                      <pre className="m-0 bg-panel border border-line rounded-lg p-3 font-mono text-[11px] text-mute max-h-[140px] overflow-auto whitespace-pre-wrap break-all">{profileLocalStorage}</pre>
                      <button
                        type="button"
                        onClick={() => setProfileLocalStorage("")}
                        className="self-start h-8 px-3 rounded-md border border-line text-xs font-medium text-danger hover:bg-danger-soft transition-colors"
                      >
                        Clear localStorage JSON
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="border border-line rounded-lg bg-panel p-2 flex flex-col gap-2 max-h-[180px] overflow-y-auto">
                        {lsOrigins.map((o: any, oi: number) => (
                          <div key={oi} className="flex flex-col gap-1">
                            <div className="text-[10px] font-semibold text-graphite uppercase tracking-wide px-1 truncate">
                              {o?.origin || "(no origin)"}
                            </div>
                            {(o?.localStorage || []).map((kv: any, ki: number) => (
                              <div key={ki} className="flex items-center gap-2 bg-cream border border-line rounded px-2 py-1">
                                <div className="flex-1 min-w-0 flex flex-col">
                                  <span className="font-mono text-[11px] font-medium text-ink truncate">{kv?.name}</span>
                                  <span className="text-[9px] text-mute truncate">{String(kv?.value ?? "")}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveLsEntry(o?.origin, kv?.name)}
                                  className="h-6 w-6 rounded flex items-center justify-center hover:bg-danger-soft transition-colors flex-shrink-0"
                                  title="Remove entry"
                                >
                                  <Trash2 className="h-3 w-3 text-graphite" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                      <pre className="m-0 bg-panel border border-line rounded-lg p-3 font-mono text-[11px] text-mute max-h-[120px] overflow-auto whitespace-pre-wrap break-all">{profileLocalStorage}</pre>
                    </div>
                  )}
                </div>

                <div className="bg-panel p-3 rounded-lg border border-line flex flex-col gap-2">
                  <span className="text-[11px] font-medium text-mute">
                    Add a raw value (paste it literally — backslashes and quotes are escaped for you automatically)
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Origin, e.g. https://example.com"
                      value={rawLsOrigin}
                      onChange={(e) => setRawLsOrigin(e.target.value)}
                      className="h-8 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay"
                    />
                    <input
                      type="text"
                      placeholder="Key name"
                      value={rawLsKey}
                      onChange={(e) => setRawLsKey(e.target.value)}
                      className="h-8 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay"
                    />
                  </div>
                  <textarea
                    rows={3}
                    placeholder="Raw value, exactly as it should appear in localStorage"
                    value={rawLsValue}
                    onChange={(e) => setRawLsValue(e.target.value)}
                    className="bg-cream border border-line rounded-md p-2.5 font-mono text-xs text-graphite outline-none focus:border-clay resize-none"
                  />
                  <button
                    type="button"
                    onClick={handleInsertRawLocalStorageValue}
                    className="self-end h-8 px-3 rounded-md border border-line text-xs font-medium text-graphite hover:border-clay hover:text-ink transition-colors"
                  >
                    Add entry
                  </button>
                </div>
              </div>
            )}

            {/* Step (manual): cookies */}
            {currentStep === "cookies" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-medium text-graphite">Inject cookies (JSON array)</label>
                <textarea
                  rows={12}
                  value={profileCookies}
                  onChange={(e) => setProfileCookies(e.target.value)}
                  placeholder={DEFAULT_PROFILE_COOKIES}
                  className="bg-cream border border-line rounded-lg p-3 font-mono text-xs text-graphite outline-none focus:border-clay resize-none"
                />
                <span className="text-[11px] text-mute">
                  Optional — leave empty if this profile only needs localStorage.
                </span>
              </div>
            )}

            {/* Step (extension): fetch & choose */}
            {currentStep === "import" && (
              <div className="bg-panel p-4 rounded-xl border border-line flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-clay uppercase tracking-[0.08em] flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 text-clay" /> Chrome Import Helper
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${helperActive ? "bg-sage-soft text-sage" : "bg-danger-soft text-danger"}`}>
                    {helperActive ? (extensionReady ? "Extension Active" : "Extension Active (via Sidecar)") : "Extension Inactive"}
                  </span>
                </div>

                {!helperActive ? (
                  <div className="flex flex-col gap-2.5">
                    <p className="text-xs text-mute leading-relaxed m-0 font-normal">
                      Install the <strong>Automation Explorer Helper</strong> Chrome extension to import cookies & localStorage directly from any open browser page: download the zip below, unzip it, then load the folder via <code>chrome://extensions</code> → enable <strong>Developer mode</strong> → <strong>Load unpacked</strong>.
                    </p>
                    <p className="text-xs text-mute leading-relaxed m-0 font-medium" style={{ color: "#c05621" }}>
                      ⚠️ Note: If you just installed/loaded the extension, you MUST <strong>reload this browser tab</strong> to inject the content script.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleDownloadExtension}
                        className="h-8 px-3 bg-clay hover:bg-clay-dark rounded-lg text-xs font-medium text-white transition-colors"
                      >
                        Download helper extension (.zip)
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          // Trigger direct check
                          window.postMessage({ source: "ae-web-app", type: "PING_EXTENSION" }, "*");
                          // Trigger sidecar check
                          try {
                            const res = await apiCall("/api/browser-helper/status");
                            setHelperConnected(res?.connected || false);
                          } catch (e) {
                            setHelperConnected(false);
                          }
                        }}
                        className="h-8 px-3 bg-cream hover:bg-panel border border-line rounded-lg text-xs font-medium text-graphite transition-colors"
                      >
                        Check connection again
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Dropdown
                          value={selectedTabId}
                          onChange={setSelectedTabId}
                          placeholder={isFetchingTabs ? "Loading tabs..." : "Select an open browser tab..."}
                          className="h-9 px-2.5 rounded-md text-xs text-ink w-full"
                          options={[
                            { value: "", label: "Select an open browser tab..." },
                            ...openTabs.map(t => ({
                              value: String(t.id),
                              label: t.title.length > 50 ? t.title.substring(0, 50) + "..." : t.title
                            }))
                          ]}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleFetchTabs}
                        disabled={isFetchingTabs}
                        className="h-9 px-3 rounded-md border border-line text-xs font-medium text-graphite hover:bg-cream transition-colors disabled:opacity-50 flex items-center gap-1.5"
                      >
                        <RefreshCw className={`h-3 w-3 ${isFetchingTabs ? "animate-spin" : ""}`} /> Refresh
                      </button>
                    </div>

                    {selectedTabId && (
                      <button
                        type="button"
                        onClick={handleFetchTabData}
                        disabled={isFetchingData}
                        className="h-9 px-4 bg-clay hover:bg-clay-dark rounded-md text-xs font-medium text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {isFetchingData ? (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Fetching data...
                          </>
                        ) : (
                          "Fetch Cookies & LocalStorage"
                        )}
                      </button>
                    )}

                    {fetchedData && (
                      <div className="border border-line rounded-lg bg-cream p-3 flex flex-col gap-3 max-h-[250px] overflow-y-auto">
                        <div className="text-xs font-medium text-ink flex flex-col gap-0.5">
                          <span className="text-mute">Source URL:</span>
                          <span className="font-mono text-[10px] break-all bg-panel p-1.5 rounded border border-line">{fetchedData.url}</span>
                        </div>

                        {/* Cookies selection list */}
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-semibold text-graphite uppercase tracking-wide">
                              Cookies ({fetchedData.cookies?.length || 0})
                            </div>
                            {fetchedData.cookies && fetchedData.cookies.length > 0 && (
                              <div className="flex gap-2 text-[9px] font-medium text-clay">
                                <button
                                  type="button"
                                  onClick={() => setSelectedCookies(fetchedData.cookies.map((c: any) => c.name))}
                                  className="hover:underline cursor-pointer"
                                >
                                  Select All
                                </button>
                                <span className="text-mute">|</span>
                                <button
                                  type="button"
                                  onClick={() => setSelectedCookies([])}
                                  className="hover:underline cursor-pointer"
                                >
                                  Select None
                                </button>
                              </div>
                            )}
                          </div>
                          {(!fetchedData.cookies || fetchedData.cookies.length === 0) ? (
                            <div className="text-xs text-mute italic px-1">No cookies found for this domain.</div>
                          ) : (
                            <div className="max-h-[90px] overflow-y-auto border border-line rounded p-2 flex flex-col gap-1 bg-panel">
                              {fetchedData.cookies.map((c: any, i: number) => (
                                <label key={i} className="flex items-start gap-2 text-xs text-graphite cursor-pointer select-none py-0.5 hover:bg-cream rounded px-1">
                                  <input
                                    type="checkbox"
                                    checked={selectedCookies.includes(c.name)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedCookies([...selectedCookies, c.name]);
                                      } else {
                                        setSelectedCookies(selectedCookies.filter(n => n !== c.name));
                                      }
                                    }}
                                    className="mt-0.5 rounded text-clay focus:ring-clay h-3.5 w-3.5"
                                  />
                                  <div className="flex-1 min-w-0 flex flex-col">
                                    <span className="font-mono text-[11px] font-medium truncate">{c.name}</span>
                                    <span className="text-[9px] text-mute truncate">{c.value}</span>
                                  </div>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* LocalStorage selection list */}
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-semibold text-graphite uppercase tracking-wide">
                              LocalStorage Keys ({Object.keys(fetchedData.localStorage || {}).length})
                            </div>
                            {Object.keys(fetchedData.localStorage || {}).length > 0 && (
                              <div className="flex gap-2 text-[9px] font-medium text-clay">
                                <button
                                  type="button"
                                  onClick={() => setSelectedLocalStorageKeys(Object.keys(fetchedData.localStorage))}
                                  className="hover:underline cursor-pointer"
                                >
                                  Select All
                                </button>
                                <span className="text-mute">|</span>
                                <button
                                  type="button"
                                  onClick={() => setSelectedLocalStorageKeys([])}
                                  className="hover:underline cursor-pointer"
                                >
                                  Select None
                                </button>
                              </div>
                            )}
                          </div>
                          {Object.keys(fetchedData.localStorage || {}).length === 0 ? (
                            <div className="text-xs text-mute italic px-1">No LocalStorage keys found.</div>
                          ) : (
                            <div className="max-h-[90px] overflow-y-auto border border-line rounded p-2 flex flex-col gap-1 bg-panel">
                              {Object.keys(fetchedData.localStorage).map((k) => (
                                <label key={k} className="flex items-start gap-2 text-xs text-graphite cursor-pointer select-none py-0.5 hover:bg-cream rounded px-1">
                                  <input
                                    type="checkbox"
                                    checked={selectedLocalStorageKeys.includes(k)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedLocalStorageKeys([...selectedLocalStorageKeys, k]);
                                      } else {
                                        setSelectedLocalStorageKeys(selectedLocalStorageKeys.filter(n => n !== k));
                                      }
                                    }}
                                    className="mt-0.5 rounded text-clay focus:ring-clay h-3.5 w-3.5"
                                  />
                                  <span className="font-mono text-[11px] truncate flex-1">{k}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={handleApplyImport}
                          className="h-8 bg-clay hover:bg-clay-dark text-white rounded-lg text-xs font-medium transition-colors"
                        >
                          Apply selected values to profile
                        </button>
                      </div>
                    )}

                    {importSummary && (
                      <div className="bg-sage-soft text-sage border border-line rounded-lg px-3 py-2 text-xs font-medium">
                        Imported {importSummary.cookies} cookies and {importSummary.ls} localStorage keys from {importSummary.origin}. You can fetch another tab to add more, or continue.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Step: details & save */}
            {currentStep === "details" && (
              <div className="flex flex-col gap-5">
                <div className="bg-panel border border-line rounded-lg px-3 py-2 text-xs text-graphite">
                  This profile will inject <strong>{cookieCount}</strong> cookies and <strong>{lsKeyCount}</strong> localStorage keys across <strong>{lsOrigins.length}</strong> origins.
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[13px] font-medium text-graphite">Profile name</label>
                  <input
                    type="text"
                    placeholder="e.g. Authenticated admin session"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    required
                    className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[13px] font-medium text-graphite">Default URL</label>
                  <input
                    type="text"
                    placeholder="e.g. https://admin.ninjavan.co/orders"
                    value={profileDefaultUrl}
                    onChange={(e) => setProfileDefaultUrl(e.target.value)}
                    className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
                  />
                </div>

                <div className="border-t border-line pt-3 flex flex-col gap-4">
                  <h4 className="text-[11px] font-semibold text-clay uppercase tracking-[0.08em]">Auth hook integration (optional)</h4>
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
            )}

            {/* Footer navigation */}
            <div className="flex items-center justify-between gap-2 pt-3 border-t border-line">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
              >
                Cancel
              </button>
              <div className="flex gap-2">
                {wizardStep > 0 && (
                  <button
                    type="button"
                    onClick={() => setWizardStep((s) => s - 1)}
                    className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
                  >
                    Back
                  </button>
                )}
                {currentStep !== "details" ? (
                  // key + preventDefault: React flushes the step change during
                  // the click, morphing this button into the submit button
                  // before the browser runs the default action — which then
                  // submits the form and saves/closes the wizard mid-flow.
                  <button
                    key="wizard-next"
                    type="button"
                    disabled={nextDisabled}
                    onClick={(e) => {
                      e.preventDefault();
                      setWizardStep((s) => s + 1);
                    }}
                    className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    key="wizard-submit"
                    type="submit"
                    className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors"
                  >
                    {editingId ? "Update profile" : "Save profile"}
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
