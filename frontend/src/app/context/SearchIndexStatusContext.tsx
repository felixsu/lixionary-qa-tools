"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";

const LOCAL_API_URL = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:8484';

const POLL_INTERVAL_MS = 5_000;

interface SearchIndexStatusContextType {
  state: "idle" | "indexing";
  pendingCollections: number;
  pendingRequestIds: Set<string>;
  refresh: () => void;
}

const SearchIndexStatusContext = createContext<SearchIndexStatusContextType | undefined>(undefined);

// Polls the sidecar's local request-search index (name/endpoint/description)
// so the API Explorer sidebar can show an "Indexing…" state while background
// embedding computation for changed descriptions is still catching up.
export function SearchIndexStatusProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"idle" | "indexing">("idle");
  const [pendingCollections, setPendingCollections] = useState(0);
  const [pendingRequestIds, setPendingRequestIds] = useState<Set<string>>(new Set());
  const inFlightRef = useRef(false);

  const refresh = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch(`${LOCAL_API_URL}/api/local-store/search/status`);
      if (!res.ok) return;
      const data = await res.json();
      setState(data.state === "indexing" ? "indexing" : "idle");
      setPendingCollections(data.pendingCollections || 0);
      setPendingRequestIds(new Set(data.pendingRequestIds || []));
    } catch {
      // Sidecar unreachable — leave last-known status in place rather than
      // flip to a misleading state; BackendStatusContext already surfaces
      // sidecar connectivity issues elsewhere.
    } finally {
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    const handleVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, []);

  return (
    <SearchIndexStatusContext.Provider value={{ state, pendingCollections, pendingRequestIds, refresh }}>
      {children}
    </SearchIndexStatusContext.Provider>
  );
}

export function useSearchIndexStatus(): SearchIndexStatusContextType {
  const ctx = useContext(SearchIndexStatusContext);
  if (!ctx) throw new Error("useSearchIndexStatus must be used within a SearchIndexStatusProvider");
  return ctx;
}
