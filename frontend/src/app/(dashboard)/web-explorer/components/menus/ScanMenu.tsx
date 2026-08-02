"use client";

import { useRef, useState } from "react";
import { ChevronDown, Loader2, ScanSearch } from "lucide-react";
import { useWebExplorer } from "../../../../context/WebExplorerContext";
import { useOutsideDismiss } from "../../hooks/useOutsideDismiss";

/** Scan button + scope dropdown (entire page vs inside the selected element). */
export default function ScanMenu() {
  const { pageScanStatus, isVerifying, isExploring, isRecording, selectedElement, handleScanPage } = useWebExplorer();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(menuRef, () => setOpen(false), open);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={pageScanStatus === "scanning" || isVerifying || isExploring || isRecording}
        title={isVerifying ? "Scan is disabled while verification is running" : isExploring ? "Scan is disabled while exploration is running" : isRecording ? "Scan is disabled while recording" : "Detect interactive elements and propose POM methods"}
        className="h-[34px] px-3.5 rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors border bg-transparent border-line text-graphite hover:bg-panel disabled:opacity-60"
      >
        {pageScanStatus === "scanning" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ScanSearch className="h-3.5 w-3.5" />
        )}
        {pageScanStatus === "scanning" ? "Scanning…" : "Scan"}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && pageScanStatus !== "scanning" && (
        <div className="absolute right-0 top-full mt-1 w-[260px] bg-cream border border-line rounded-xl shadow-[0_8px_24px_rgba(20,20,19,0.12)] z-50 overflow-hidden">
          <button
            onClick={() => { setOpen(false); handleScanPage("page"); }}
            className="w-full text-left px-3 py-2.5 text-xs text-ink hover:bg-panel transition-colors"
          >
            <span className="font-semibold block">Entire page</span>
            <span className="text-mute text-[11px]">All frames, including iframes</span>
          </button>
          <button
            onClick={() => { setOpen(false); handleScanPage("selected"); }}
            disabled={!selectedElement}
            className="w-full text-left px-3 py-2.5 text-xs text-ink hover:bg-panel transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-t border-line"
          >
            <span className="font-semibold block">Inside selected element</span>
            <span className="text-mute text-[11px]">
              {selectedElement
                ? <>Scan within &lt;{selectedElement.tagName}&gt; {String(selectedElement.text || "").slice(0, 30)}</>
                : "Inspect & click a parent element first"}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
