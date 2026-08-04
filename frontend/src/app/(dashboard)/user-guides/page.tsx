"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Layers, ChevronRight, ChevronDown, Search } from "lucide-react";
import { useAppContext } from "../../context/AppContext";
import {
  buildGuideTree,
  flattenGuideTree,
  GuideTreeNode,
  getAncestorIds,
  isVisibleUnderExpansion,
  filterGuidesByQuery,
} from "../../utils/guideTree";

export default function UserGuidesPage() {
  const { user, userGuides } = useAppContext();
  // Empty set = everything collapsed; only roots are visible by default.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const tree = useMemo(() => buildGuideTree(userGuides), [userGuides]);
  const rows = useMemo(() => flattenGuideTree(tree), [tree]);
  const nodeById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const searching = query.trim().length >= 1;
  const visibleRows = searching
    ? filterGuidesByQuery(rows, query)
    : rows.filter((row) => isVisibleUnderExpansion(row, nodeById, expandedIds));

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const ancestorPath = (row: GuideTreeNode): string =>
    getAncestorIds(row.id, nodeById)
      .map((id) => nodeById.get(id)!.title)
      .reverse()
      .join(" › ");

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6">
        {userGuides.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <BookOpen className="h-8 w-8 text-mute" />
            <div className="text-base font-medium text-graphite">No user guides yet</div>
            <div className="text-[13px] text-mute max-w-sm leading-relaxed">
              {user?.role === "admin"
                ? "Create the first guide from the User guide studio under Administration."
                : "Ask an administrator to publish guides for the modules you use."}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 max-w-3xl">
            <div className="relative mb-2">
              <Search className="h-3.5 w-3.5 text-mute absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search guides…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full h-[30px] bg-cream border border-line rounded-md pl-8 pr-2.5 text-xs text-graphite outline-none focus:border-clay"
              />
            </div>
            {searching && visibleRows.length === 0 && (
              <div className="py-10 text-center text-[13px] text-mute">
                No guides match &ldquo;{query.trim()}&rdquo;.
              </div>
            )}
            {visibleRows.map((row) => {
              const path = searching ? ancestorPath(row) : "";
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-1"
                  style={{ marginLeft: searching ? 0 : (row.depth - 1) * 24 }}
                >
                  {!searching && (
                    <button
                      onClick={() => toggleExpanded(row.id)}
                      disabled={row.children.length === 0}
                      className="h-6 w-6 flex items-center justify-center flex-shrink-0 rounded-md hover:bg-hover transition-colors disabled:opacity-0 disabled:pointer-events-none"
                      title={expandedIds.has(row.id) ? "Collapse" : "Expand"}
                    >
                      {expandedIds.has(row.id) ? (
                        <ChevronDown className="h-3.5 w-3.5 text-graphite" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-graphite" />
                      )}
                    </button>
                  )}
                  <Link
                    href={`/user-guides/detail?id=${row.id}`}
                    className="group flex-1 min-w-0 bg-cream border border-line rounded-xl px-4 py-3 flex items-center gap-3 hover:border-clay/50 hover:bg-panel/40 transition-colors"
                  >
                    <div className="h-8 w-8 rounded-lg bg-panel border border-line flex items-center justify-center flex-shrink-0">
                      <BookOpen className="h-3.5 w-3.5 text-clay" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {path && <div className="text-[11px] text-mute truncate">{path}</div>}
                      <div className="font-serif text-base font-medium text-ink truncate">{row.title}</div>
                      <div className="flex items-center gap-1.5 text-[11px] text-mute mt-0.5 min-w-0">
                        <span className="truncate">{row.description || "No description provided."}</span>
                        <span className="flex items-center gap-1 flex-shrink-0">
                          · <Layers className="h-3 w-3" />
                          {row.blockCount} {row.blockCount === 1 ? "section" : "sections"}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-mute group-hover:text-clay transition-colors flex-shrink-0" />
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
