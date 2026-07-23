"use client";

import React, { useState, useEffect } from "react";
import { Plus, Trash2, Pencil, X, Clock, CheckCircle2, Circle, RefreshCw, Play } from "lucide-react";
import Editor from "@monaco-editor/react";
import { useAppContext, AuthFunction } from "../../context/AppContext";
import { useToast } from "../../context/ToastContext";
import { confirmDialog } from "../../utils/confirmDialog";

const DEFAULT_SCRIPT = `// Call IAM/OAuth endpoint to get token
const response = fetchToken("https://api.example.com/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET })
});

// Parse output and return token
const data = JSON.parse(response);
return data.access_token;`;

const PRESETS: { id: string; label: string; description: string; script: string }[] = [
  {
    id: "opv2",
    label: "Operator V2",
    description: "Client-credentials grant against the Operator V2 (OPV2) OAuth endpoint.",
    script: `const response = fetchToken("https://api.ninjavan.dev/sg/aaa/2.0/oauth/access_token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ client_id: "opv2_client_id", client_secret: "opv2_client_secret", grant_type: "client_credentials" })
});

const data = JSON.parse(response);

return data.access_token;`,
  },
  {
    id: "pudo",
    label: "PUDO",
    description: "Username/password login against the PUDO (Pick-up, Drop-off) partner API.",
    script: `const response = fetchToken("https://api.ninjavan.co/global/dp/1.0/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "dp_user", password: "dp_password" })
});

const data = JSON.parse(response);

return data.data.access_token;`,
  },
];

export default function AuthFunctionsPage() {
  const { authFunctions, handleSaveAuthFunc, handleDeleteAuthFunc, apiCall, selectedEnvId } = useAppContext();
  const { showToast } = useToast();

  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [script, setScript] = useState("");
  const [expiresIn, setExpiresIn] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Script testing state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; result?: string | Record<string, any>; error?: string } | null>(null);

  // Which functions have a currently-valid device-local token cache — the
  // sidecar validates expiry and script hash, so this map only ever contains
  // live entries.
  const [tokenCache, setTokenCache] = useState<Record<string, { expiresAt: string }>>({});
  const refreshTokenCache = () => {
    apiCall("/api/executor/auth-cache")
      .then((res) => setTokenCache(res || {}))
      .catch(() => setTokenCache({}));
  };
  useEffect(() => {
    refreshTokenCache();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setDesc("");
    setExpiresIn("");
    setScript(DEFAULT_SCRIPT);
    setTestResult(null);
    setShowModal(true);
  };

  const openEdit = (func: AuthFunction) => {
    setEditingId(func.id);
    setName(func.name);
    setDesc(func.description);
    setScript(func.script);
    setExpiresIn(func.expires_in ? String(func.expires_in) : "");
    setTestResult(null);
    setShowModal(true);
  };

  const applyPreset = async (presetId: string) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    if (script.trim() && script.trim() !== DEFAULT_SCRIPT.trim() && !(await confirmDialog(`Replace the current script with the "${preset.label}" preset?`))) {
      return;
    }
    setScript(preset.script);
    setTestResult(null);
  };

  const handleTestScript = async () => {
    if (!script) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await apiCall("/api/executor/auth-test", {
        method: "POST",
        body: JSON.stringify({
          script,
          environment_id: selectedEnvId || null
        })
      });
      setTestResult(res);
    } catch (err: any) {
      setTestResult({ success: false, error: err.message || "Failed to run test call." });
    } finally {
      setIsTesting(false);
    }
  };

  const onSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !script) return;
    try {
      await handleSaveAuthFunc(name, desc, script, expiresIn ? parseInt(expiresIn, 10) : null, editingId);
      setShowModal(false);
      refreshTokenCache(); // a script/TTL edit invalidates the device-local cache
    } catch (err: any) {
      showToast(err.message, { type: "error" });
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
          <Plus className="h-4 w-4" /> Create auth function
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {authFunctions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <div className="text-base font-medium text-graphite">No auth functions yet</div>
            <div className="text-[13px] text-mute max-w-sm leading-relaxed">
              Create sandboxed JS hooks that fetch and keep authorization tokens fresh in the background.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 content-start">
            {authFunctions.map((func) => (
              <div key={func.id} className="bg-cream border border-line rounded-xl overflow-hidden flex flex-col">
                <div className="px-5 pt-4 pb-3 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink mb-1 truncate">{func.name}</div>
                    <div className="text-xs text-stone leading-relaxed">
                      {func.description || "No description provided."}
                    </div>
                  </div>
                  <button
                    onClick={() => openEdit(func)}
                    className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-panel transition-colors flex-shrink-0"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5 text-graphite" />
                  </button>
                  <button
                    onClick={async () => {
                      if (await confirmDialog("Delete this auth function?")) await handleDeleteAuthFunc(func.id);
                    }}
                    className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-danger-soft hover:text-danger transition-colors flex-shrink-0"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-graphite" />
                  </button>
                </div>

                <div className="px-5 pb-4">
                  <pre className="m-0 p-3.5 bg-ink-900 text-cream rounded-lg font-mono text-[11px] leading-relaxed overflow-auto max-h-[110px] whitespace-pre">
                    {func.script}
                  </pre>
                </div>

                <div className="px-5 py-3 border-t border-line flex items-center gap-2">
                  {tokenCache[func.id] ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-sage" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-mute" />
                  )}
                  <span
                    className="text-xs font-medium"
                    style={{ color: tokenCache[func.id] ? "#276749" : "#8e8b82" }}
                  >
                    {tokenCache[func.id] ? "Cached token active" : "No token cached"}
                  </span>
                  {func.expires_in ? (
                    <div className="ml-auto flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-stone" />
                      <span className="font-mono text-[11px] text-stone">{func.expires_in}s TTL</span>
                    </div>
                  ) : (
                    <span className="ml-auto text-[11px] text-mute">JWT / default TTL</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(20,20,19,0.5)", backdropFilter: "blur(2px)" }}
        >
          <form
            onSubmit={onSaveSubmit}
            className="bg-cream rounded-2xl p-8 w-[620px] max-h-[85vh] overflow-y-auto shadow-[0_24px_48px_-12px_rgba(20,20,19,0.18)] flex flex-col gap-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="m-0 font-serif text-xl font-medium text-ink">
                {editingId ? "Edit auth function" : "Create auth function"}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="h-8 w-8 rounded-lg border border-line flex items-center justify-center hover:bg-panel transition-colors"
              >
                <X className="h-4 w-4 text-graphite" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5 col-span-2">
                <label className="text-[13px] font-medium text-graphite">Hook name</label>
                <input
                  type="text"
                  placeholder="e.g. Prod OAuth hook"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
                />
              </div>
              <div className="flex flex-col gap-1.5 col-span-2">
                <label className="text-[13px] font-medium text-graphite">
                  Description <span className="font-normal text-mute">Optional</span>
                </label>
                <input
                  type="text"
                  placeholder="What does this hook do?"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-medium text-graphite">Expires-in (seconds)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="3600"
                  value={expiresIn}
                  onChange={(e) => setExpiresIn(e.target.value)}
                  className="h-10 bg-cream border border-line rounded-lg px-3.5 font-mono text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[13px] font-medium text-graphite">Token fetch script</label>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) applyPreset(e.target.value);
                    e.target.value = "";
                  }}
                  title="Start from a preset for a known Ninja Van service"
                  className="h-7 px-2 bg-cream border border-line rounded-md text-[12px] text-graphite outline-none focus:border-clay cursor-pointer"
                >
                  <option value="" disabled>
                    Use a preset...
                  </option>
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id} title={p.description}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-lg overflow-hidden border border-line">
                <Editor
                  height="260px"
                  language="javascript"
                  theme="vs-dark"
                  value={script}
                  onChange={(val) => setScript(val || "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineNumbers: "on",
                    scrollbar: { vertical: "auto", horizontal: "hidden" },
                  }}
                />
              </div>
            </div>

            {testResult && (
              <div className="mt-1 p-3.5 bg-slate-950 border border-slate-800 rounded-lg text-xs leading-relaxed max-h-[150px] overflow-y-auto font-mono">
                {testResult.success ? (
                  <div className="text-emerald-400 break-all">
                    <span className="font-semibold text-emerald-300">✓ Token generated successfully:</span>
                    {typeof testResult.result === "object" && testResult.result !== null ? (
                      <pre className="mt-1 text-[11px] select-all whitespace-pre-wrap">
                        {JSON.stringify(testResult.result, null, 2)}
                      </pre>
                    ) : (
                      <div className="mt-1 text-[11px] select-all">{testResult.result}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-rose-400 whitespace-pre-wrap">
                    <span className="font-semibold text-rose-300">✗ Script Error:</span>
                    <div className="mt-1 text-[11px]">{testResult.error}</div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t border-line">
              <div>
                <button
                  type="button"
                  onClick={handleTestScript}
                  disabled={isTesting || !script}
                  className="h-10 px-4 border border-line rounded-lg text-[13px] font-medium text-ink bg-panel hover:bg-panel-dark transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isTesting ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Testing...
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" /> Test script
                    </>
                  )}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors"
                >
                  Save auth function
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
