"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { Collection, RequestItem, findRequestInTree, findAncestorPathToRequest, findCollectionInTree } from "../../context/AppContext";
import { useSearchIndexStatus } from "../../context/SearchIndexStatusContext";

const LOCAL_API_URL = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:8484';

const METHOD_STYLE: Record<string, React.CSSProperties> = {
  GET: { background: "#e3f5e9", color: "#276749" },
  POST: { background: "#e3ecff", color: "#1a4db5" },
  PUT: { background: "#fff3e0", color: "#9a5c00" },
  DELETE: { background: "#fde8e8", color: "#c64545" },
  PATCH: { background: "#f3e8ff", color: "#6d28d9" },
};
const methodStyle = (m: string): React.CSSProperties => METHOD_STYLE[m] || { background: "#f0f0ee", color: "#6c6a64" };

interface SearchHit {
  collectionLocalId: string;
  requestId: string;
  score: number;
  matchedFields: string[];
}

interface Row {
  requestId: string;
  collectionLocalId: string;
  name: string;
  method: string;
  path: string[];
}

function flattenRequestsWithPath(collections: Collection[]): Row[] {
  const rows: Row[] = [];
  const walk = (node: Collection, collectionLocalId: string, trail: string[]) => {
    for (const req of node.requests || []) {
      rows.push({ requestId: req.id, collectionLocalId, name: req.name, method: req.method, path: trail });
    }
    for (const child of node.children || []) {
      walk(child, collectionLocalId, [...trail, child.name]);
    }
  };
  for (const col of collections) walk(col, col.id, [col.name]);
  return rows;
}

const TRIGGER_BASE =
  "flex items-center justify-between gap-2 bg-cream border border-line outline-none cursor-pointer transition-colors hover:bg-panel focus:border-clay disabled:opacity-50 disabled:cursor-not-allowed";
const TRIGGER_SIZE_DEFAULT = "h-[38px] px-3.5 rounded-lg text-[13px] text-ink w-full";

interface RequestPickerProps {
  value: string;
  onChange: (requestId: string) => void;
  collections: Collection[];
  placeholder?: string;
}

export default function RequestPicker({ value, onChange, collections, placeholder = "Select a request…" }: RequestPickerProps) {
  const { state: indexState, pendingRequestIds } = useSearchIndexStatus();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Row[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);

  const allRows = useMemo(() => flattenRequestsWithPath(collections), [collections]);

  const selectedRequest: RequestItem | null = useMemo(() => {
    if (!value) return null;
    for (const col of collections) {
      const found = findRequestInTree(col, value);
      if (found) return found;
    }
    return null;
  }, [collections, value]);

  const rows = query.trim().length >= 2 ? searchResults : allRows;

  useEffect(() => {
    const trimmed = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (trimmed.length < 2) {
      setSearchResults(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const seq = ++requestSeqRef.current;
      try {
        const res = await fetch(`${LOCAL_API_URL}/api/local-store/search/requests?q=${encodeURIComponent(trimmed)}&limit=20`);
        if (seq !== requestSeqRef.current) return;
        const hits: SearchHit[] = res.ok ? await res.json() : [];

        const resolved: Row[] = [];
        for (const hit of hits) {
          const root = collections.find(c => c.id === hit.collectionLocalId);
          if (!root) continue;
          const req = findRequestInTree(root, hit.requestId);
          if (!req) continue;
          const idPath = findAncestorPathToRequest(root, hit.requestId) || [root.id];
          const path = idPath.map(id => findCollectionInTree(root, id)?.name || "?");
          resolved.push({ requestId: req.id, collectionLocalId: hit.collectionLocalId, name: req.name, method: req.method, path });
        }
        setSearchResults(resolved);
      } catch {
        if (seq === requestSeqRef.current) setSearchResults([]);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, collections]);

  const updateCoords = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 4, left: r.left, width: r.width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
    inputRef.current?.focus();
    setActiveIdx(0);
    const handle = () => updateCoords();
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setSearchResults(null);
    triggerRef.current?.focus();
  };

  const commit = (row: Row) => {
    onChange(row.requestId);
    close();
  };

  // Stop keys from reaching react-flow's document-level shortcuts (e.g.
  // Backspace/Delete removing the selected node) while typing a search query.
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const list = rows || [];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (list[activeIdx]) commit(list[activeIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className={`${TRIGGER_BASE} ${TRIGGER_SIZE_DEFAULT}`}
      >
        {selectedRequest ? (
          <span className="flex items-center gap-2 truncate">
            <span className="font-mono text-[9px] font-medium px-1.5 py-0.5 rounded flex-shrink-0" style={methodStyle(selectedRequest.method)}>
              {selectedRequest.method}
            </span>
            <span className="truncate">{selectedRequest.name}</span>
          </span>
        ) : value ? (
          <span className="truncate text-danger">Request not found</span>
        ) : (
          <span className="truncate text-mute">{placeholder}</span>
        )}
        <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 text-stone transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && coords &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, width: Math.max(coords.width, 320) }}
            className="z-[100] rounded-lg border border-line bg-cream shadow-lg shadow-ink/5 animate-[fadeUp_0.12s_ease-out] overflow-hidden"
          >
            <div className="p-2 border-b border-line">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search name, endpoint, description…"
                className="w-full h-[30px] bg-panel border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay"
              />
              {indexState === "indexing" && (
                <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-mute">
                  <span className="h-1.5 w-1.5 rounded-full bg-clay animate-pulse" />
                  Indexing requests…
                </div>
              )}
            </div>

            <div className="max-h-72 overflow-y-auto p-1">
              {rows === null ? (
                <p className="text-xs text-mute text-center px-4 py-6">Searching…</p>
              ) : rows.length === 0 ? (
                <p className="text-xs text-mute text-center px-4 py-6">No matching requests.</p>
              ) : (
                rows.map((row, idx) => (
                  <div
                    key={row.requestId}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => commit(row)}
                    className={`flex flex-col gap-0.5 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors ${idx === activeIdx ? "bg-hover" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[9px] font-medium px-1.5 py-0.5 rounded flex-shrink-0" style={methodStyle(row.method)}>
                        {row.method}
                      </span>
                      <span className="flex-1 text-[13px] font-medium text-ink truncate">{row.name}</span>
                      {pendingRequestIds.has(row.requestId) && (
                        <span title="Still indexing this request's description" className="h-1.5 w-1.5 rounded-full bg-clay flex-shrink-0" />
                      )}
                    </div>
                    <span className="text-[10px] text-mute truncate pl-[30px]">{row.path.join(" / ")}</span>
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
