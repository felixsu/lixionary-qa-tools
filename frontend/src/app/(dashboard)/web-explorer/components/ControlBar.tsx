"use client";

import { Crosshair, Globe, Loader2, Lock, Play, X } from "lucide-react";
import { useAppContext } from "../../../context/AppContext";
import { useWebExplorer } from "../../../context/WebExplorerContext";
import Dropdown from "../../../components/Dropdown";
import ScanMenu from "./menus/ScanMenu";
import ExploreMenu from "./menus/ExploreMenu";

/**
 * Top control bar. Connected: URL bar + Inspect/Scan/Record/Explore/
 * End Session. Disconnected: profile picker + New Session. The tool runs
 * locally with a single session, so there is no session list UI.
 */
export default function ControlBar({
  onToggleRecord,
  onStartBrowser,
  isStartingSession,
}: {
  onToggleRecord: () => void;
  onStartBrowser: () => void;
  isStartingSession: boolean;
}) {
  const { profiles, selectedProfileId, setSelectedProfileId } = useAppContext();
  const {
    browserUrl,
    setBrowserUrl,
    isBrowserConnected,
    inspectMode,
    isVerifying,
    isExploring,
    isRecording,
    handleBrowserNavigate,
    handleToggleInspect,
    handleDisconnectBrowser,
  } = useWebExplorer();

  return (
    <div className="px-4 py-2.5 border-b border-line bg-panel flex items-center gap-2 flex-shrink-0">
      <Globe className="h-4 w-4 text-stone flex-shrink-0" />
      <div className="flex-1 h-[34px] bg-cream border border-line rounded-lg flex items-center px-3 gap-2">
        <Lock className="h-3 w-3 text-mute flex-shrink-0" />
        <input
          type="text"
          value={browserUrl}
          onChange={(e) => setBrowserUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && isBrowserConnected) {
              handleBrowserNavigate();
            }
          }}
          placeholder="https://example.com"
          className="flex-1 bg-transparent font-mono text-xs text-ink outline-none disabled:text-stone"
        />
      </div>
      {isBrowserConnected ? (
        <>
          <button
            onClick={handleBrowserNavigate}
            className="h-[34px] px-3.5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors"
          >
            Go
          </button>
          <button
            onClick={handleToggleInspect}
            disabled={isVerifying || isExploring || isRecording}
            title={isVerifying ? "Inspect is disabled while verification is running" : isExploring ? "Inspect is disabled while exploration is running" : isRecording ? "Inspect is disabled while recording" : undefined}
            className="h-[34px] px-3.5 rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors border disabled:opacity-60"
            style={
              inspectMode
                ? { background: "rgba(204,120,92,0.12)", borderColor: "rgba(204,120,92,0.4)", color: "#cc785c" }
                : { background: "transparent", borderColor: "var(--color-line)", color: "var(--color-graphite)" }
            }
          >
            <Crosshair className="h-3.5 w-3.5" />
            {inspectMode ? "Inspecting" : "Inspect"}
          </button>
          <ScanMenu />
          <button
            onClick={onToggleRecord}
            disabled={isVerifying || isExploring}
            title={isRecording ? "Stop recording user interactions" : "Record all user interactions on the page"}
            className={`h-[34px] px-3.5 rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors border ${
              isRecording
                ? "bg-red-50 border-red-300 text-red-700 hover:bg-red-100 font-semibold"
                : "bg-transparent border-line text-graphite hover:bg-panel"
            }`}
          >
            {isRecording ? (
              <>
                <span className="h-2.5 w-2.5 rounded-full bg-red-600 animate-pulse flex-shrink-0" />
                Recording…
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5 text-graphite" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="8" />
                </svg>
                Record
              </>
            )}
          </button>
          <ExploreMenu />
          <button
            onClick={handleDisconnectBrowser}
            className="h-[34px] px-3.5 bg-cream border border-line rounded-lg text-[13px] text-graphite hover:bg-panel transition-colors flex items-center gap-1.5"
          >
            <X className="h-3.5 w-3.5" /> End Session
          </button>
        </>
      ) : (
        <>
          <Dropdown
            value={selectedProfileId}
            onChange={setSelectedProfileId}
            className="h-[34px] px-3 rounded-lg text-[13px] text-graphite"
            options={[
              { value: "", label: "No profile (clean session)" },
              ...profiles.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <button
            onClick={onStartBrowser}
            disabled={isStartingSession}
            className="h-[34px] px-4 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white flex items-center gap-1.5 transition-colors disabled:opacity-60"
          >
            {isStartingSession ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…</>
            ) : (
              <><Play className="h-3.5 w-3.5" /> New Session</>
            )}
          </button>
        </>
      )}
    </div>
  );
}
