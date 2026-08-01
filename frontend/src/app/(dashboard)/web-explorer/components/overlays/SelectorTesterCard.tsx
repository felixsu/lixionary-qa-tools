"use client";

import { Braces, Loader2, Play, Save, X } from "lucide-react";
import { useAppContext } from "../../../../context/AppContext";
import { useWebExplorer } from "../../../../context/WebExplorerContext";
import { useToast } from "../../../../context/ToastContext";
import { ActionSelect, TestValueField, MethodNameField, VerifyResultsLog } from "../shared/ElementActionFields";

export interface TesterState {
  testerSelector: string;
  setTesterSelector: (v: string) => void;
  testerAction: string;
  setTesterAction: (v: string) => void;
  testerValue: string;
  setTesterValue: (v: string) => void;
  testerMethodName: string;
  setTesterMethodName: (v: string) => void;
}

/**
 * Standalone selector tester — type any Playwright selector, test/highlight
 * it, run actions with it, and save it as a POM method. Field state stays in
 * the page so it survives closing and reopening the card.
 */
export default function SelectorTesterCard({
  tester,
  onClose,
  onRecorded,
}: {
  tester: TesterState;
  onClose: () => void;
  onRecorded: () => Promise<void>;
}) {
  const { apiCall } = useAppContext();
  const {
    sessionId,
    isVerifying,
    verifyAttempts,
    verifyResult,
    selectorTestResult,
    isTestingSelector,
    handleTestSelector,
    handleClearHighlights,
    handleVerifyCustomSelector,
  } = useWebExplorer();
  const { showToast } = useToast();

  const {
    testerSelector, setTesterSelector,
    testerAction, setTesterAction,
    testerValue, setTesterValue,
    testerMethodName, setTesterMethodName,
  } = tester;

  // The frame chain a tested custom selector should execute/record against —
  // only unambiguous when exactly one frame matched.
  const testerFrameLocators =
    selectorTestResult && selectorTestResult.frames.length === 1
      ? selectorTestResult.frames[0].frameLocators
      : [];
  const testerHasValidResult =
    !!selectorTestResult &&
    !selectorTestResult.error &&
    selectorTestResult.selector === testerSelector.trim() &&
    selectorTestResult.totalCount > 0;

  const handleSaveTesterToPOM = async () => {
    if (!sessionId || !testerHasValidResult) return;
    const methodName = testerMethodName || `${testerAction}_custom_element`;
    try {
      await apiCall("/api/browser/pom/add", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          methodName,
          action: testerAction,
          strategy: "locator (Custom)",
          selector: testerSelector.trim(),
          frameLocators: testerFrameLocators,
        }),
      });
      showToast(`Method ${methodName} added to MyPage.`, { type: "info" });
      setTesterMethodName("");
      await onRecorded();
    } catch (e: any) {
      showToast(e.message || "Failed to record selector to POM class.", { type: "error" });
    }
  };

  return (
    <div className="absolute bottom-4 right-4 z-40 w-80 bg-cream border border-line rounded-xl shadow-[0_12px_24px_rgba(20,20,19,0.15)] flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between bg-panel">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink flex items-center gap-2">
          <Braces className="h-4 w-4 text-clay" /> Selector Tester
        </span>
        <button
          onClick={() => { onClose(); handleClearHighlights(); }}
          className="h-6 w-6 rounded-md hover:bg-line flex items-center justify-center transition-colors"
        >
          <X className="h-4 w-4 text-mute hover:text-graphite" />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Selector</label>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={testerSelector}
              onChange={(e) => setTesterSelector(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && testerSelector.trim() && !isTestingSelector) {
                  handleTestSelector(testerSelector.trim());
                }
              }}
              placeholder='css, xpath=…, text=…, a >> b'
              className="flex-1 h-8 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay font-mono min-w-0"
            />
            <button
              onClick={() => handleTestSelector(testerSelector.trim())}
              disabled={!testerSelector.trim() || isTestingSelector}
              title="Check how many elements this selector matches and highlight them on the page"
              className="h-8 px-2.5 bg-panel border border-line hover:border-clay rounded-md text-xs font-semibold text-ink transition-colors flex items-center gap-1 disabled:opacity-60"
            >
              {isTestingSelector ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 text-clay" />}
              Test
            </button>
          </div>
          <p className="text-[10px] text-mute">
            Playwright syntax: CSS, <span className="font-mono">xpath=//…</span>, <span className="font-mono">text=Submit</span>, chaining with <span className="font-mono">&gt;&gt;</span>
          </p>
        </div>

        {selectorTestResult && selectorTestResult.selector === testerSelector.trim() && (
          selectorTestResult.error ? (
            <p className="px-3 py-2 bg-red-50 border border-red-300 rounded-lg text-[11px] text-red-700 font-mono break-all">
              {selectorTestResult.error}
            </p>
          ) : (
            <div className={`px-3 py-2 rounded-lg border text-[11px] font-medium ${
              selectorTestResult.totalCount === 1
                ? "bg-green-50 border-green-300 text-green-800"
                : selectorTestResult.totalCount === 0
                  ? "bg-panel border-line text-mute"
                  : "bg-amber-50 border-amber-300 text-amber-800"
            }`}>
              {selectorTestResult.totalCount === 0
                ? "No matches on this page"
                : selectorTestResult.totalCount === 1
                  ? "✅ Unique match (highlighted on the page)"
                  : `⚠️ ${selectorTestResult.totalCount} matches — Playwright strict mode rejects actions on multi-match selectors; refine it or append >> nth=0`}
              {selectorTestResult.frames.filter((f) => f.frameLocators.length > 0).map((f, i) => (
                <div key={i} className="text-[10px] font-mono mt-1">
                  {f.count} in frame: {f.frameLocators.join(" → ")}
                </div>
              ))}
            </div>
          )
        )}

        <ActionSelect value={testerAction} onChange={setTesterAction} />

        <TestValueField action={testerAction} value={testerValue} onChange={setTesterValue} />

        <MethodNameField
          value={testerMethodName}
          onChange={setTesterMethodName}
          placeholder={`e.g. ${testerAction}_custom_element`}
        />

        <div className="flex gap-2 mt-1">
          <button
            onClick={() => handleVerifyCustomSelector(testerSelector.trim(), testerAction, testerValue, testerFrameLocators)}
            disabled={!testerHasValidResult || isVerifying}
            title={testerHasValidResult ? "Run this action with the selector live against the browser" : "Test the selector first — it must match at least one element"}
            className="flex-1 h-9 bg-panel border border-line hover:border-blue-500 rounded-lg text-xs font-semibold text-ink transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            {isVerifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 text-blue-600" />}
            {isVerifying ? "Running…" : "Run"}
          </button>
          <button
            onClick={handleSaveTesterToPOM}
            disabled={!testerHasValidResult}
            title={testerHasValidResult ? "Save as a POM method using this selector" : "Test the selector first — it must match at least one element"}
            className="flex-1 h-9 bg-clay hover:bg-clay-dark rounded-lg text-xs font-semibold text-white transition-colors shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <Save className="h-3.5 w-3.5" /> Save to POM
          </button>
        </div>

        <VerifyResultsLog
          verifyAttempts={verifyAttempts}
          verifyResult={verifyResult}
          successLabel="✅ Ran successfully"
          failureLabel="❌ Action failed with this selector"
        />
      </div>
    </div>
  );
}
