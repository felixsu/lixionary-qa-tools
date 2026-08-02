"use client";

import { useRef, useState } from "react";
import { ChevronDown, Sparkles, StopCircle } from "lucide-react";
import { useWebExplorer } from "../../../../context/WebExplorerContext";
import { useOutsideDismiss } from "../../hooks/useOutsideDismiss";

/** Explore button: AI exploration scope/prompt popover, or Stop while running. */
export default function ExploreMenu() {
  const {
    isExploring,
    exploreSteps,
    handleStopExplore,
    isVerifying,
    isRecording,
    selectedElement,
    explorePrompt,
    setExplorePrompt,
    handleStartExplore,
  } = useWebExplorer();
  const [open, setOpen] = useState(false);
  const [exploreScope, setExploreScope] = useState<"page" | "selected">("page");
  const menuRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(menuRef, () => setOpen(false), open);

  return (
    <div className="relative" ref={menuRef}>
      {isExploring ? (
        <button
          onClick={handleStopExplore}
          title="Stop exploration and keep whatever was discovered so far"
          className="h-[34px] px-3.5 rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors border bg-red-50 border-red-300 text-red-700 hover:bg-red-100"
        >
          <StopCircle className="h-3.5 w-3.5" />
          Exploring… step {exploreSteps.length} (Stop)
        </button>
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={isVerifying || isRecording}
          title={isRecording ? "Explore is disabled while recording" : "Let AI autonomously click/fill around the page to discover interactive elements"}
          className="h-[34px] px-3.5 rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors border bg-transparent border-line text-graphite hover:bg-panel disabled:opacity-60"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Explore
          <ChevronDown className="h-3 w-3" />
        </button>
      )}
      {open && !isExploring && (
        <div className="absolute right-0 top-full mt-1 w-[280px] bg-cream border border-line rounded-xl shadow-[0_8px_24px_rgba(20,20,19,0.12)] z-50 p-3 flex flex-col gap-2">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Scope</label>
          <div className="flex rounded-md border border-line overflow-hidden">
            <button
              onClick={() => setExploreScope("page")}
              className={`flex-1 h-7 text-[11px] font-medium transition-colors ${exploreScope === "page" ? "bg-clay text-white" : "bg-panel text-graphite hover:bg-line"}`}
            >
              Entire page
            </button>
            <button
              onClick={() => selectedElement && setExploreScope("selected")}
              disabled={!selectedElement}
              title={selectedElement ? undefined : "Inspect & click a parent element first"}
              className={`flex-1 h-7 text-[11px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${exploreScope === "selected" ? "bg-clay text-white" : "bg-panel text-graphite hover:bg-line"}`}
            >
              Selected element
            </button>
          </div>
          {exploreScope === "selected" && selectedElement && (
            <p className="text-[11px] text-mute -mt-1">
              Restricted to &lt;{selectedElement.tagName}&gt; {String(selectedElement.text || "").slice(0, 30)}
            </p>
          )}
          <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">
            What should the AI explore? (optional)
          </label>
          <input
            type="text"
            value={explorePrompt}
            onChange={(e) => setExplorePrompt(e.target.value)}
            placeholder="e.g. explore the checkout flow"
            className="h-8 bg-panel border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay"
          />
          <p className="text-[11px] text-mute">
            Runs for a few minutes, clicking/filling around the page for real. Destructive-looking
            actions (delete, pay, log out, etc.) are automatically skipped, and it won&apos;t leave this site.
          </p>
          <button
            onClick={() => { setOpen(false); handleStartExplore(exploreScope); }}
            className="h-8 bg-clay hover:bg-clay-dark rounded-lg text-xs font-semibold text-white transition-colors flex items-center justify-center gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" /> Start Exploring
          </button>
        </div>
      )}
    </div>
  );
}
