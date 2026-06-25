"use client";

import React, { useState } from "react";
import { Plus } from "lucide-react";
import Editor from "@monaco-editor/react";
import { useAppContext, AuthFunction } from "../../context/AppContext";

export default function AuthFunctionsPage() {
  const {
    authFunctions,
    handleSaveAuthFunc,
    handleDeleteAuthFunc
  } = useAppContext();

  // Local modal states
  const [showAuthFuncModal, setShowAuthFuncModal] = useState(false);
  const [authFuncName, setAuthFuncName] = useState("");
  const [authFuncDesc, setAuthFuncDesc] = useState("");
  const [authFuncScript, setAuthFuncScript] = useState("");
  const [authFuncExpiresIn, setAuthFuncExpiresIn] = useState<string>("");
  const [editingAuthFuncId, setEditingAuthFuncId] = useState<string | null>(null);

  const openAuthFuncCreate = () => {
    setEditingAuthFuncId(null);
    setAuthFuncName("");
    setAuthFuncDesc("");
    setAuthFuncExpiresIn("");
    setAuthFuncScript(`// Write code to fetch token contextually\nconst response = fetchToken("https://api.example.com/oauth/token", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET })\n});\nconst data = JSON.parse(response);\nreturn data.access_token;`);
    setShowAuthFuncModal(true);
  };

  const openAuthFuncEdit = (func: AuthFunction) => {
    setEditingAuthFuncId(func.id);
    setAuthFuncName(func.name);
    setAuthFuncDesc(func.description);
    setAuthFuncScript(func.script);
    setAuthFuncExpiresIn(func.expires_in ? String(func.expires_in) : "");
    setShowAuthFuncModal(true);
  };

  const onSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authFuncName || !authFuncScript) return;
    const expiresSec = authFuncExpiresIn ? parseInt(authFuncExpiresIn, 10) : null;
    try {
      await handleSaveAuthFunc(authFuncName, authFuncDesc, authFuncScript, expiresSec, editingAuthFuncId);
      setShowAuthFuncModal(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8 space-y-6">
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div>
          <h3 className="text-base font-bold text-slate-200">Self-Refreshing Auth Functions</h3>
          <p className="text-xs text-slate-500">Create sandboxed JS snippets to call APIs, get authorization tokens, and keep JWTs active in the background.</p>
        </div>
        <button
          onClick={openAuthFuncCreate}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-xs px-3.5 py-2 rounded-lg font-bold transition-all shadow-md shadow-indigo-600/10 text-white"
        >
          <Plus className="h-4 w-4" />
          Create Auth Function
        </button>
      </div>

      {/* Grid lists */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {authFunctions.map(func => (
          <div key={func.id} className="border border-slate-850 rounded-2xl bg-slate-900/40 p-5 space-y-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-850 pb-2.5">
                <span className="font-bold text-slate-200">{func.name}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => openAuthFuncEdit(func)}
                    className="text-xs text-indigo-400 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm("Are you sure you want to delete this auth function?")) {
                        await handleDeleteAuthFunc(func.id);
                      }
                    }}
                    className="text-xs text-red-400 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <p className="text-xs text-slate-400 mt-2">{func.description || "No description provided."}</p>

              <div className="mt-4 bg-slate-950 p-3 rounded-lg border border-slate-900 max-h-40 overflow-y-auto font-mono text-[11px] text-slate-400">
                <pre className="text-slate-300 leading-relaxed overflow-x-auto whitespace-pre">{func.script}</pre>
              </div>
            </div>

            <div className="text-[10px] text-slate-500 font-semibold border-t border-slate-850/80 pt-3 flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span>Token Status:</span>
                {func.expires_in && <span className="text-[9px] text-slate-500">TTL: {func.expires_in}s</span>}
              </div>
              <span className={func.cachedToken ? "text-emerald-400" : "text-amber-400"}>
                {func.cachedToken ? "Cached Token Active" : "No Token Cached"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* CREATE/EDIT AUTH FUNCTION MODAL */}
      {showAuthFuncModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <form onSubmit={onSaveSubmit} className="w-full max-w-2xl bg-slate-900 border border-slate-850 rounded-2xl p-6 space-y-4 max-h-[85vh] flex flex-col shadow-2xl">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
              {editingAuthFuncId ? "Edit Auth Function" : "Create Auth Function"}
            </h3>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-400">Hook Name</label>
                <input
                  type="text"
                  placeholder="e.g. JWT Refresh"
                  value={authFuncName}
                  onChange={(e) => setAuthFuncName(e.target.value)}
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-400">Description</label>
                <input
                  type="text"
                  placeholder="e.g. Acquires fresh access credentials"
                  value={authFuncDesc}
                  onChange={(e) => setAuthFuncDesc(e.target.value)}
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-400">Expires In (secs)</label>
                <input
                  type="number"
                  placeholder="e.g. 3600 (optional)"
                  value={authFuncExpiresIn}
                  onChange={(e) => setAuthFuncExpiresIn(e.target.value)}
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                  min="0"
                />
              </div>
            </div>

            <div className="flex-grow flex flex-col space-y-1 overflow-hidden">
              <label className="text-[10px] uppercase font-bold text-slate-400">Sandbox Script (JS)</label>
              <div className="flex-grow border border-slate-800 rounded-xl overflow-hidden mt-1 bg-slate-950">
                <Editor
                  height="260px"
                  language="javascript"
                  theme="vs-dark"
                  value={authFuncScript}
                  onChange={(val) => setAuthFuncScript(val || "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 11,
                    lineNumbers: "on",
                    scrollbar: { vertical: "auto", horizontal: "hidden" }
                  }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => setShowAuthFuncModal(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-800 text-xs font-semibold text-slate-400 hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition font-bold"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
