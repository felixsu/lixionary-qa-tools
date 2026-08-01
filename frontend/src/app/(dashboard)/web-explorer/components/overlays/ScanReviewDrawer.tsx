"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, ScanSearch, X } from "lucide-react";
import { useAppContext } from "../../../../context/AppContext";
import { useWebExplorer } from "../../../../context/WebExplorerContext";
import { useToast } from "../../../../context/ToastContext";

/**
 * Review drawer for Scan/Explore results: per-element checkbox + editable
 * method name, bulk-recorded into MyPage. Owns the selection state — its
 * lifecycle tracks pageScanResults exactly (reseeded whenever results change).
 */
export default function ScanReviewDrawer({ onRecorded }: { onRecorded: () => Promise<void> }) {
  const { apiCall } = useAppContext();
  const { sessionId, pageScanResults, pageScanScopeLabel, resetPageScan } = useWebExplorer();
  const { showToast } = useToast();

  // Page-scan review drawer: per-element checkbox + editable method name
  const [scanSelections, setScanSelections] = useState<Record<number, { checked: boolean; name: string }>>({});
  const [isRecordingScan, setIsRecordingScan] = useState(false);

  useEffect(() => {
    if (!pageScanResults) {
      setScanSelections({});
      return;
    }
    const seeded: Record<number, { checked: boolean; name: string }> = {};
    for (const el of pageScanResults) {
      seeded[el.id] = { checked: !el.disabled, name: el.methodName };
    }
    setScanSelections(seeded);
  }, [pageScanResults]);

  if (!pageScanResults) return null;

  const checkedScanElements = pageScanResults.filter((el) => scanSelections[el.id]?.checked);
  const scanNameCounts: Record<string, number> = {};
  for (const el of checkedScanElements) {
    const name = scanSelections[el.id]?.name?.trim() || "";
    scanNameCounts[name] = (scanNameCounts[name] || 0) + 1;
  }
  const hasScanNameConflicts = checkedScanElements.some((el) => {
    const name = scanSelections[el.id]?.name?.trim() || "";
    return !name || scanNameCounts[name] > 1;
  });

  const handleRecordScanned = async () => {
    if (!sessionId || checkedScanElements.length === 0) return;
    setIsRecordingScan(true);
    try {
      const res = await apiCall("/api/browser/pom/add-bulk", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          methods: checkedScanElements.map((el) => ({
            methodName: scanSelections[el.id].name,
            action: el.action,
            strategy: el.locator.strategy,
            selector: el.locator.selector,
            frameLocators: el.frameLocators || [],
          })),
        }),
      });
      const renamed = (res.added || []).filter((a: any) => a.requested !== a.recorded);
      if (renamed.length > 0) {
        showToast(
          `Recorded ${res.count} methods. ${renamed.length} renamed to avoid duplicates: ` +
          renamed.map((a: any) => `${a.requested} → ${a.recorded}`).join(", "),
          { type: "info" }
        );
      }
      resetPageScan();
      await onRecorded();
    } catch (e: any) {
      showToast(e.message || "Failed to record scanned elements.", { type: "error" });
    } finally {
      setIsRecordingScan(false);
    }
  };

  return (
    <div className="absolute top-4 bottom-4 right-4 z-40 w-[420px] bg-cream border border-line rounded-xl shadow-[0_12px_24px_rgba(20,20,19,0.15)] flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-line bg-panel">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink flex items-center gap-2">
            <ScanSearch className="h-4 w-4 text-clay" />
            {pageScanScopeLabel ? "Section scan" : "Page scan"} — {pageScanResults.length} elements
          </span>
          <button
            onClick={resetPageScan}
            className="h-6 w-6 rounded-md hover:bg-line flex items-center justify-center transition-colors"
          >
            <X className="h-4 w-4 text-mute hover:text-graphite" />
          </button>
        </div>
        {pageScanScopeLabel && (
          <div className="mt-1 font-mono text-[10px] text-clay truncate" title={pageScanScopeLabel}>
            Scope: {pageScanScopeLabel}
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-b border-line flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setScanSelections((prev) => {
              const next = { ...prev };
              for (const el of pageScanResults) next[el.id] = { ...next[el.id], checked: true };
              return next;
            })}
            className="text-clay font-semibold hover:underline"
          >
            All
          </button>
          <span className="text-line">/</span>
          <button
            onClick={() => setScanSelections((prev) => {
              const next = { ...prev };
              for (const el of pageScanResults) next[el.id] = { ...next[el.id], checked: false };
              return next;
            })}
            className="text-clay font-semibold hover:underline"
          >
            None
          </button>
        </div>
        <span className="text-stone">{checkedScanElements.length} selected</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {pageScanResults.map((el) => {
          const sel = scanSelections[el.id] || { checked: false, name: el.methodName };
          const name = sel.name?.trim() || "";
          const conflict = sel.checked && (!name || scanNameCounts[name] > 1);
          return (
            <div
              key={el.id}
              className={`p-2.5 rounded-lg border flex flex-col gap-1.5 ${
                conflict ? "border-red-400" : "border-line"
              } ${el.disabled ? "opacity-50" : ""} bg-panel`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={sel.checked}
                  onChange={(e) =>
                    setScanSelections((prev) => ({ ...prev, [el.id]: { ...sel, checked: e.target.checked } }))
                  }
                  className="h-3.5 w-3.5 accent-[#cc785c] flex-shrink-0"
                />
                <input
                  type="text"
                  value={sel.name}
                  onChange={(e) =>
                    setScanSelections((prev) => ({ ...prev, [el.id]: { ...sel, name: e.target.value } }))
                  }
                  className="flex-1 h-7 bg-cream border border-line rounded-md px-2 text-xs text-ink outline-none focus:border-clay font-mono min-w-0"
                />
                <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-cream border border-line text-stone flex-shrink-0">
                  {el.action}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 pl-5">
                <span className="font-mono text-[11px] text-graphite truncate">
                  <span className="text-clay font-semibold">&lt;{el.tagName}&gt;</span> {el.text}
                </span>
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  {el.frameLocators?.length > 0 && (
                    <span
                      className="text-[9px] font-semibold uppercase px-1 py-0.5 rounded bg-clay/10 text-clay border border-clay/30"
                      title={`Inside iframe: ${el.frameLocators.join(" → ")}`}
                    >
                      iframe
                    </span>
                  )}
                  <span className="text-[10px] text-stone">
                    {el.locator?.unique ? "✅ Unique" : `⚠️ ${el.locator?.count ?? "?"} matches`}
                  </span>
                </span>
              </div>
            </div>
          );
        })}
        {pageScanResults.length === 0 && (
          <p className="text-xs text-mute text-center py-6">No interactive elements detected on this page.</p>
        )}
      </div>

      <div className="p-3 border-t border-line bg-panel">
        <button
          onClick={handleRecordScanned}
          disabled={checkedScanElements.length === 0 || hasScanNameConflicts || isRecordingScan}
          className="w-full h-9 bg-clay hover:bg-clay-dark disabled:opacity-50 rounded-lg text-xs font-semibold text-white transition-colors shadow-sm flex items-center justify-center gap-1.5"
        >
          {isRecordingScan ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Record {checkedScanElements.length} selected
        </button>
        {hasScanNameConflicts && (
          <p className="text-[10px] text-red-600 mt-1.5 text-center">
            Fix duplicate or empty method names before recording.
          </p>
        )}
      </div>
    </div>
  );
}
