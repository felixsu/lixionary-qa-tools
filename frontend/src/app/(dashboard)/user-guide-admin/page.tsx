"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Shield,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  FileText,
  GitBranch,
  Save,
  Eye,
} from "lucide-react";
import { useAppContext, UserGuideSummary } from "../../context/AppContext";
import { useToast } from "../../context/ToastContext";
import GuideBlockRenderer from "../../components/guide/GuideBlockRenderer";
import Dropdown from "../../components/Dropdown";
import { confirmDialog } from "../../utils/confirmDialog";
import {
  buildGuideTree,
  flattenGuideTree,
  subtreeHeight,
  GuideTreeNode,
  MAX_GUIDE_DEPTH,
} from "../../utils/guideTree";

type DraftBlock = { key: string; type: "markdown" | "mermaid"; content: string };

interface Draft {
  id: string | null;
  title: string;
  description: string;
  parentId: string | null;
  slug: string;
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
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildGuideTree(userGuides), [userGuides]);
  const rows = useMemo(() => flattenGuideTree(tree), [tree]);
  const nodeById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const parentOptions = useMemo(() => {
    const editedNode = draft?.id ? nodeById.get(draft.id) : undefined;
    const height = editedNode ? subtreeHeight(editedNode) : 1;
    const candidates = flattenGuideTree(tree, draft?.id ?? undefined);
    return [
      { value: "", label: "None (top level)" },
      ...candidates.map((n) => ({
        value: n.id,
        label: `${"— ".repeat(n.depth - 1)}${n.title}`,
        disabled: n.depth + height > MAX_GUIDE_DEPTH,
      })),
    ];
  }, [tree, nodeById, draft]);

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
            onClick={() => router.replace("/home")}
            className="px-4 py-2 bg-clay hover:bg-clay-dark text-white rounded-lg text-sm font-medium transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  const openCreate = (parentId: string | null = null) => {
    setDraft({ id: null, title: "", description: "", parentId, slug: "", blocks: [] });
  };

  const openEdit = async (guide: UserGuideSummary) => {
    setLoadingGuideId(guide.id);
    try {
      const full = await apiCall(`/api/user-guides/${guide.id}`);
      setDraft({
        id: full.id,
        title: full.title,
        description: full.description || "",
        parentId: full.parentId || null,
        slug: full.slug || "",
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
        parentId: draft.parentId,
        slug: draft.slug.trim() || null,
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

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isHiddenByCollapse = (row: GuideTreeNode): boolean => {
    let parentId = row.parentId;
    while (parentId && nodeById.has(parentId)) {
      if (collapsedIds.has(parentId)) return true;
      parentId = nodeById.get(parentId)!.parentId;
    }
    return false;
  };

  // Orphaned parentIds are promoted to root by buildGuideTree, so their
  // siblings are the tree roots.
  const siblingsOf = (row: GuideTreeNode): GuideTreeNode[] =>
    row.parentId && nodeById.has(row.parentId) ? nodeById.get(row.parentId)!.children : tree;

  const handleReorder = async (guide: GuideTreeNode, direction: "up" | "down") => {
    try {
      await apiCall(`/api/admin/user-guides/${guide.id}/reorder`, {
        method: "POST",
        body: JSON.stringify({ direction }),
      });
      await fetchUserGuides();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to reorder guide.", { type: "error" });
    }
  };

  // ---------- List mode ----------
  if (!draft) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-cream animate-[fadeUp_0.3s_ease-out]">
        <div className="h-14 flex items-center justify-between px-6 border-b border-line flex-shrink-0 bg-cream">
          <h3 className="text-xs font-bold uppercase tracking-wider text-stone">Published guides</h3>
          <button
            onClick={() => openCreate()}
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
            <div className="flex flex-col gap-1.5 max-w-4xl">
              {rows.filter((row) => !isHiddenByCollapse(row)).map((row) => {
                const siblings = siblingsOf(row);
                const siblingIdx = siblings.findIndex((s) => s.id === row.id);
                return (
                  <div
                    key={row.id}
                    className="bg-cream border border-line rounded-xl px-4 py-3 flex items-center gap-2"
                    style={{ marginLeft: (row.depth - 1) * 24 }}
                  >
                    <button
                      onClick={() => toggleCollapsed(row.id)}
                      disabled={row.children.length === 0}
                      className="h-6 w-6 flex items-center justify-center flex-shrink-0 rounded-md hover:bg-hover transition-colors disabled:opacity-0 disabled:pointer-events-none"
                      title={collapsedIds.has(row.id) ? "Expand" : "Collapse"}
                    >
                      {collapsedIds.has(row.id) ? (
                        <ChevronRight className="h-3.5 w-3.5 text-graphite" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-graphite" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-sm font-medium text-ink truncate">{row.title}</span>
                        {row.slug && (
                          <span className="text-[10px] font-mono text-mute flex-shrink-0">#{row.slug}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-mute mt-0.5 truncate">
                        {row.description || "No description provided."}
                        {" · "}
                        {row.blockCount} {row.blockCount === 1 ? "block" : "blocks"}
                        {row.updatedAt && <> · updated {new Date(row.updatedAt).toLocaleDateString()}</>}
                      </div>
                    </div>
                    <button
                      onClick={() => handleReorder(row, "up")}
                      disabled={siblingIdx <= 0}
                      className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-panel transition-colors flex-shrink-0 disabled:opacity-30"
                      title="Move up"
                    >
                      <ChevronUp className="h-3.5 w-3.5 text-graphite" />
                    </button>
                    <button
                      onClick={() => handleReorder(row, "down")}
                      disabled={siblingIdx === siblings.length - 1}
                      className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-panel transition-colors flex-shrink-0 disabled:opacity-30"
                      title="Move down"
                    >
                      <ChevronDown className="h-3.5 w-3.5 text-graphite" />
                    </button>
                    <button
                      onClick={() => openCreate(row.id)}
                      disabled={row.depth >= MAX_GUIDE_DEPTH}
                      className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-panel transition-colors flex-shrink-0 disabled:opacity-30"
                      title={row.depth >= MAX_GUIDE_DEPTH ? `Maximum nesting depth is ${MAX_GUIDE_DEPTH} levels` : "Add sub-page"}
                    >
                      <CornerDownRight className="h-3.5 w-3.5 text-graphite" />
                    </button>
                    <button
                      onClick={() => openEdit(row)}
                      disabled={loadingGuideId === row.id}
                      className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-panel transition-colors flex-shrink-0 disabled:opacity-50"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5 text-graphite" />
                    </button>
                    <button
                      onClick={() => handleDelete(row)}
                      className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-danger-soft hover:text-danger transition-colors flex-shrink-0"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-graphite" />
                    </button>
                  </div>
                );
              })}
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
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Parent page</label>
              <Dropdown
                value={draft.parentId ?? ""}
                onChange={(value) => setDraft({ ...draft, parentId: value || null })}
                options={parentOptions}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Slug</label>
              <input
                type="text"
                placeholder="optional — used by in-app help links, e.g. api-studio-intro"
                value={draft.slug}
                onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                spellCheck={false}
                className="h-[38px] px-3 bg-cream border border-line rounded-lg font-mono text-xs text-ink outline-none transition-all focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
              />
            </div>
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
