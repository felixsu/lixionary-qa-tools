"use client";

import { Sparkles, X } from "lucide-react";
import { useWebExplorer } from "../../../../context/WebExplorerContext";

/** Live step log while (or after) AI exploration runs. */
export default function ExploreLog() {
  const { isExploring, exploreSteps, setExploreSteps } = useWebExplorer();
  if (!isExploring && exploreSteps.length === 0) return null;
  return (
    <div className="absolute bottom-4 left-4 z-40 w-96 max-h-64 bg-cream border border-line rounded-xl shadow-[0_12px_24px_rgba(20,20,19,0.15)] flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-line bg-panel flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-clay" />
          {isExploring ? "Exploring…" : "Exploration finished"} ({exploreSteps.length} steps)
        </span>
        {!isExploring && (
          <button
            onClick={() => setExploreSteps([])}
            className="h-5 w-5 rounded-md hover:bg-line flex items-center justify-center transition-colors"
          >
            <X className="h-3.5 w-3.5 text-mute hover:text-graphite" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 text-[11px] font-mono flex flex-col gap-1">
        {exploreSteps.map((s, i) => (
          <div key={i} className={s.success === false ? "text-red-600" : "text-graphite"}>
            #{s.step} {s.action}
            {s.elementSummary ? `: ${s.elementSummary}` : ""}
            {s.success === false && s.error ? ` — ${s.error}` : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
