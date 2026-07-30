"use client";

// Chat side panel for the API Studio AI assistant. Renders the per-flow
// transcript, proposal cards with Apply/Dismiss, and the composer. All state
// (entries, busy, error) lives in the page so nothing is lost when the panel
// is swapped out for the node inspector; this component is presentation only
// except for re-validating pending proposals against the live canvas.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, X, Trash2, Plus, Send, Repeat2, Timer, ShieldCheck, Pencil,
  ArrowRight, Check, AlertCircle, CornerDownLeft,
} from "lucide-react";
import MarkdownContent from "../../components/guide/MarkdownContent";
import { confirmDialog } from "../../utils/confirmDialog";
import {
  validateAndPlan,
  type AssistantAction,
  type ChatEntry,
  type CatalogRow,
  type ValidatedPlan,
} from "../../utils/studioAssistant";
import type { FlowNode, FlowEdge } from "../../utils/flowTypes";

interface AssistantPanelProps {
  entries: ChatEntry[];
  busy: boolean;
  error: string | null;
  canvas: { nodes: FlowNode[]; edges: FlowEdge[] };
  catalog: CatalogRow[];
  onSend: (text: string) => void;
  onRetrySend: () => void;
  onApply: (index: number) => void;
  onDismiss: (index: number) => void;
  onClear: () => void;
  onClose: () => void;
}

const actionIcon = (action: AssistantAction) => {
  if (action.type === "create_flow") return Plus;
  if (action.type === "update_node") return Pencil;
  if (action.type === "connect") return ArrowRight;
  switch (action.nodeType) {
    case "delay":
      return Timer;
    case "looper":
      return Repeat2;
    case "verifier":
      return ShieldCheck;
    default:
      return Send;
  }
};

function ProposalCard({
  entry,
  plan,
  busy,
  onApply,
  onDismiss,
}: {
  entry: ChatEntry;
  plan: ValidatedPlan | null; // null when not pending (applied/dismissed)
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const proposal = entry.proposal!;
  const pending = entry.proposalState === "pending";
  return (
    <div className="mt-2 bg-cream border border-line rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-line text-[10px] font-semibold uppercase tracking-[0.1em] text-stone">
        Proposed actions
      </div>
      <div className="p-2 flex flex-col gap-1">
        {(plan?.steps || proposal.actions.map((action) => ({ action, summary: undefined as string | undefined }))).map(
          (step: any, i: number) => {
            const Icon = actionIcon(step.action);
            return (
              <div key={i} className="px-2 py-1.5 rounded-md text-xs text-graphite flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-clay flex-shrink-0" />
                  <span className="min-w-0 break-words">{step.summary || step.action.type}</span>
                </div>
                {step.note && <div className="pl-5 text-[11px] text-amber-700">{step.note}</div>}
                {step.error && <div className="pl-5 text-[11px] text-red-600">{step.error}</div>}
              </div>
            );
          }
        )}
        {plan?.globalErrors.map((err, i) => (
          <div key={`g${i}`} className="px-2 text-[11px] text-red-600">{err}</div>
        ))}
      </div>
      <div className="px-3 py-2 border-t border-line flex items-center gap-2">
        {pending ? (
          <>
            <button
              onClick={onApply}
              disabled={busy || !plan?.ok}
              title={plan?.ok ? "Apply these actions to the canvas" : "This proposal has errors and cannot be applied"}
              className="h-7 px-3 flex items-center gap-1.5 bg-clay hover:bg-clay-dark rounded-md text-xs font-medium text-white transition-colors disabled:opacity-50"
            >
              <Check className="h-3 w-3" /> Apply
            </button>
            <button
              onClick={onDismiss}
              disabled={busy}
              className="h-7 px-3 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors disabled:opacity-50"
            >
              Dismiss
            </button>
          </>
        ) : entry.proposalState === "applied" ? (
          <span className="flex items-center gap-1.5 text-xs text-green-700">
            <Check className="h-3.5 w-3.5" /> Applied to the canvas
          </span>
        ) : (
          <span className="text-xs text-mute">Dismissed</span>
        )}
      </div>
    </div>
  );
}

export default function AssistantPanel({
  entries,
  busy,
  error,
  canvas,
  catalog,
  onSend,
  onRetrySend,
  onApply,
  onDismiss,
  onClear,
  onClose,
}: AssistantPanelProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [entries, busy]);

  // Pending proposals are re-validated against the live canvas every render,
  // so Apply enablement and card errors track canvas edits in real time.
  const pendingPlans = useMemo(() => {
    const plans = new Map<number, ValidatedPlan>();
    entries.forEach((entry, i) => {
      if (entry.proposal && entry.proposalState === "pending") {
        plans.set(i, validateAndPlan(entry.proposal.actions, canvas, catalog));
      }
    });
    return plans;
  }, [entries, canvas, catalog]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    onSend(text);
  };

  return (
    <div className="w-[380px] flex-shrink-0 bg-panel border-l border-line flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between flex-shrink-0">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Sparkles className="h-4 w-4 text-clay" /> Assistant
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={async () => {
              if (await confirmDialog("Clear this flow's chat history?")) onClear();
            }}
            title="Clear chat"
            className="p-1.5 text-mute hover:text-red-600 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={onClose} title="Close" className="p-1.5 text-mute hover:text-ink transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {!entries.length && (
          <p className="text-xs text-mute leading-relaxed">
            Describe the flow you want — e.g. <em>&quot;get a UUID, wait 500 ms, then echo it&quot;</em>. I can add and
            connect nodes using requests from your collections; you review and apply, then run the flow yourself. I&apos;ll
            ask when something is missing, and I can&apos;t use requests you haven&apos;t built yet.
          </p>
        )}
        {entries.map((entry, i) => {
          if (entry.synthetic) {
            return (
              <div key={i} className="text-center text-[11px] text-mute">
                {entry.content.replace(/^\[|\]$/g, "")}
              </div>
            );
          }
          if (entry.role === "user") {
            return (
              <div key={i} className="self-end max-w-[85%] bg-cream border border-line rounded-lg px-3 py-2 text-xs text-ink whitespace-pre-wrap break-words">
                {entry.content}
              </div>
            );
          }
          return (
            <div key={i} className="self-start max-w-full text-xs text-graphite">
              <MarkdownContent content={entry.proposal?.message || entry.content} />
              {entry.proposal && entry.proposal.actions.length > 0 && (
                <ProposalCard
                  entry={entry}
                  plan={pendingPlans.get(i) || null}
                  busy={busy}
                  onApply={() => onApply(i)}
                  onDismiss={() => onDismiss(i)}
                />
              )}
            </div>
          );
        })}
        {busy && (
          <div className="self-start flex items-center gap-1.5 text-xs text-mute">
            <span className="flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-clay animate-pulse" />
              <span className="h-1.5 w-1.5 rounded-full bg-clay animate-pulse [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-clay animate-pulse [animation-delay:300ms]" />
            </span>
            Thinking…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span className="min-w-0 break-words">
              {error}{" "}
              <button onClick={onRetrySend} className="underline hover:no-underline">
                Retry
              </button>
            </span>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-line flex-shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Ask the assistant to build or extend this flow…"
            disabled={busy}
            className="flex-1 bg-cream border border-line rounded-lg px-3 py-2 text-xs text-ink outline-none focus:border-clay resize-none disabled:opacity-60"
          />
          <button
            onClick={send}
            disabled={busy || !draft.trim()}
            title="Send (Enter)"
            className="h-8 w-8 flex items-center justify-center bg-clay hover:bg-clay-dark rounded-md text-white transition-colors disabled:opacity-50 flex-shrink-0"
          >
            <CornerDownLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
