"use client";

import { useEffect, useRef, useState } from "react";
import { Anchor, Crosshair, HelpCircle, Loader2, Play, Save, X } from "lucide-react";
import Dropdown from "../../../../components/Dropdown";
import { useAppContext } from "../../../../context/AppContext";
import { useWebExplorer } from "../../../../context/WebExplorerContext";
import { useToast } from "../../../../context/ToastContext";
import { useOutsideDismiss } from "../../hooks/useOutsideDismiss";
import { ActionSelect, TestValueField, MethodNameField, VerifyResultsLog } from "../shared/ElementActionFields";

const SELECTOR_EXAMPLES: { example: string; label: string }[] = [
  { example: "#submit-btn", label: "CSS id" },
  { example: ".card button.primary", label: "CSS" },
  { example: 'xpath=//button[text()="Submit"]', label: "XPath" },
  { example: "text=Submit", label: "visible text" },
  { example: 'role=button[name="Save"]', label: "ARIA role" },
  { example: "div.modal >> button >> nth=0", label: "chaining" },
];

/**
 * Floating card for an inspect-clicked element: method name, action, locator
 * strategy ranking, optional custom selector override, anchor/verify/record.
 * The custom-selector input state and the full dismiss reset live in the page
 * so the Escape ladder and the ✕ button share one path.
 */
export default function InspectorCard({
  customSelectorInput,
  setCustomSelectorInput,
  onDismiss,
  onRecorded,
}: {
  customSelectorInput: string;
  setCustomSelectorInput: (v: string) => void;
  onDismiss: () => void;
  onRecorded: () => Promise<void>;
}) {
  const { apiCall } = useAppContext();
  const {
    sessionId,
    selectedElement,
    selectedElementLocators,
    setSelectedElementLocators,
    selectedElementStale,
    selectedElementAction,
    setSelectedElementAction,
    selectedElementMethodName,
    setSelectedElementMethodName,
    selectedElementTestValue,
    setSelectedElementTestValue,
    isVerifying,
    verifyAttempts,
    verifyResult,
    handleVerifyElement,
    selectorTestResult,
    isTestingSelector,
    handleTestSelector,
    handleSetAnchor,
  } = useWebExplorer();
  const { showToast } = useToast();

  const [showSelectorHint, setShowSelectorHint] = useState(false);
  const hintRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(hintRef, () => setShowSelectorHint(false), showSelectorHint);

  // When a custom selector typed in the inspector card tests successfully, it
  // becomes the primary strategy (index 0) — Verify and Record both use the
  // list head, so the manual selector automatically wins over generated ones.
  useEffect(() => {
    if (!selectorTestResult || selectorTestResult.error) return;
    if (!selectedElement) return;
    if (selectorTestResult.selector !== customSelectorInput.trim()) return;
    const entry = {
      strategy: "locator (Custom)",
      selector: selectorTestResult.selector,
      statement: `page.locator("${selectorTestResult.selector.replace(/"/g, '\\"')}")`,
      count: selectorTestResult.totalCount,
      unique: selectorTestResult.totalCount === 1,
      score: 200,
    };
    setSelectedElementLocators([entry, ...selectedElementLocators.filter((l) => l.strategy !== "locator (Custom)")]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectorTestResult]);

  if (!selectedElement) return null;

  const handleRecordElementToPOM = async () => {
    if (!selectedElement || !sessionId) return;
    const strategy = selectedElementLocators[0]?.strategy || "locator (CSS)";
    const selector = selectedElementLocators[0]?.selector || selectedElement.cssSelector;
    const methodName = selectedElementMethodName || `click_${selectedElement.tagName.toLowerCase()}`;

    try {
      await apiCall("/api/browser/pom/add", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          methodName,
          action: selectedElementAction,
          strategy,
          selector,
          frameLocators: selectedElement.frameLocators || [],
        }),
      });

      onDismiss();
      setSelectedElementMethodName("");

      await onRecorded();
    } catch (e: any) {
      showToast(e.message || "Failed to record element to POM class.", { type: "error" });
    }
  };

  return (
    <div className="absolute bottom-4 right-4 z-40 w-80 bg-cream border border-line rounded-xl shadow-[0_12px_24px_rgba(20,20,19,0.15)] flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between bg-panel">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-clay animate-pulse" /> Inspect Element
        </span>
        <button
          onClick={onDismiss}
          className="h-6 w-6 rounded-md hover:bg-line flex items-center justify-center transition-colors"
        >
          <X className="h-4 w-4 text-mute hover:text-graphite" />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-3">
        <div className="px-3 py-2 bg-panel rounded-lg border border-line font-mono text-[11px] text-graphite break-all max-h-24 overflow-y-auto">
          <span className="text-clay font-semibold">&lt;{selectedElement.tagName}&gt;</span> {selectedElement.text}
          {selectedElement.frameLocators?.length > 0 && (
            <div className="text-[10px] text-clay font-semibold mt-1">
              Frame: {selectedElement.frameLocators.join(" → ")}
            </div>
          )}
        </div>

        {selectedElementStale?.stale && (
          <div className="px-3 py-2 bg-amber-50 border border-amber-300 rounded-lg text-[11px] text-amber-800 font-medium">
            ⚠️ Content changed while analyzing — the dropdown is likely still loading or refreshing. Locators below may not match. Click the element again once it settles.
          </div>
        )}

        <MethodNameField
          value={selectedElementMethodName}
          onChange={setSelectedElementMethodName}
          placeholder={`e.g. click_${selectedElement.tagName.toLowerCase()}`}
        />

        <ActionSelect value={selectedElementAction} onChange={setSelectedElementAction} />

        <TestValueField
          action={selectedElementAction}
          value={selectedElementTestValue}
          onChange={setSelectedElementTestValue}
        />

        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Locator strategy</label>
          <Dropdown
            value="0"
            onChange={(v) => {
              const selectedIdx = parseInt(v);
              const loc = selectedElementLocators[selectedIdx];
              if (loc) {
                setSelectedElementLocators([loc, ...selectedElementLocators.filter((_, i) => i !== selectedIdx)]);
              }
            }}
            widthClass="w-full"
            className="h-8 px-2.5 rounded-md text-xs text-ink font-mono bg-cream"
            openUpward
            options={selectedElementLocators.map((loc, idx) => {
              let uniqueness = "";
              if (selectedElementStale?.stale && loc.count === 0) {
                uniqueness = " ⚠️ (stale — retry)";
              } else if (loc.unique === true) {
                uniqueness = " ✅ (Unique)";
              } else if (loc.unique === false) {
                uniqueness = ` ⚠️ (${loc.count} matches)`;
              }
              return { value: String(idx), label: `${loc.strategy}${uniqueness}` };
            })}
          />
        </div>

        <div className="flex flex-col gap-1 relative">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Custom selector (optional)</label>
            <button
              onClick={() => setShowSelectorHint((v) => !v)}
              title="Show selector examples"
              className="h-4 w-4 flex items-center justify-center rounded-full transition-colors"
            >
              <HelpCircle className={`h-3.5 w-3.5 ${showSelectorHint ? "text-clay" : "text-mute hover:text-clay"}`} />
            </button>
          </div>
          {showSelectorHint && (
            <div
              ref={hintRef}
              className="absolute bottom-full left-0 right-0 mb-1.5 z-50 bg-cream border border-line rounded-xl shadow-[0_12px_24px_rgba(20,20,19,0.15)] p-3 flex flex-col gap-2"
            >
              <span className="text-[10px] uppercase tracking-wider font-semibold text-stone">Selector examples</span>
              <div className="flex flex-col gap-1">
                {SELECTOR_EXAMPLES.map(({ example, label }) => (
                  <button
                    key={example}
                    onClick={() => { setCustomSelectorInput(example); setShowSelectorHint(false); }}
                    title="Use this example as a starting point"
                    className="flex items-baseline justify-between gap-2 px-2 py-1 rounded-md hover:bg-panel transition-colors text-left"
                  >
                    <code className="font-mono text-[11px] text-ink break-all">{example}</code>
                    <span className="text-[10px] text-mute flex-shrink-0">{label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-graphite border-t border-line pt-2">
                Click <span className="font-semibold">Test</span> first — a selector that tests as a unique
                match becomes the primary strategy used by Verify and Record.
              </p>
            </div>
          )}
          <div className="flex gap-1.5">
            <input
              type="text"
              value={customSelectorInput}
              onChange={(e) => setCustomSelectorInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customSelectorInput.trim() && !isTestingSelector) {
                  handleTestSelector(customSelectorInput.trim());
                }
              }}
              placeholder='css, xpath=…, text=…, a >> b'
              className="flex-1 h-8 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay font-mono min-w-0"
            />
            <button
              onClick={() => handleTestSelector(customSelectorInput.trim())}
              disabled={!customSelectorInput.trim() || isTestingSelector}
              title="Check how many elements this selector matches and highlight them"
              className="h-8 px-2.5 bg-panel border border-line hover:border-clay rounded-md text-xs font-semibold text-ink transition-colors flex items-center gap-1 disabled:opacity-60"
            >
              {isTestingSelector ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 text-clay" />}
              Test
            </button>
          </div>
          {selectorTestResult?.error && selectorTestResult.selector === customSelectorInput.trim() && (
            <p className="text-[11px] text-red-600 font-mono break-all">{selectorTestResult.error}</p>
          )}
          {selectorTestResult && !selectorTestResult.error && selectorTestResult.selector === customSelectorInput.trim() && (
            <p className={`text-[11px] font-medium ${selectorTestResult.totalCount === 1 ? "text-green-700" : "text-amber-700"}`}>
              {selectorTestResult.totalCount === 0
                ? "No matches on this page"
                : selectorTestResult.totalCount === 1
                  ? "✅ Unique match — set as primary strategy"
                  : `⚠️ ${selectorTestResult.totalCount} matches — actions need a unique selector (try >> nth=0)`}
            </p>
          )}
        </div>

        <div className="flex gap-2 mt-1">
          <button
            onClick={handleSetAnchor}
            title="Set this element as XPath anchor — then click a descendant to get a relative XPath"
            className="flex-1 h-9 bg-panel border border-line hover:border-green-500 rounded-lg text-xs font-semibold text-ink transition-colors flex items-center justify-center gap-1.5"
          >
            <Anchor className="h-3.5 w-3.5 text-green-600" /> Set as Anchor
          </button>
          <button
            onClick={handleVerifyElement}
            disabled={isVerifying}
            title="Try this action + locator live against the browser before recording it"
            className="flex-1 h-9 bg-panel border border-line hover:border-blue-500 rounded-lg text-xs font-semibold text-ink transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            {isVerifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 text-blue-600" />}
            {isVerifying ? "Verifying…" : "Verify"}
          </button>
          <button
            onClick={handleRecordElementToPOM}
            className="flex-1 h-9 bg-clay hover:bg-clay-dark rounded-lg text-xs font-semibold text-white transition-colors shadow-sm flex items-center justify-center gap-1.5"
          >
            <Save className="h-3.5 w-3.5" /> Record
          </button>
        </div>

        <VerifyResultsLog
          verifyAttempts={verifyAttempts}
          verifyResult={verifyResult}
          successLabel="✅ Verified"
          failureLabel="❌ All candidates failed"
        />
      </div>
    </div>
  );
}
