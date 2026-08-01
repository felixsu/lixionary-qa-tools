"use client";

import { X } from "lucide-react";
import { useWebExplorer } from "../../../../context/WebExplorerContext";

/** Dismissible toast when a page scan / exploration fails. */
export default function ScanErrorToast() {
  const { pageScanStatus, pageScanError, resetPageScan } = useWebExplorer();
  if (pageScanStatus !== "error") return null;
  return (
    <div className="absolute top-4 right-4 z-50 flex items-center gap-2 px-3 py-2 bg-panel border border-red-400/60 rounded-lg shadow-md text-xs">
      <span className="text-red-600 font-medium">Scan failed: {pageScanError}</span>
      <button
        onClick={resetPageScan}
        className="ml-1 h-4 w-4 flex items-center justify-center text-mute hover:text-ink transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
