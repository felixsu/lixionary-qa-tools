"use client";

import Dropdown from "../../../../components/Dropdown";
import { ACTION_OPTIONS, VALUE_ACTIONS } from "../../lib/actions";

// Form blocks shared between InspectorCard and SelectorTesterCard.

export function ActionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Action</label>
      <Dropdown
        value={value}
        onChange={onChange}
        className="h-8 px-2.5 rounded-md text-xs text-ink bg-cream"
        options={ACTION_OPTIONS}
      />
    </div>
  );
}

export function TestValueField({ action, value, onChange }: { action: string; value: string; onChange: (v: string) => void }) {
  if (!VALUE_ACTIONS.includes(action)) return null;
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Test value</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={action === "select_option" ? "option value attribute" : "sample value to type/fill"}
        className="h-8 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay font-mono"
      />
    </div>
  );
}

export function MethodNameField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wider font-semibold text-stone">Method name</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay font-mono"
      />
    </div>
  );
}

export function VerifyResultsLog({
  verifyAttempts,
  verifyResult,
  successLabel,
  failureLabel,
}: {
  verifyAttempts: any[];
  verifyResult: { success: boolean; resultText?: string } | null;
  successLabel: string;
  failureLabel: string;
}) {
  if (verifyAttempts.length === 0 && !verifyResult) return null;
  return (
    <div className="px-3 py-2 bg-panel rounded-lg border border-line text-[11px] font-mono max-h-28 overflow-y-auto">
      {verifyAttempts.map((a, i) => (
        <div key={i} className={a.status === "success" ? "text-green-700" : "text-mute"}>
          {a.source === "llm" ? "🤖 " : ""}{a.strategy}: {a.status}{a.error ? ` — ${a.error}` : ""}
        </div>
      ))}
      {verifyResult && (
        <div className={verifyResult.success ? "text-green-700 font-semibold mt-1" : "text-red-600 font-semibold mt-1"}>
          {verifyResult.success
            ? `${successLabel}${verifyResult.resultText ? `: "${verifyResult.resultText}"` : ""}`
            : failureLabel}
        </div>
      )}
    </div>
  );
}
