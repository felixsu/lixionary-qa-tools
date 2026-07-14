"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shield, RefreshCw, X, Play, Users, ChevronRight, ChevronDown, Trash2, Plus, AlertCircle } from "lucide-react";
import { useAppContext } from "../../context/AppContext";

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
}

export default function AdminConsolePage() {
  const { user, apiCall } = useAppContext();
  const router = useRouter();

  const [collections, setCollections] = useState<Collection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  // UI state for expanding collections
  const [expandedCollections, setExpandedCollections] = useState<Record<string, boolean>>({});

  // UI state for collaborator management modal
  const [collabModalCollection, setCollabModalCollection] = useState<Collection | null>(null);
  const [newCollabEmail, setNewCollabEmail] = useState("");
  const [collabError, setCollabError] = useState("");
  const [isCollabSubmitting, setIsCollabSubmitting] = useState(false);

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
    }
  }, [user]);

  const toggleCollection = (colId: string) => {
    setExpandedCollections((prev) => ({
      ...prev,
      [colId]: !prev[colId],
    }));
  };

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
      alert(e.message || "Failed to remove collaborator.");
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
            onClick={() => router.replace("/api-explorer")}
            className="px-4 py-2 bg-clay hover:bg-clay-dark text-white rounded-lg text-sm font-medium transition-colors"
          >
            Back to API explorer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-cream">
      {/* Header Tabs */}
      <div className="h-14 flex items-center justify-between px-6 border-b border-line flex-shrink-0 bg-cream">
        <h2 className="text-[13px] font-semibold text-graphite uppercase tracking-wider">
          Collection Management
        </h2>

        <button
          onClick={loadData}
          disabled={isLoading}
          className="h-8 w-8 rounded-lg border border-line flex items-center justify-center hover:bg-panel text-stone hover:text-ink transition-colors disabled:opacity-50"
          title="Refresh data"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {errorMsg && (
          <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-danger/30 bg-danger-soft p-4 text-xs text-danger font-semibold max-w-2xl">
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
          <div className="space-y-3 max-w-4xl">
              {collections.map((col) => {
                const isExpanded = !!expandedCollections[col.id];
                return (
                  <div key={col.id} className="border border-line rounded-xl bg-cream overflow-hidden shadow-sm">
                    {/* Primary Row */}
                    <div className="px-5 py-4 flex items-center justify-between hover:bg-hover/40 transition-colors">
                      <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => toggleCollection(col.id)}>
                        <div className="text-stone">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-ink">{col.name}</h4>
                          <p className="text-[11px] text-stone mt-0.5 truncate max-w-md">
                            {col.description || "No description provided."}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        {/* Owner */}
                        <div className="text-right">
                          <span className="text-[10px] uppercase font-bold text-mute tracking-wider block">Owner</span>
                          <span className="text-xs font-medium text-graphite">{col.owner.email}</span>
                        </div>

                        {/* Collaborators badge */}
                        <button
                          onClick={() => setCollabModalCollection(col)}
                          className="h-[34px] px-3 bg-panel hover:bg-hover border border-line rounded-lg flex items-center gap-1.5 transition-colors"
                          title="Manage collaborators"
                        >
                          <Users className="h-3.5 w-3.5 text-stone" />
                          <span className="text-xs font-semibold text-graphite">
                            {col.collaborators.length}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Expandable Requests Panel */}
                    {isExpanded && (
                      <div className="bg-panel border-t border-line px-5 py-4 space-y-2">
                        <h5 className="text-[10px] font-bold uppercase tracking-wider text-stone mb-2">
                          API Requests ({col.requests.length})
                        </h5>
                        {col.requests.length === 0 ? (
                          <div className="text-xs text-mute italic py-2">No API requests in this collection.</div>
                        ) : (
                          <div className="space-y-1.5">
                            {col.requests.map((req) => (
                              <div key={req.id} className="flex items-center gap-2.5 text-xs py-1.5 px-3 rounded-lg bg-cream border border-line-soft">
                                <span
                                  className={`font-bold font-mono px-1.5 py-0.5 rounded text-[10px] ${
                                    req.method === "GET"
                                      ? "bg-sage/10 text-sage"
                                      : req.method === "POST"
                                      ? "bg-clay/10 text-clay"
                                      : "bg-stone/10 text-stone"
                                  }`}
                                >
                                  {req.method}
                                </span>
                                <span className="font-semibold text-graphite">{req.name}</span>
                                <span className="text-[11px] text-mute font-mono truncate max-w-lg flex-1">
                                  {req.url}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
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
