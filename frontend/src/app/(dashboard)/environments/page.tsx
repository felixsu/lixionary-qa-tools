"use client";

import React, { useState } from "react";
import { Plus, Trash2, Pencil, Copy, X, Check } from "lucide-react";
import { useAppContext, Environment } from "../../context/AppContext";
import { useToast } from "../../context/ToastContext";
import { confirmDialog } from "../../utils/confirmDialog";

export default function EnvironmentsPage() {
  const {
    environments,
    selectedEnvId,
    setSelectedEnvId,
    handleSaveEnv,
    handleDeleteEnv,
    handleDuplicateEnv,
  } = useAppContext();
  const { showToast } = useToast();

  const [showEnvModal, setShowEnvModal] = useState(false);
  const [envModalName, setEnvModalName] = useState("");
  const [envModalVariables, setEnvModalVariables] = useState<
    { key: string; value: string; isSecret: boolean }[]
  >([{ key: "", value: "", isSecret: false }]);
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
    setEnvModalVariables(
      env.variables.length ? env.variables : [{ key: "", value: "", isSecret: false }]
    );
    setShowEnvModal(true);
  };

  const onSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!envModalName) return;
    const vars = envModalVariables.filter((v) => v.key !== "");
    try {
      await handleSaveEnv(envModalName, vars, editingEnvId);
      setShowEnvModal(false);
    } catch (err: any) {
      showToast(err.message, { type: "error" });
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Action bar */}
      <div className="h-14 flex items-center justify-end px-6 border-b border-line flex-shrink-0">
        <button
          onClick={openEnvCreate}
          className="h-[38px] px-4 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white flex items-center gap-2 transition-colors"
        >
          <Plus className="h-4 w-4" /> Create environment
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {environments.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <div className="text-base font-medium text-graphite">No environments yet</div>
            <div className="text-[13px] text-mute max-w-sm leading-relaxed">
              Create an environment to manage base URLs, tokens, and variables substituted into your requests.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 content-start">
            {environments.map((env) => {
              const isActive = env.id === selectedEnvId;
              return (
                <div key={env.id} className="bg-cream border border-line rounded-xl overflow-hidden flex flex-col">
                  <div className="px-5 py-4 flex items-center gap-2">
                    <button
                      onClick={() => setSelectedEnvId(env.id)}
                      className="flex-1 text-left text-sm font-medium text-ink truncate hover:text-clay transition-colors"
                      title="Set as active environment"
                    >
                      {env.name}
                    </button>
                    {isActive && (
                      <span
                        className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                        style={{ background: "#e3f5e9", color: "#276749" }}
                      >
                        Active
                      </span>
                    )}
                    <button
                      onClick={() => openEnvEdit(env)}
                      className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-panel transition-colors"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5 text-graphite" />
                    </button>
                    <button
                      onClick={() => handleDuplicateEnv(env)}
                      className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-panel transition-colors"
                      title="Duplicate"
                    >
                      <Copy className="h-3.5 w-3.5 text-graphite" />
                    </button>
                    <button
                      onClick={async () => {
                        if (await confirmDialog("Delete this environment?")) await handleDeleteEnv(env.id);
                      }}
                      className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-danger-soft hover:text-danger transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-graphite" />
                    </button>
                  </div>

                  <div className="border-t border-line px-5 pt-2 pb-3 flex flex-col">
                    {env.variables.length ? (
                      env.variables.map((v, idx) => (
                        <div
                          key={idx}
                          className="flex items-baseline gap-3 py-1.5 border-b border-line-soft last:border-0"
                        >
                          <span className="font-mono text-[11px] text-clay min-w-[96px] flex-shrink-0 truncate">
                            {v.key}
                          </span>
                          <span
                            className="font-mono text-[11px] text-stone flex-1 truncate"
                            title={v.isSecret ? "secret" : v.value}
                          >
                            {v.isSecret ? "••••••••" : v.value}
                          </span>
                        </div>
                      ))
                    ) : (
                      <span className="text-[11px] text-mute italic py-1.5">No variables defined.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showEnvModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(20,20,19,0.5)", backdropFilter: "blur(2px)" }}
        >
          <form
            onSubmit={onSaveSubmit}
            className="bg-cream rounded-2xl p-8 w-[560px] max-h-[85vh] overflow-y-auto shadow-[0_24px_48px_-12px_rgba(20,20,19,0.18)] flex flex-col gap-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="m-0 font-serif text-xl font-medium text-ink">
                {editingEnvId ? "Edit environment" : "Create environment"}
              </h2>
              <button
                type="button"
                onClick={() => setShowEnvModal(false)}
                className="h-8 w-8 rounded-lg border border-line flex items-center justify-center hover:bg-panel transition-colors"
              >
                <X className="h-4 w-4 text-graphite" />
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Name</label>
              <input
                type="text"
                placeholder="e.g. Production"
                value={envModalName}
                onChange={(e) => setEnvModalName(e.target.value)}
                required
                autoFocus
                className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[13px] font-medium text-graphite">Variables</label>
              <div className="flex gap-1.5 items-center">
                <span className="w-[120px] text-[10px] font-semibold uppercase tracking-[0.06em] text-mute">Key</span>
                <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-mute">Value</span>
                <span className="w-14 text-[10px] font-semibold uppercase tracking-[0.06em] text-mute text-center">Secret</span>
                <span className="w-[26px]" />
              </div>

              {envModalVariables.map((v, idx) => (
                <div key={idx} className="flex gap-1.5 items-center">
                  <input
                    type="text"
                    placeholder="KEY"
                    value={v.key}
                    onChange={(e) => {
                      const next = [...envModalVariables];
                      next[idx].key = e.target.value;
                      setEnvModalVariables(next);
                    }}
                    className="w-[120px] h-[34px] bg-cream border border-line rounded-md px-2.5 font-mono text-xs text-ink outline-none focus:border-clay"
                  />
                  <input
                    type="text"
                    placeholder="Value"
                    value={v.value}
                    onChange={(e) => {
                      const next = [...envModalVariables];
                      next[idx].value = e.target.value;
                      setEnvModalVariables(next);
                    }}
                    className="flex-1 h-[34px] bg-cream border border-line rounded-md px-2.5 font-mono text-xs text-ink outline-none focus:border-clay"
                  />
                  <div className="w-14 flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={v.isSecret}
                      onChange={(e) => {
                        const next = [...envModalVariables];
                        next[idx].isSecret = e.target.checked;
                        setEnvModalVariables(next);
                      }}
                      className="h-4 w-4 cursor-pointer"
                      style={{ accentColor: "#cc785c" }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setEnvModalVariables(envModalVariables.filter((_, i) => i !== idx))}
                    className="h-[26px] w-[26px] flex-shrink-0 rounded-md border border-line flex items-center justify-center hover:bg-danger-soft hover:text-danger transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-graphite" />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setEnvModalVariables([...envModalVariables, { key: "", value: "", isSecret: false }])}
                className="flex items-center gap-1.5 px-2.5 py-1.5 w-fit border border-dashed border-line rounded-md text-xs text-mute hover:border-clay hover:text-clay transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Add variable
              </button>
            </div>

            <div className="flex justify-end gap-2 pt-1 border-t border-line">
              <button
                type="button"
                onClick={() => setShowEnvModal(false)}
                className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white flex items-center gap-2 transition-colors"
              >
                <Check className="h-4 w-4" /> Save environment
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
