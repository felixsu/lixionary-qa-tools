"use client";

import { useEffect, useRef } from "react";
import { useWebExplorer } from "../../../context/WebExplorerContext";

/**
 * Web Explorer's Escape ladder — one document-level handler, first match wins:
 * inspect mode / InspectorCard → scan review drawer or scan error → finished
 * explore log. Yields to whoever claimed the keypress first: components that
 * consume Escape (open menus/popovers via useOutsideDismiss, Dropdown, Modal)
 * mark it with preventDefault, and an open Modal is also detected via its
 * [data-modal-root] backdrop because its listener registers after this one.
 * Monaco is skipped — it uses Escape itself (autocomplete, find widget).
 */
export function useEscapeActions({ dismissInspectorCard }: { dismissInspectorCard: () => void }) {
  const {
    inspectMode,
    handleToggleInspect,
    selectedElement,
    pageScanResults,
    pageScanError,
    resetPageScan,
    isExploring,
    exploreSteps,
    setExploreSteps,
  } = useWebExplorer();

  // Latest values behind a ref so the mount-scoped listener never acts on a
  // stale closure (synced post-render — the lint forbids ref writes in render).
  const stateRef = useRef({
    inspectMode, handleToggleInspect, selectedElement, pageScanResults,
    pageScanError, resetPageScan, isExploring, exploreSteps, setExploreSteps,
    dismissInspectorCard,
  });
  useEffect(() => {
    stateRef.current = {
      inspectMode, handleToggleInspect, selectedElement, pageScanResults,
      pageScanError, resetPageScan, isExploring, exploreSteps, setExploreSteps,
      dismissInspectorCard,
    };
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[data-modal-root]")) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(".monaco-editor")) return;

      const s = stateRef.current;
      if (s.inspectMode || s.selectedElement) {
        e.preventDefault();
        if (s.inspectMode) s.handleToggleInspect();
        if (s.selectedElement) s.dismissInspectorCard();
      } else if (s.pageScanResults || s.pageScanError) {
        e.preventDefault();
        s.resetPageScan();
      } else if (!s.isExploring && s.exploreSteps.length > 0) {
        e.preventDefault();
        s.setExploreSteps([]);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
}
