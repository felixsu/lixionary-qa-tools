"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shield, RefreshCw, X, Users, Trash2, Plus, AlertCircle, Sparkles } from "lucide-react";
import { useAppContext } from "../../context/AppContext";
import { useToast } from "../../context/ToastContext";
import { useNowTick } from "../../utils/useNowTick";
import { formatRelativeTime } from "../../utils/formatRelativeTime";

interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
  role: string;
  disabled: boolean;
}

interface ActiveSession {
  session_id: string;
  status: string;
  created_at: string;
  profile_id: string | null;
  user: UserProfile;
}

interface RequestDefinition {
  id: string;
  name: string;
  method: string;
  url: string;
}

interface Collection {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  collaboratorIds: string[];
  requests: RequestDefinition[];
  owner: UserProfile;
  collaborators: UserProfile[];
  updatedAt?: string;
}

export default function AdminConsolePage() {
  const { user, apiCall } = useAppContext();
  const { showToast } = useToast();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"collections" | "prompts">("collections");
  const nowTick = useNowTick(30000);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  // UI state for collaborator management modal
  const [collabModalCollection, setCollabModalCollection] = useState<Collection | null>(null);
  const [newCollabEmail, setNewCollabEmail] = useState("");
  const [collabError, setCollabError] = useState("");
  const [isCollabSubmitting, setIsCollabSubmitting] = useState(false);

  // AI description base prompt setting
  const [basePrompt, setBasePrompt] = useState("");
  const [basePromptIsDefault, setBasePromptIsDefault] = useState(true);
  const [basePromptUpdatedByName, setBasePromptUpdatedByName] = useState<string | null>(null);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [promptStatus, setPromptStatus] = useState<{ kind: "success" | "error"; msg: string } | null>(null);

  const loadBasePrompt = async () => {
    try {
      const data = await apiCall("/api/admin/settings/description-base-prompt");
      setBasePrompt(data.value || "");
      setBasePromptIsDefault(!!data.isDefault);
      setBasePromptUpdatedByName(data.updatedByName || null);
    } catch (e: any) {
      setPromptStatus({ kind: "error", msg: e.message || "Failed to load the AI base prompt." });
    }
  };

  const handleSaveBasePrompt = async () => {
    setIsSavingPrompt(true);
    setPromptStatus(null);
    try {
      const data = await apiCall("/api/admin/settings/description-base-prompt", {
        method: "PUT",
        body: JSON.stringify({ value: basePrompt }),
      });
      setBasePrompt(data.value || "");
      setBasePromptIsDefault(!!data.isDefault);
      setBasePromptUpdatedByName(data.updatedByName || null);
      setPromptStatus({
        kind: "success",
        msg: data.isDefault ? "Reverted to the built-in default prompt." : "Base prompt saved.",
      });
    } catch (e: any) {
      setPromptStatus({ kind: "error", msg: e.message || "Failed to save the AI base prompt." });
    } finally {
      setIsSavingPrompt(false);
    }
  };

  // Load collections data
  const loadData = async () => {
    setIsLoading(true);
    setErrorMsg("");
    try {
      const data = await apiCall("/api/admin/collections");
      setCollections(data);
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to load administration data.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === "admin") {
      loadData();
      loadBasePrompt();
    }
  }, [user]);

  // Add collaborator
  const handleAddCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collabModalCollection || !newCollabEmail) return;
    setCollabError("");
    setIsCollabSubmitting(true);
    try {
      const response = await apiCall(`/api/admin/collections/${collabModalCollection.id}/collaborators`, {
        method: "POST",
        body: JSON.stringify({ email: newCollabEmail.trim() }),
      });
      
      // Update local state
      const updatedCol = response.collection;
      // Re-fetch collections or update locally. Let's re-fetch to get complete hydrated user profiles of collaborators.
      const freshCollections = await apiCall("/api/admin/collections");
      setCollections(freshCollections);
      
      // Update the active modal collection
      const matching = freshCollections.find((c: Collection) => c.id === collabModalCollection.id);
      if (matching) setCollabModalCollection(matching);

      setNewCollabEmail("");
    } catch (e: any) {
      setCollabError(e.message || "Failed to add collaborator.");
    } finally {
      setIsCollabSubmitting(false);
    }
  };

  // Remove collaborator
  const handleRemoveCollaborator = async (collabUid: string) => {
    if (!collabModalCollection) return;
    try {
      await apiCall(`/api/admin/collections/${collabModalCollection.id}/collaborators/${collabUid}`, {
        method: "DELETE",
      });

      // Update state locally
      const freshCollections = await apiCall("/api/admin/collections");
      setCollections(freshCollections);
      
      const matching = freshCollections.find((c: Collection) => c.id === collabModalCollection.id);
      if (matching) setCollabModalCollection(matching);
    } catch (e: any) {
      showToast(e.message || "Failed to remove collaborator.", { type: "error" });
    }
  };

  // Auth guard page level
  if (user?.role !== "admin") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-cream text-ink px-6">
        <div className="text-center max-w-md p-8 border border-line bg-panel rounded-2xl shadow-sm">
          <Shield className="h-12 w-12 text-clay mx-auto mb-4" />
          <h2 className="text-xl font-bold text-ink mb-2">Access Denied</h2>
          <p className="text-sm text-stone mb-6">
            You require administrator privileges to access this console page.
          </p>
          <button
            onClick={() => router.replace("/home")}
            className="px-4 py-2 bg-clay hover:bg-clay-dark text-white rounded-lg text-sm font-medium transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-cream">
      {/* Header */}
      <div className="h-14 flex items-center justify-between px-6 border-b border-line flex-shrink-0 bg-cream">
        <h2 className="text-[13px] font-semibold text-graphite uppercase tracking-wider">
          Admin Console
        </h2>

        <button
          onClick={() => (activeTab === "collections" ? loadData() : loadBasePrompt())}
          disabled={isLoading}
          className="h-8 w-8 rounded-lg border border-line flex items-center justify-center hover:bg-panel text-stone hover:text-ink transition-colors disabled:opacity-50"
          title="Refresh data"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto px-10 py-8">
        <div className="max-w-[1040px] mx-auto flex flex-col gap-5">

          <div>
            <div className="font-serif text-[26px] font-medium tracking-[-0.3px] text-ink">Admin Console</div>
            <div className="text-sm text-stone mt-1.5">Workspace-wide oversight — visible to admins only.</div>
          </div>

          {/* Tab Selector */}
          <div className="flex border-b border-line flex-shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab("collections")}
              className={`py-2.5 px-[18px] text-[13px] border-b-2 transition-all cursor-pointer ${
                activeTab === "collections"
                  ? "border-clay text-ink font-medium"
                  : "border-transparent text-stone hover:text-graphite"
              }`}
            >
              Collections across all users
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("prompts")}
              className={`py-2.5 px-[18px] text-[13px] border-b-2 transition-all cursor-pointer ${
                activeTab === "prompts"
                  ? "border-clay text-ink font-medium"
                  : "border-transparent text-stone hover:text-graphite"
              }`}
            >
              Description auto-generation
            </button>
          </div>

        {activeTab === "prompts" && (
          <div className="flex flex-col gap-3.5 max-w-[640px]">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 text-clay flex-shrink-0" />
              <p className="text-[13px] text-stone leading-relaxed">
                This prompt runs whenever a user asks Lixionary to auto-generate a request&apos;s Description.
                Edit it to change tone, length, or what gets pulled in.
              </p>
              {basePromptIsDefault ? (
                <span className="ml-auto text-[10px] uppercase font-bold tracking-wider text-stone bg-panel border border-line rounded px-2 py-1 flex-shrink-0">
                  Default
                </span>
              ) : (
                <span className="ml-auto text-[10px] uppercase font-bold tracking-wider text-clay bg-clay/10 border border-clay/30 rounded px-2 py-1 flex-shrink-0">
                  Custom
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] font-semibold text-stone uppercase tracking-wider">System prompt</div>
              <textarea
                rows={8}
                value={basePrompt}
                onChange={(e) => setBasePrompt(e.target.value)}
                placeholder="Base system prompt for AI description improvement…"
                className="w-full bg-ink-900 border border-line rounded-lg px-3.5 py-3.5 text-xs leading-relaxed font-mono resize-y focus:outline-none"
                style={{ color: "#9cc9ff" }}
              />
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] font-semibold text-stone uppercase tracking-wider">Model</span>
              <span className="text-xs px-3 py-1 rounded-full bg-hover text-clay font-medium">Claude Sonnet</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveBasePrompt}
                disabled={isSavingPrompt}
                className="h-9 px-[18px] bg-clay hover:bg-clay-dark text-white rounded-lg text-[13px] font-medium transition-all disabled:opacity-50 w-fit"
              >
                {isSavingPrompt ? "Saving…" : "Save prompt"}
              </button>
              <button
                onClick={loadBasePrompt}
                className="h-9 px-[18px] bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite transition-colors hover:bg-panel w-fit"
              >
                Test with sample request
              </button>
              <span className="text-[11px] text-mute">
                Saving an empty prompt reverts to the built-in default.
                {!basePromptIsDefault && basePromptUpdatedByName ? ` Last edited by ${basePromptUpdatedByName}.` : ""}
              </span>
              {promptStatus && (
                <span
                  className={`ml-auto text-[11px] font-bold ${
                    promptStatus.kind === "success" ? "text-sage" : "text-danger"
                  }`}
                >
                  {promptStatus.msg}
                </span>
              )}
            </div>
          </div>
        )}

        {activeTab === "collections" && (
          <>
            {errorMsg && (
              <div className="flex items-center gap-2.5 rounded-xl border border-danger/30 bg-danger-soft p-4 text-xs text-danger font-semibold">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <p>{errorMsg}</p>
              </div>
            )}

            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div
                  className="h-7 w-7 rounded-full border-2 border-line border-t-clay mb-3"
                  style={{ animation: "spin 0.8s linear infinite" }}
                />
                <p className="text-xs text-stone">Loading directory details...</p>
              </div>
            ) : collections.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <Users className="h-10 w-10 text-stone/50 mb-3" />
                <div className="text-sm font-semibold text-graphite">No collections created</div>
                <p className="text-xs text-mute max-w-sm mt-1">
                  When users create collection workspaces, they will appear here.
                </p>
              </div>
            ) : (
              <div className="bg-cream border border-line rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2.5 bg-panel text-[11px] font-semibold uppercase tracking-wider text-stone">
                  <span className="flex-[2]">Collection</span>
                  <span className="flex-[1.4]">Owner</span>
                  <span className="w-[70px] text-right">Requests</span>
                  <span className="w-[100px] text-right">Last synced</span>
                  <span className="w-9" />
                </div>
                {collections.map((col) => (
                  <div
                    key={col.id}
                    className="flex items-center gap-3 px-4 py-2.5 border-t border-line-soft"
                  >
                    <div className="flex-[2] min-w-0">
                      <div className="text-[13px] font-medium text-graphite truncate">{col.name}</div>
                      {col.description && (
                        <div className="text-[11px] text-mute truncate">{col.description}</div>
                      )}
                    </div>
                    <div className="flex-[1.4] flex items-center gap-2 text-xs text-stone min-w-0">
                      <span className="h-5 w-5 rounded-full bg-chip flex items-center justify-center text-[10px] font-semibold text-graphite flex-shrink-0">
                        {(col.owner.name || col.owner.email).charAt(0).toUpperCase()}
                      </span>
                      <span className="truncate">{col.owner.name || col.owner.email}</span>
                    </div>
                    <span className="w-[70px] text-right font-mono text-xs text-graphite">
                      {col.requests.length}
                    </span>
                    <span className="w-[100px] text-right text-xs text-mute">
                      {formatRelativeTime(col.updatedAt, nowTick)}
                    </span>
                    <button
                      onClick={() => setCollabModalCollection(col)}
                      className="w-9 h-7 rounded-lg border border-line bg-cream hover:bg-hover flex items-center justify-center gap-1 transition-colors flex-shrink-0"
                      title="Manage collaborators"
                    >
                      <Users className="h-3 w-3 text-stone" />
                      <span className="text-[10px] font-semibold text-graphite">{col.collaborators.length}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        </div>
      </div>

      {/* Modal: Collaborator Manager */}
      {collabModalCollection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-md bg-cream border border-line rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-sm font-bold text-ink truncate">
                Share: {collabModalCollection.name}
              </h3>
              <button
                onClick={() => {
                  setCollabModalCollection(null);
                  setNewCollabEmail("");
                  setCollabError("");
                }}
                className="p-1 rounded-md text-stone hover:text-ink hover:bg-hover transition-all"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Current collaborators */}
            <div className="space-y-2 max-h-48 overflow-y-auto">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone">
                Active Collaborators ({collabModalCollection.collaborators.length})
              </span>
              {collabModalCollection.collaborators.length === 0 ? (
                <div className="text-xs text-mute italic py-2">
                  This collection isn't shared with anyone yet.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {collabModalCollection.collaborators.map((c) => (
                    <div key={c.id} className="flex items-center justify-between py-1.5 px-2.5 rounded-lg border border-line-soft bg-panel">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-ink truncate">{c.name}</div>
                        <div className="text-[10px] text-mute truncate">{c.email}</div>
                      </div>
                      <button
                        onClick={() => handleRemoveCollaborator(c.id)}
                        className="text-stone hover:text-danger p-1 rounded-md hover:bg-danger-soft transition-colors"
                        title="Revoke access"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <hr className="border-line" />

            {/* Add new collaborator */}
            <form onSubmit={handleAddCollaborator} className="space-y-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone">
                Add Collaborator
              </span>
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  placeholder="collaborator@company.com"
                  value={newCollabEmail}
                  onChange={(e) => setNewCollabEmail(e.target.value)}
                  className="flex-1 bg-panel border border-line rounded-lg px-3 py-2 text-xs text-ink placeholder-mute focus:outline-none focus:border-clay"
                />
                <button
                  type="submit"
                  disabled={isCollabSubmitting}
                  className="px-3 bg-clay hover:bg-clay-dark text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
              
              {collabError && (
                <p className="text-[11px] font-bold text-danger flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" /> {collabError}
                </p>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
