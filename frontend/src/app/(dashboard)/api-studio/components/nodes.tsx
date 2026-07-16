"use client";

import React from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Send, Repeat2, Timer, ShieldCheck, AlertCircle } from "lucide-react";
import type { FlowNode } from "../../../utils/flowTypes";
import type { NodeRunStatus } from "../../../utils/flowRunner";

export interface StudioNodeData extends Record<string, unknown> {
  flowNode: FlowNode;
  status: NodeRunStatus;
  // human label of the linked request ("GET orders search"), or an error hint
  requestLabel: string | null;
  requestMissing: boolean;
}

export type StudioNode = Node<StudioNodeData>;

const STATUS_DOT: Record<NodeRunStatus, string> = {
  idle: "bg-line",
  pending: "bg-stone/50",
  running: "bg-clay animate-pulse",
  success: "bg-emerald-500",
  failed: "bg-red-500",
  skipped: "bg-amber-400",
};

const STATUS_LABEL: Record<NodeRunStatus, string> = {
  idle: "",
  pending: "queued",
  running: "running…",
  success: "success",
  failed: "failed",
  skipped: "skipped",
};

const TYPE_META: Record<FlowNode["type"], { icon: typeof Send; label: string; accent: string }> = {
  request: { icon: Send, label: "Request", accent: "text-clay" },
  looper: { icon: Repeat2, label: "Looper", accent: "text-indigo-500" },
  delay: { icon: Timer, label: "Delay", accent: "text-stone" },
  verifier: { icon: ShieldCheck, label: "Verifier", accent: "text-emerald-600" },
};

function StudioNodeShell({ data, selected }: { data: StudioNodeData; selected?: boolean }) {
  const { flowNode, status, requestLabel, requestMissing } = data;
  const meta = TYPE_META[flowNode.type];
  const Icon = meta.icon;

  return (
    <div
      className={`min-w-[190px] max-w-[240px] rounded-xl border bg-cream shadow-sm transition-colors ${
        selected ? "border-clay ring-2 ring-clay/20" : "border-line"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !bg-stone !border-cream" />
      <div className="px-3 py-2 flex items-center gap-2 border-b border-line-soft">
        <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${meta.accent}`} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-stone">{meta.label}</span>
        <span className={`ml-auto h-2.5 w-2.5 rounded-full flex-shrink-0 ${STATUS_DOT[status]}`} title={STATUS_LABEL[status]} />
      </div>
      <div className="px-3 py-2 flex flex-col gap-1">
        <span className="font-mono text-xs font-medium text-ink truncate" title={flowNode.name}>
          {flowNode.name}
        </span>
        {flowNode.type === "delay" ? (
          <span className="text-[11px] text-mute">{(flowNode.config as any).ms} ms</span>
        ) : requestMissing ? (
          <span className="flex items-center gap-1 text-[11px] text-red-600">
            <AlertCircle className="h-3 w-3 flex-shrink-0" />
            {requestLabel || "No request selected"}
          </span>
        ) : (
          <span className="text-[11px] text-mute truncate" title={requestLabel || undefined}>
            {requestLabel}
          </span>
        )}
        {STATUS_LABEL[status] && (
          <span className="text-[10px] text-stone">{STATUS_LABEL[status]}</span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !bg-clay !border-cream" />
    </div>
  );
}

function RequestNode({ data, selected }: NodeProps<StudioNode>) {
  return <StudioNodeShell data={data} selected={selected} />;
}
function LooperNode({ data, selected }: NodeProps<StudioNode>) {
  return <StudioNodeShell data={data} selected={selected} />;
}
function DelayNode({ data, selected }: NodeProps<StudioNode>) {
  return <StudioNodeShell data={data} selected={selected} />;
}
function VerifierNode({ data, selected }: NodeProps<StudioNode>) {
  return <StudioNodeShell data={data} selected={selected} />;
}

export const studioNodeTypes = {
  request: RequestNode,
  looper: LooperNode,
  delay: DelayNode,
  verifier: VerifierNode,
};
