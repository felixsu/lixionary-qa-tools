"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Calls onDismiss on any mousedown outside the ref'd element or on Escape.
 * Pass `enabled` (the popover's open state) so listeners only exist while
 * something is actually open — an open popover then "claims" Escape via
 * preventDefault, which later document-level handlers (Modal, the Web
 * Explorer Esc ladder) check to avoid also acting on the same keypress.
 */
export function useOutsideDismiss(ref: RefObject<HTMLElement | null>, onDismiss: () => void, enabled: boolean = true) {
  // Ref so the mount-scoped listeners never call a stale closure (synced
  // post-render in an effect — the lint forbids ref writes during render).
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!enabled) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onDismissRef.current();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onDismissRef.current();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
