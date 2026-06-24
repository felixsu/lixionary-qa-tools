"use client";

import React, { useState } from "react";
import { Plus, Trash } from "lucide-react";
import { useAppContext, Environment } from "../../context/AppContext";

export default function EnvironmentsPage() {
  const {
    environments,
    selectedEnvId,
    setSelectedEnvId,
    handleSaveEnv,
    handleDeleteEnv
  } = useAppContext();

  // Local modal states
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [envModalName, setEnvModalName] = useState("");
  const [envModalVariables, setEnvModalVariables] = useState<{ key: string; value: string; isSecret: boolean }[]>([
    { key: "", value: "", isSecret: false }
  ]);
  const [editingEnvId, setEditingEnvId] = useState<string | null>(null);

  const openEnvCreate = () => {
    setEditingEnvId(null);
    setEnvModalName("");
    setEnvModalVariables([{ key: "", value: "", isSecret: false }]);
    setShowEnvModal(true);
  };

  const openEnvEdit = (env: Environment) => {
    setEditingEnvId(env.id);
    setEnvModalName(env.name);
    setEnvModalVariables(env.variables.length ? env.variables : [{ key: "", value: "", isSecret: false }]);
    setShowEnvModal(true);
  };

  const onSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!envModalName) return;
    const vars = envModalVariables.filter(v => v.key !== "");
    try {
      await handleSaveEnv(envModalName, vars, editingEnvId);
      setShowEnvModal(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8 space-y-6">
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div>
          <h3 className="text-base font-bold text-slate-200">Variable Environments</h3>
          <p className="text-xs text-slate-500">Manage scopes for environment variables and base URLs substituted inside request parameters.</p>
        </div>
        <button
          onClick={openEnvCreate}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-xs px-3.5 py-2 rounded-lg font-bold transition-all shadow-md shadow-indigo-600/10 text-white"
        >
          <Plus className="h-4 w-4" />
          Create Environment
        </button>
      </div>

      {/* Environments grids */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {environments.map(env => (
          <div key={env.id} className="border border-slate-850 rounded-2xl bg-slate-900/40 p-5 space-y-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-850 pb-2.5">
                <span className="font-bold text-slate-200">{env.name}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => openEnvEdit(env)}
                    className="text-xs text-indigo-400 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm("Are you sure you want to delete this environment?")) {
                        await handleDeleteEnv(env.id);
                      }
                    }}
                    className="text-xs text-red-400 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Variables list */}
              <div className="mt-4 space-y-2 max-h-48 overflow-y-auto font-mono text-[11px] text-slate-400">
                {env.variables.length ? (
                  env.variables.map((v, idx) => (
                    <div key={idx} className="flex justify-between bg-slate-950/60 p-2 rounded border border-slate-900">
                      <span className="text-indigo-400 font-semibold truncate max-w-[120px]">{v.key}:</span>
                      <span className="text-slate-300 truncate max-w-[120px]" title={v.value}>
                        {v.isSecret ? "••••••••" : v.value}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-500 italic">No variables defined.</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* CREATE/EDIT ENVIRONMENT MODAL */}
      {showEnvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <form onSubmit={onSaveSubmit} className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-xl space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
              {editingEnvId ? "Edit Environment" : "Create New Environment"}
            </h3>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400">Environment Name</label>
              <input
                type="text"
                placeholder="e.g. Production, Staging"
                value={envModalName}
                onChange={(e) => setEnvModalName(e.target.value)}
                className="w-full mt-1.5 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                <span className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">Variables</span>
                <button
                  type="button"
                  onClick={() => setEnvModalVariables([...envModalVariables, { key: "", value: "", isSecret: false }])}
                  className="text-[10px] bg-slate-850 hover:bg-slate-800 px-2 py-0.5 rounded text-indigo-400 font-bold"
                >
                  Add Variable
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                {envModalVariables.map((v, idx) => (
                  <div key={idx} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="KEY (e.g. BASE_URL)"
                      value={v.key}
                      onChange={(e) => {
                        const newV = [...envModalVariables];
                        newV[idx].key = e.target.value;
                        setEnvModalVariables(newV);
                      }}
                      className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none"
                    />
                    <input
                      type="text"
                      placeholder="Value"
                      value={v.value}
                      onChange={(e) => {
                        const newV = [...envModalVariables];
                        newV[idx].value = e.target.value;
                        setEnvModalVariables(newV);
                      }}
                      className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none"
                    />
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={v.isSecret}
                        onChange={(e) => {
                          const newV = [...envModalVariables];
                          newV[idx].isSecret = e.target.checked;
                          setEnvModalVariables(newV);
                        }}
                        className="rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-0 focus:ring-offset-0 h-3.5 w-3.5"
                      />
                      <span className="text-[9px] text-slate-500 font-semibold uppercase">Secret</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setEnvModalVariables(envModalVariables.filter((_, i) => i !== idx))}
                      className="p-2 text-slate-500 hover:text-red-400"
                    >
                      <Trash className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowEnvModal(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-800 text-xs font-semibold text-slate-400 hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
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
