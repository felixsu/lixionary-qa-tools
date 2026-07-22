"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Shield,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  FileText,
  GitBranch,
  Save,
  Eye,
} from "lucide-react";
import { useAppContext, UserGuideSummary } from "../../context/AppContext";
import { useToast } from "../../context/ToastContext";
import GuideBlockRenderer from "../../components/guide/GuideBlockRenderer";
import { confirmDialog } from "../../utils/confirmDialog";

type DraftBlock = { key: string; type: "markdown" | "mermaid"; content: string };

interface Draft {
  id: string | null;
  title: string;
  description: string;
  blocks: DraftBlock[];
}

const MERMAID_TEMPLATE = `flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do the thing]
    B -->|No| D[Skip it]`;

export default function UserGuideAdminPage() {
  const { user, apiCall, userGuides, fetchUserGuides } = useAppContext();
  const { showToast } = useToast();
  const router = useRouter();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loadingGuideId, setLoadingGuideId] = useState<string | null>(null);

  // Auth guard page level
  if (user?.role !== "admin") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-cream text-ink px-6">
        <div className="text-center max-w-md p-8 border border-line bg-panel rounded-2xl shadow-sm">
          <Shield className="h-12 w-12 text-clay mx-auto mb-4" />
          <h2 className="text-xl font-bold text-ink mb-2">Access Denied</h2>
          <p className="text-sm text-stone mb-6">
            You require administrator privileges to manage user guides.
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

  const openCreate = () => {
    setDraft({ id: null, title: "", description: "", blocks: [] });
  };

  const openEdit = async (guide: UserGuideSummary) => {
    setLoadingGuideId(guide.id);
    try {
      const full = await apiCall(`/api/user-guides/${guide.id}`);
      setDraft({
        id: full.id,
        title: full.title,
        description: full.description || "",
        blocks: (full.blocks || []).map((b: { type: "markdown" | "mermaid"; content: string }) => ({
          key: crypto.randomUUID(),
          type: b.type,
          content: b.content,
        })),
      });
    } catch (e: any) {
      showToast(e.message || "Failed to load guide.", { type: "error" });
    } finally {
      setLoadingGuideId(null);
    }
  };

  const handleDelete = async (guide: UserGuideSummary) => {
    if (!(await confirmDialog(`Delete the guide "${guide.title}"? This cannot be undone.`))) return;
    try {
      await apiCall(`/api/admin/user-guides/${guide.id}`, { method: "DELETE" });
      await fetchUserGuides();
    } catch (e: any) {
      showToast(e.message || "Failed to delete guide.", { type: "error" });
    }
  };

  const handleSave = async () => {
    if (!draft || !draft.title.trim()) return;
    setIsSaving(true);
    try {
      const payload = {
        title: draft.title,
        description: draft.description,
        blocks: draft.blocks.map(({ type, content }) => ({ type, content })),
      };
      if (draft.id) {
        await apiCall(`/api/admin/user-guides/${draft.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await apiCall("/api/admin/user-guides", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      await fetchUserGuides();
      setDraft(null);
    } catch (e: any) {
      showToast(e.message || "Failed to save guide.", { type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  const addBlock = (type: "markdown" | "mermaid") => {
    if (!draft) return;
    setDraft({
      ...draft,
      blocks: [
        ...draft.blocks,
        { key: crypto.randomUUID(), type, content: type === "mermaid" ? MERMAID_TEMPLATE : "" },
      ],
    });
  };

  const updateBlock = (key: string, content: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      blocks: draft.blocks.map((b) => (b.key === key ? { ...b, content } : b)),
    });
  };

  const removeBlock = (key: string) => {
    if (!draft) return;
    setDraft({ ...draft, blocks: draft.blocks.filter((b) => b.key !== key) });
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    if (!draft) return;
    const target = index + direction;
    if (target < 0 || target >= draft.blocks.length) return;
    const blocks = [...draft.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    setDraft({ ...draft, blocks });
  };

  // ---------- List mode ----------
  if (!draft) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-cream animate-[fadeUp_0.3s_ease-out]">
        <div className="h-14 flex items-center justify-between px-6 border-b border-line flex-shrink-0 bg-cream">
          <h3 className="text-xs font-bold uppercase tracking-wider text-stone">Published guides</h3>
          <button
            onClick={openCreate}
            className="h-[38px] px-4 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white flex items-center gap-2 transition-colors"
          >
            <Plus className="h-4 w-4" /> Create guide
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {userGuides.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <div className="text-base font-medium text-graphite">No user guides yet</div>
              <div className="text-[13px] text-mute max-w-sm leading-relaxed">
                Create per-module guides combining markdown text and mermaid diagrams. They appear
                for every user under Configuration → User guide.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 content-start">
              {userGuides.map((guide) => (
                <div key={guide.id} className="bg-cream border border-line rounded-xl px-5 py-4 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink mb-1 truncate">{guide.title}</div>
                    <div className="text-xs text-stone leading-relaxed">
                      {guide.description || "No description provided."}
                    </div>
                    <div className="text-[11px] text-mute mt-2">
                      {guide.blockCount} {guide.blockCount === 1 ? "block" : "blocks"}
                      {guide.updatedAt && <> · updated {new Date(guide.updatedAt).toLocaleDateString()}</>}
                    </div>
                  </div>
                  <button
                    onClick={() => openEdit(guide)}
                    disabled={loadingGuideId === guide.id}
                    className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-panel transition-colors flex-shrink-0 disabled:opacity-50"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5 text-graphite" />
                  </button>
                  <button
                    onClick={() => handleDelete(guide)}
                    className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-danger-soft hover:text-danger transition-colors flex-shrink-0"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-graphite" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- Editor mode ----------
  return (
    <div className="h-full flex flex-col overflow-hidden bg-cream animate-[fadeUp_0.3s_ease-out]">
      <div className="h-14 flex items-center justify-between px-6 border-b border-line flex-shrink-0 bg-cream">
        <button
          onClick={() => setDraft(null)}
          className="flex items-center gap-1.5 text-[13px] text-stone hover:text-clay transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All guides
        </button>
        <button
          onClick={handleSave}
          disabled={!draft.title.trim() || isSaving}
          className="h-[38px] px-4 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="h-4 w-4" /> {isSaving ? "Saving…" : draft.id ? "Save changes" : "Create guide"}
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Edit pane */}
        <div className="flex-1 overflow-y-auto border-r border-line p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-graphite">Guide title</label>
            <input
              type="text"
              placeholder="e.g. API Explorer basics"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="h-[38px] px-3 bg-cream border border-line rounded-lg text-sm text-ink outline-none transition-all focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-graphite">Description</label>
            <input
              type="text"
              placeholder="Short summary shown on the guide index"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="h-[38px] px-3 bg-cream border border-line rounded-lg text-sm text-ink outline-none transition-all focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
            />
          </div>

          {draft.blocks.map((block, i) => (
            <div key={block.key} className="border border-line rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-panel border-b border-line">
                {block.type === "mermaid" ? (
                  <GitBranch className="h-3.5 w-3.5 text-clay" />
                ) : (
                  <FileText className="h-3.5 w-3.5 text-clay" />
                )}
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone">
                  {block.type === "mermaid" ? "Mermaid diagram" : "Markdown"}
                </span>
                <span className="text-[11px] text-mute">Block {i + 1}</span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => moveBlock(i, -1)}
                    disabled={i === 0}
                    className="h-6 w-6 rounded-md border border-line flex items-center justify-center hover:bg-hover transition-colors disabled:opacity-30"
                    title="Move up"
                  >
                    <ChevronUp className="h-3.5 w-3.5 text-graphite" />
                  </button>
                  <button
                    onClick={() => moveBlock(i, 1)}
                    disabled={i === draft.blocks.length - 1}
                    className="h-6 w-6 rounded-md border border-line flex items-center justify-center hover:bg-hover transition-colors disabled:opacity-30"
                    title="Move down"
                  >
                    <ChevronDown className="h-3.5 w-3.5 text-graphite" />
                  </button>
                  <button
                    onClick={() => removeBlock(block.key)}
                    className="h-6 w-6 rounded-md border border-line flex items-center justify-center hover:bg-danger-soft hover:text-danger transition-colors"
                    title="Remove block"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-graphite" />
                  </button>
                </div>
              </div>
              <textarea
                value={block.content}
                onChange={(e) => updateBlock(block.key, e.target.value)}
                placeholder={
                  block.type === "mermaid"
                    ? "flowchart TD\n    A --> B"
                    : "# Heading\n\nWrite markdown here…"
                }
                rows={10}
                spellCheck={false}
                className="w-full p-3 bg-cream font-mono text-xs leading-relaxed text-ink outline-none resize-y"
              />
            </div>
          ))}

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => addBlock("markdown")}
              className="h-[42px] border border-dashed border-line rounded-xl flex items-center justify-center gap-2 text-[13px] text-stone hover:text-clay hover:border-clay/50 hover:bg-panel/40 transition-colors"
            >
              <Plus className="h-4 w-4" /> Add markdown block
            </button>
            <button
              onClick={() => addBlock("mermaid")}
              className="h-[42px] border border-dashed border-line rounded-xl flex items-center justify-center gap-2 text-[13px] text-stone hover:text-clay hover:border-clay/50 hover:bg-panel/40 transition-colors"
            >
              <Plus className="h-4 w-4" /> Add mermaid block
            </button>
          </div>
        </div>

        {/* Preview pane */}
        <div className="flex-1 overflow-y-auto bg-panel/30">
          <div className="sticky top-0 z-10 flex items-center gap-2 px-6 py-2.5 bg-cream border-b border-line">
            <Eye className="h-3.5 w-3.5 text-stone" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone">Live preview</span>
          </div>
          <div className="mx-auto max-w-3xl px-6 py-6">
            <h1 className="m-0 mb-1 font-serif text-3xl font-medium text-ink">
              {draft.title || "Untitled guide"}
            </h1>
            {draft.description && (
              <p className="mt-1 text-sm text-stone leading-relaxed">{draft.description}</p>
            )}
            <div className="mt-4 pt-5 border-t border-line">
              <GuideBlockRenderer blocks={draft.blocks} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
