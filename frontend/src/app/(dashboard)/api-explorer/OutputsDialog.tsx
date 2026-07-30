"use client";

import React, { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "../../components/Modal";

interface DraftOutput {
  name: string;
  description: string;
}

const inputCls =
  "bg-cream border border-line rounded-md px-2.5 font-mono text-xs text-graphite outline-none focus:border-clay";

// Two-column editor for a request's declared outputs. Edits a draft copy:
// only Save applies it back to the request — closing via X/Cancel discards.
export default function OutputsDialog({
  outputs,
  descriptions,
  initialSelected,
  onSave,
  onClose,
}: {
  outputs: string[];
  descriptions: Record<string, string>;
  initialSelected?: string;
  onSave: (outputs: string[], descriptions: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DraftOutput[]>(() =>
    outputs.map((name) => ({ name, description: descriptions[name] || "" }))
  );
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = initialSelected ? outputs.indexOf(initialSelected) : 0;
    return idx >= 0 ? idx : 0;
  });
  const [newName, setNewName] = useState("");

  const selected: DraftOutput | undefined = draft[selectedIndex];

  const nameCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of draft) {
      const key = o.name.trim();
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [draft]);

  const selectedName = selected?.name.trim() ?? "";
  const selectedEmpty = selected !== undefined && !selectedName;
  const selectedDuplicate = !!selectedName && nameCounts[selectedName] > 1;
  const hasInvalid = draft.some((o) => !o.name.trim() || nameCounts[o.name.trim()] > 1);

  const addOutput = () => {
    const name = newName.trim();
    if (!name || draft.some((o) => o.name.trim() === name)) return;
    setDraft([...draft, { name, description: "" }]);
    setSelectedIndex(draft.length);
    setNewName("");
  };

  const removeAt = (index: number) => {
    const next = draft.filter((_, i) => i !== index);
    setDraft(next);
    setSelectedIndex((prev) => Math.min(prev > index ? prev - 1 : prev, Math.max(next.length - 1, 0)));
  };

  const updateSelected = (patch: Partial<DraftOutput>) =>
    setDraft((prev) => prev.map((o, i) => (i === selectedIndex ? { ...o, ...patch } : o)));

  const handleSave = () => {
    if (hasInvalid) return;
    const names = draft.map((o) => o.name.trim());
    const descs: Record<string, string> = {};
    for (const o of draft) {
      if (o.description) descs[o.name.trim()] = o.description;
    }
    onSave(names, descs);
    onClose();
  };

  return (
    <Modal title="Declared outputs" onClose={onClose} width={640}>
      <div className="flex flex-col gap-4">
        <div className="flex gap-4">
          <div className="w-[220px] flex-shrink-0 flex flex-col gap-1 border border-line rounded-lg p-2 h-[300px] overflow-y-auto">
            {draft.length === 0 && (
              <div className="text-xs text-mute px-1.5 py-2">No outputs yet — add one below.</div>
            )}
            {draft.map((o, i) => (
              <div
                key={i}
                onClick={() => setSelectedIndex(i)}
                className={`group flex items-center gap-1.5 pl-2.5 pr-1 py-1.5 rounded-md cursor-pointer border transition-colors ${
                  i === selectedIndex ? "bg-panel border-line" : "border-transparent hover:bg-panel"
                }`}
              >
                <span className={`font-mono text-xs flex-1 truncate ${o.name.trim() ? "text-ink" : "text-danger italic"}`}>
                  {o.name.trim() || "(unnamed)"}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAt(i);
                  }}
                  title="Delete output"
                  className="h-6 w-6 rounded flex items-center justify-center text-stone opacity-0 group-hover:opacity-100 hover:bg-danger-soft hover:text-danger transition-all flex-shrink-0"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <input
              value={newName}
              placeholder="add output…"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                addOutput();
              }}
              className={`${inputCls} h-[30px] mt-auto flex-shrink-0`}
            />
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-3">
            {selected ? (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-stone">Variable name</label>
                  <input
                    value={selected.name}
                    placeholder="output name"
                    onChange={(e) => updateSelected({ name: e.target.value })}
                    className={`${inputCls} h-9 text-sm font-medium`}
                  />
                  {selectedEmpty && <span className="text-[11px] text-danger">Name is required.</span>}
                  {selectedDuplicate && (
                    <span className="text-[11px] text-danger">Another output already uses this name.</span>
                  )}
                </div>
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-stone">Description</label>
                  <textarea
                    value={selected.description}
                    placeholder="What this output holds and where it's used (optional)"
                    onChange={(e) => updateSelected({ description: e.target.value })}
                    className="flex-1 bg-cream border border-line rounded-md p-2.5 text-xs text-ink leading-relaxed outline-none focus:border-clay resize-none"
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-mute">
                Select an output on the left, or add one.
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1 border-t border-line">
          <button
            onClick={onClose}
            className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={hasInvalid}
            className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
