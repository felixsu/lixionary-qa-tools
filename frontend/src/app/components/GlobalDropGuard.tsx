"use client";

import { useEffect } from "react";

// The main window disables Tauri's native drag-drop handler (src-tauri/src/lib.rs)
// so in-page HTML5 DnD works (API Explorer's collection tree, API Studio's node
// palette). The side effect: dropping a real OS file anywhere else falls through
// to the browser's default action, which renders the raw file in place of the
// app with no way back. This is a pure safety net — in-page DnD already calls
// preventDefault()/stopPropagation() on its own valid drops, so it never reaches
// these listeners.
export default function GlobalDropGuard() {
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  return null;
}
