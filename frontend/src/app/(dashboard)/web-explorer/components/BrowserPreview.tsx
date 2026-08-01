"use client";

import { Globe, X } from "lucide-react";
import { useWebExplorer } from "../../../context/WebExplorerContext";
import { useScreencastFrame } from "../../../utils/screencastFrameStore";
import { usePreviewInput } from "../hooks/usePreviewInput";

/**
 * Tab strip + live screencast preview with input relay. The single owner of
 * the preview container ref — used by both the "browser" and "split" view
 * modes (previously two copy-pasted blocks that even shared one ref).
 */
export default function BrowserPreview({ dragOverlayActive }: { dragOverlayActive: boolean }) {
  const {
    isBrowserConnected,
    isRecording,
    browserTabs,
    activeTabIndex,
    handleSwitchTab,
    handleCloseTab,
  } = useWebExplorer();
  const latestFrame = useScreencastFrame();
  const { previewContainerRef, handlePreviewMouseEvent, handlePreviewKeyDown, handlePreviewWheel } = usePreviewInput();

  return (
    <div className="w-full h-full flex flex-col">
      {isBrowserConnected && browserTabs.length > 1 && (
        <div className="flex items-center gap-0.5 px-2 py-1 bg-ink-900 border-b border-white/10 overflow-x-auto flex-shrink-0">
          {browserTabs.map((tab, i) => (
            <div
              key={tab.index}
              onClick={() => handleSwitchTab(i)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] cursor-pointer whitespace-nowrap max-w-[180px] select-none transition-colors ${
                activeTabIndex === i ? "bg-cream/15 text-cream" : "text-cream/40 hover:bg-cream/10 hover:text-cream/70"
              }`}
            >
              <Globe className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">
                {tab.url ? (() => { try { return new URL(tab.url).hostname || "New tab"; } catch { return "New tab"; } })() : "New tab"}
              </span>
              {i > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleCloseTab(i); }}
                  className="ml-0.5 text-cream/30 hover:text-danger transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="relative flex-1 w-full overflow-hidden">
        {isBrowserConnected ? (
          <div
            ref={previewContainerRef}
            className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden focus:outline-none"
            tabIndex={0}
            onKeyDown={handlePreviewKeyDown}
            onWheel={handlePreviewWheel}
            onMouseDown={(e) => handlePreviewMouseEvent(e, "down")}
            onMouseUp={(e) => handlePreviewMouseEvent(e, "up")}
            onMouseMove={(e) => handlePreviewMouseEvent(e, "move")}
          >
            {isRecording && (
              <div className="absolute top-4 left-4 z-40 flex items-center gap-2 px-3 py-1.5 bg-red-950 border border-red-500/50 rounded-lg shadow-md text-xs text-red-200 select-none pointer-events-none">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                <span className="font-semibold uppercase tracking-wider text-[10px]">Recording Session</span>
              </div>
            )}
            {latestFrame ? (
              <img
                src={`data:image/jpeg;base64,${latestFrame}`}
                alt="Browser Screencast"
                className="w-full h-full object-contain pointer-events-none select-none"
                draggable={false}
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-cream/40 text-xs gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
                Session started. Streaming native browser window...
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-cream/40 text-xs">
            Select a profile and click New Session to start a session.
          </div>
        )}
        {dragOverlayActive && (
          <div className="absolute inset-0 z-10" />
        )}
      </div>
    </div>
  );
}
