"use client";

import React, { useEffect, useState } from "react";
import { Check, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useAppContext, LlmProvider } from "../../context/AppContext";
import { useToast } from "../../context/ToastContext";
import SecretInput from "../../components/SecretInput";

const LLM_SETTINGS_PREF_KEY = "llm_settings";

// First entry per provider is the default model when the user hasn't picked one
// (keep in sync with DEFAULT_MODELS in backend/services/llm_provider.py).
const PROVIDERS: { id: LlmProvider; name: string; models: string[]; hint: string }[] = [
  { id: "claude", name: "Claude", models: ["claude-opus-5", "claude-sonnet-5", "claude-opus-4-8"], hint: "Get an API key at console.anthropic.com" },
  { id: "minimax", name: "MiniMax", models: ["MiniMax-M2.5", "MiniMax-M3", "MiniMax-M2"], hint: "Get an API key at platform.minimax.io" },
  { id: "gemini", name: "Gemini", models: ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-2.5-flash"], hint: "Get an API key at aistudio.google.com/apikey" },
];

const CUSTOM_MODEL = "__custom__";

type VerifyState = { status: "idle" | "verifying" | "ok" | "fail"; message?: string };

export default function SettingsPage() {
  const { apiCall, getPref, setPref, refreshLlmSettings } = useAppContext();
  const { showToast } = useToast();

  const defaultModels = (): Record<LlmProvider, string> => ({
    claude: PROVIDERS[0].models[0],
    minimax: PROVIDERS[1].models[0],
    gemini: PROVIDERS[2].models[0],
  });

  const [keys, setKeys] = useState<Record<LlmProvider, string>>({ claude: "", minimax: "", gemini: "" });
  // modelChoice is the <select> value (a known model id or CUSTOM_MODEL);
  // customModels holds the free-text id when Custom… is chosen.
  const [modelChoice, setModelChoice] = useState<Record<LlmProvider, string>>(defaultModels());
  const [customModels, setCustomModels] = useState<Record<LlmProvider, string>>({ claude: "", minimax: "", gemini: "" });
  const [activeProvider, setActiveProvider] = useState<LlmProvider | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verify, setVerify] = useState<Record<LlmProvider, VerifyState>>({
    claude: { status: "idle" },
    minimax: { status: "idle" },
    gemini: { status: "idle" },
  });

  const effectiveModel = (provider: LlmProvider): string => {
    const suggestions = PROVIDERS.find((p) => p.id === provider)!.models;
    if (modelChoice[provider] === CUSTOM_MODEL) {
      return customModels[provider].trim() || suggestions[0];
    }
    return modelChoice[provider];
  };

  useEffect(() => {
    (async () => {
      const raw = await getPref(LLM_SETTINGS_PREF_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          setKeys({
            claude: parsed?.keys?.claude || "",
            minimax: parsed?.keys?.minimax || "",
            gemini: parsed?.keys?.gemini || "",
          });
          const nextChoice = defaultModels();
          const nextCustom: Record<LlmProvider, string> = { claude: "", minimax: "", gemini: "" };
          for (const provider of PROVIDERS) {
            const stored = parsed?.models?.[provider.id];
            if (typeof stored !== "string" || !stored.trim()) continue;
            if (provider.models.includes(stored)) {
              nextChoice[provider.id] = stored;
            } else {
              nextChoice[provider.id] = CUSTOM_MODEL;
              nextCustom[provider.id] = stored;
            }
          }
          setModelChoice(nextChoice);
          setCustomModels(nextCustom);
          if (parsed?.activeProvider === "claude" || parsed?.activeProvider === "minimax" || parsed?.activeProvider === "gemini") {
            setActiveProvider(parsed.activeProvider);
          }
        } catch { /* malformed pref — start fresh */ }
      }
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      // A provider without a key can't stay active.
      const effectiveActive = activeProvider && keys[activeProvider].trim() ? activeProvider : null;
      setActiveProvider(effectiveActive);
      await setPref(
        LLM_SETTINGS_PREF_KEY,
        JSON.stringify({
          activeProvider: effectiveActive,
          keys: {
            claude: keys.claude.trim(),
            minimax: keys.minimax.trim(),
            gemini: keys.gemini.trim(),
          },
          models: {
            claude: effectiveModel("claude"),
            minimax: effectiveModel("minimax"),
            gemini: effectiveModel("gemini"),
          },
        })
      );
      await refreshLlmSettings();
      showToast(
        effectiveActive
          ? `Settings saved — AI features will use ${PROVIDERS.find((p) => p.id === effectiveActive)?.name}.`
          : "Settings saved. No active provider — AI features are disabled.",
        { type: "success" }
      );
    } catch (err: any) {
      showToast(err.message || "Failed to save settings", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async (provider: LlmProvider) => {
    const key = keys[provider].trim();
    if (!key) {
      setVerify((v) => ({ ...v, [provider]: { status: "fail", message: "Enter an API key first." } }));
      return;
    }
    setVerify((v) => ({ ...v, [provider]: { status: "verifying" } }));
    try {
      const res = await apiCall("/api/ai/verify-key", {
        method: "POST",
        body: JSON.stringify({ provider, key, model: effectiveModel(provider) }),
      });
      setVerify((v) => ({ ...v, [provider]: { status: res.ok ? "ok" : "fail", message: res.message } }));
    } catch (err: any) {
      setVerify((v) => ({ ...v, [provider]: { status: "fail", message: err.message || "Verification failed" } }));
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[720px] mx-auto flex flex-col gap-5">
          <div>
            <h2 className="m-0 font-serif text-xl font-medium text-ink">AI providers</h2>
            <p className="mt-1.5 text-[13px] text-stone leading-relaxed">
              Bring your own API key for the AI features (parser generation, description improvement,
              element naming, web exploration). Add a key for any provider below and choose one as active.
            </p>
            <p className="mt-1 text-[12px] text-mute leading-relaxed flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
              Keys are stored only on this device (local database) and are never synced to the cloud.
            </p>
          </div>

          {PROVIDERS.map((provider) => {
            const hasKey = keys[provider.id].trim().length > 0;
            const isActive = activeProvider === provider.id;
            const verifyState = verify[provider.id];
            return (
              <div key={provider.id} className="bg-cream border border-line rounded-xl p-5 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-ink">{provider.name}</div>
                    <div className="text-[11px] text-mute font-mono mt-0.5">{effectiveModel(provider.id)}</div>
                  </div>
                  <label
                    className={`flex items-center gap-2 text-[13px] font-medium ${hasKey ? "text-graphite cursor-pointer" : "text-mute cursor-not-allowed"}`}
                    title={hasKey ? "Use this provider for AI features" : "Add an API key first"}
                  >
                    <input
                      type="radio"
                      name="activeProvider"
                      checked={isActive}
                      disabled={!hasKey}
                      onChange={() => setActiveProvider(provider.id)}
                      className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                      style={{ accentColor: "#cc785c" }}
                    />
                    Active
                  </label>
                </div>

                <div className="flex gap-2 items-center">
                  <label className="text-[13px] font-medium text-graphite w-12 flex-shrink-0">Model</label>
                  <select
                    value={modelChoice[provider.id]}
                    onChange={(e) => {
                      setModelChoice((m) => ({ ...m, [provider.id]: e.target.value }));
                      setVerify((v) => ({ ...v, [provider.id]: { status: "idle" } }));
                    }}
                    className="h-10 flex-1 bg-cream border border-line rounded-lg px-3 font-mono text-xs text-ink outline-none focus:border-clay cursor-pointer"
                  >
                    {provider.models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    <option value={CUSTOM_MODEL}>Custom…</option>
                  </select>
                  {modelChoice[provider.id] === CUSTOM_MODEL && (
                    <input
                      type="text"
                      value={customModels[provider.id]}
                      onChange={(e) => {
                        setCustomModels((m) => ({ ...m, [provider.id]: e.target.value }));
                        setVerify((v) => ({ ...v, [provider.id]: { status: "idle" } }));
                      }}
                      placeholder="model id"
                      spellCheck={false}
                      className="h-10 flex-1 bg-cream border border-line rounded-lg px-3 font-mono text-xs text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
                    />
                  )}
                </div>

                <div className="flex gap-2 items-center">
                  <label className="text-[13px] font-medium text-graphite w-12 flex-shrink-0">Key</label>
                  <SecretInput
                    value={keys[provider.id]}
                    onChange={(value) => {
                      setKeys((k) => ({ ...k, [provider.id]: value }));
                      setVerify((v) => ({ ...v, [provider.id]: { status: "idle" } }));
                    }}
                    placeholder={`${provider.name} API key`}
                  />
                  <button
                    type="button"
                    onClick={() => handleVerify(provider.id)}
                    disabled={verifyState.status === "verifying"}
                    className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors flex items-center gap-1.5 disabled:opacity-60"
                  >
                    {verifyState.status === "verifying" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Verify
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 min-h-[18px]">
                  {verifyState.status === "ok" && (
                    <span className="text-[12px] text-[#276749] flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" /> {verifyState.message || "Key verified."}
                    </span>
                  )}
                  {verifyState.status === "fail" && (
                    <span className="text-[12px] text-danger flex items-start gap-1">
                      <XCircle className="h-3.5 w-3.5 flex-shrink-0 mt-[1px]" />
                      <span className="break-all">{verifyState.message || "Verification failed."}</span>
                    </span>
                  )}
                  {(verifyState.status === "idle" || verifyState.status === "verifying") && (
                    <span className="text-[12px] text-mute">{provider.hint}</span>
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={!loaded || saving}
              className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white flex items-center gap-2 transition-colors disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
