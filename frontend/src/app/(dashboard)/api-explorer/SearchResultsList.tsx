"use client";

import React, { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Collection, findRequestInTree, findAncestorPathToRequest, findCollectionInTree } from "../../context/AppContext";
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

interface ResolvedHit {
  collectionLocalId: string;
  requestId: string;
  name: string;
  method: string;
  path: string[];
  indexing: boolean;
}

interface SearchResultsListProps {
  query: string;
  collections: Collection[];
  onSelectRequest: (collectionLocalId: string, requestId: string) => void;
}

// Debounces the raw query, fetches the sidecar's local ranked search endpoint,
// then resolves each thin {collectionLocalId, requestId} hit against the tree
// already held in AppContext — no second round trip for request details.
export default function SearchResultsList({ query, collections, onSelectRequest }: SearchResultsListProps) {
  const { pendingRequestIds } = useSearchIndexStatus();
  const [results, setResults] = useState<ResolvedHit[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const seq = ++requestSeqRef.current;
      try {
        const res = await fetch(`${LOCAL_API_URL}/api/local-store/search/requests?q=${encodeURIComponent(trimmed)}&limit=20`);
        if (seq !== requestSeqRef.current) return; // a newer query already superseded this one
        const hits: SearchHit[] = res.ok ? await res.json() : [];

        const resolved: ResolvedHit[] = [];
        for (const hit of hits) {
          const root = collections.find(c => c.id === hit.collectionLocalId);
          if (!root) continue;
          const req = findRequestInTree(root, hit.requestId);
          if (!req) continue;
          const idPath = findAncestorPathToRequest(root, hit.requestId) || [root.id];
          const path = idPath.map(id => findCollectionInTree(root, id)?.name || "?");
          resolved.push({
            collectionLocalId: hit.collectionLocalId,
            requestId: hit.requestId,
            name: req.name,
            method: req.method,
            path,
            indexing: pendingRequestIds.has(hit.requestId),
          });
        }
        setResults(resolved);
      } catch {
        if (seq === requestSeqRef.current) setResults([]);
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, collections]);

  if (query.trim().length < 2) {
    return (
      <p className="text-xs text-mute text-center px-4 py-8 leading-relaxed">
        Keep typing to search by name, endpoint, or description…
      </p>
    );
  }

  if (loading && results.length === 0) {
    return (
      <p className="text-xs text-mute text-center px-4 py-8 leading-relaxed">
        Searching…
      </p>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8">
        <Search className="h-4 w-4 text-mute" />
        <p className="text-xs text-mute text-center leading-relaxed">
          No matching requests.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {results.map((hit) => (
        <div
          key={hit.requestId}
          onClick={() => onSelectRequest(hit.collectionLocalId, hit.requestId)}
          className="flex flex-col gap-0.5 px-2.5 py-1.5 rounded-md cursor-pointer hover:bg-hover transition-colors"
        >
          <div className="flex items-center gap-2">
            <span
              className="font-mono text-[9px] font-medium px-1.5 py-0.5 rounded flex-shrink-0"
              style={methodStyle(hit.method)}
            >
              {hit.method}
            </span>
            <span className="flex-1 text-[13px] font-medium text-ink truncate">{hit.name}</span>
            {hit.indexing && (
              <span title="Still indexing this request's description" className="h-1.5 w-1.5 rounded-full bg-clay flex-shrink-0" />
            )}
          </div>
          <span className="text-[10px] text-mute truncate pl-[38px]">{hit.path.join(" / ")}</span>
        </div>
      ))}
    </div>
  );
}
