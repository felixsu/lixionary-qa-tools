"use client";

import { X } from "lucide-react";
import { useWebExplorer } from "../../../../context/WebExplorerContext";

/** Shown while an XPath anchor element is set. */
export default function AnchorBanner() {
  const { anchorElement, handleClearAnchor } = useWebExplorer();
  if (!anchorElement) return null;
  return (
    <div className="absolute top-4 right-4 z-50 flex items-center gap-2 px-3 py-2 bg-panel border border-green-500/50 rounded-lg shadow-md text-xs">
      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
      <span className="text-ink font-mono">
        Anchor:{" "}
        <span className="text-green-600 font-semibold">
          &lt;{anchorElement.tagName}{anchorElement.id ? `#${anchorElement.id}` : ""}&gt;
        </span>
        {anchorElement.text && (
          <span className="text-mute ml-1 truncate max-w-[80px] inline-block align-bottom">{anchorElement.text}</span>
        )}
      </span>
      <button
        onClick={handleClearAnchor}
        title="Clear anchor"
        className="ml-1 h-4 w-4 flex items-center justify-center text-mute hover:text-ink transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
