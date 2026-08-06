"use client";

// V2 node components: ComfyUI-style cards with one handle per port.
//
//   ◇after  [icon] name  ●status  done◇     <- trigger diamonds in the header
//   ●─ input   [typed widget | ⟵ chip]      <- one row per data input
//                          output ─●        <- one row per data output
//
// Every card is the same shell over a derived PortSpec[] (flowTypesV2.nodePorts),
// so nodes whose ports come from config — mapper rows, mux rows, duplicator
// count — need no bespoke rendering, and React Flow's handle cache is
// refreshed generically whenever that port list changes.

import React, { createContext, memo, useContext, useEffect, useMemo } from "react";
import { Handle, Position, useEdges, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { AlertCircle, Combine, Layers, Rows3, Send, ShieldCheck, Split, Timer, Wand2 } from "lucide-react";
import type { NodeRunStatus } from "../../../utils/flowRunner";
import {
  parseHandle,
  portLabel,
  TRIGGER_IN,
  TRIGGER_OUT,
  type PortSpec,
  type GeneratorNodeConfigV2,
  type RequestNodeConfigV2,
  type StaticInputType,
  type StaticInputV2,
} from "../../../utils/flowTypesV2";
import type { EdgeDataV2, StudioNodeDataV2, StudioNodeV2 } from "./serialize";

// Node cards live outside the editor's component tree, so edits flow through
// this context instead of prop drilling from EditorV2.
export interface NodeActions {
  setStaticInput: (nodeId: string, inputName: string, patch: Partial<StaticInputV2>) => void;
}
export const NodeActionsContext = createContext<NodeActions>({ setStaticInput: () => {} });

const STATUS_DOT: Record<NodeRunStatus, string> = {
  idle: "bg-stone/40",
  pending: "bg-stone/40",
  running: "bg-clay animate-pulse",
  success: "bg-emerald-500",
  partial: "bg-orange-500",
  failed: "bg-red-500",
  skipped: "bg-amber-400",
};

const dataHandleCls =
  "!h-[10px] !w-[10px] !rounded-full !border-2 !border-cream !bg-clay hover:!bg-clay-dark";
const triggerHandleCls =
  "!h-[8px] !w-[8px] !rotate-45 !rounded-[2px] !border !border-cream !bg-stone hover:!bg-graphite";
const missingHandleCls =
  "!h-[10px] !w-[10px] !rounded-full !border-2 !border-cream !bg-red-500";

const connectionTitle = (sourceName: string | null | undefined, path: string | undefined): string =>
  `Connected to ${sourceName ?? "an output"}${path ? ` · path ${path}` : ""}`;

const TYPE_OPTIONS: StaticInputType[] = ["string", "number", "boolean", "json"];

// ---- port rows ---------------------------------------------------------------

function TypedValueWidget({
  nodeId,
  portName,
  input,
}: {
  nodeId: string;
  portName: string;
  input: StaticInputV2;
}) {
  const actions = useContext(NodeActionsContext);
  const set = (patch: Partial<StaticInputV2>) => actions.setStaticInput(nodeId, portName, patch);

  return (
    <span className="ml-auto flex items-center gap-1">
      {/* A native select keeps the control small enough for a 240px card;
          the app's Dropdown renders a full-width floating panel. */}
      <select
        value={input.type}
        onChange={(e) => set({ type: e.target.value as StaticInputType })}
        className="nodrag nopan h-[20px] rounded border border-line bg-cream px-0.5 text-[9px] text-stone outline-none focus:border-clay"
        title="Value type"
      >
        {TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {input.type === "boolean" ? (
        <select
          value={input.value || "false"}
          onChange={(e) => set({ value: e.target.value })}
          className="nodrag nopan h-[20px] w-[58px] rounded border border-line bg-cream px-1 font-mono text-[10px] text-graphite outline-none focus:border-clay"
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input
          value={input.value}
          onChange={(e) => set({ value: e.target.value })}
          inputMode={input.type === "number" ? "numeric" : undefined}
          placeholder={input.type === "json" ? "{ }" : "value…"}
          className="nodrag nopan h-[20px] w-[76px] rounded border border-line bg-cream px-1.5 font-mono text-[10px] text-graphite outline-none focus:border-clay"
        />
      )}
    </span>
  );
}

function InputPortRow({
  nodeId,
  port,
  staticInput,
  latched,
}: {
  nodeId: string;
  port: PortSpec;
  staticInput: StaticInputV2 | undefined;
  latched?: boolean;
}) {
  const edges = useEdges();
  const incoming = edges.find((e) => e.target === nodeId && e.targetHandle === port.id);
  const sourcePort = incoming ? parseHandle(incoming.sourceHandle) : null;

  return (
    <div className="relative flex items-center gap-2 px-3 py-1 min-h-[26px]">
      <Handle id={port.id} type="target" position={Position.Left} className={dataHandleCls} style={{ left: -5 }} />
      <span className="font-mono text-[10px] text-graphite flex-shrink-0 max-w-[92px] truncate" title={portLabel(port)}>
        {portLabel(port)}
      </span>
      {incoming ? (
        <>
          {latched && (
            <span
              className="flex-shrink-0 rounded bg-clay/10 px-1 py-0.5 text-[9px] text-clay"
              title="One value arrived here and was reused for every item of the other inputs"
            >
              reused
            </span>
          )}
          <span
            className="ml-auto max-w-[110px] truncate rounded bg-clay/10 px-1.5 py-0.5 font-mono text-[9px] text-clay"
            title={connectionTitle(sourcePort?.name, (incoming.data as EdgeDataV2 | undefined)?.path)}
          >
            ⟵ {sourcePort?.name || "connected"}
          </span>
        </>
      ) : port.widget === "typed" ? (
        <TypedValueWidget nodeId={nodeId} portName={port.name} input={staticInput || { type: "string", value: "" }} />
      ) : (
        <span className="ml-auto font-mono text-[9px] text-mute">—</span>
      )}
    </div>
  );
}

function OutputPortRow({ port }: { port: PortSpec }) {
  return (
    <div className="relative flex items-center justify-end px-3 py-1 min-h-[22px]">
      <span className="font-mono text-[10px] text-graphite max-w-[150px] truncate" title={portLabel(port)}>
        {portLabel(port)}
      </span>
      <Handle id={port.id} type="source" position={Position.Right} className={dataHandleCls} style={{ right: -5 }} />
    </div>
  );
}

// Anchors a connection whose port vanished from the saved request — without a
// handle React Flow silently hides the edge and the drift becomes invisible.
function MissingPortRow({ handleId, direction }: { handleId: string; direction: "in" | "out" }) {
  const parsed = parseHandle(handleId);
  return (
    <div className={`relative flex items-center gap-1.5 px-3 py-1 min-h-[22px] ${direction === "out" ? "justify-end" : ""}`}>
      {direction === "in" && (
        <Handle id={handleId} type="target" position={Position.Left} className={missingHandleCls} style={{ left: -5 }} />
      )}
      <AlertCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
      <span className="font-mono text-[10px] text-red-600 line-through">{parsed?.name || handleId}</span>
      {direction === "out" && (
        <Handle id={handleId} type="source" position={Position.Right} className={missingHandleCls} style={{ right: -5 }} />
      )}
    </div>
  );
}

const useMissingHandles = (nodeId: string, ports: PortSpec[]) => {
  const edges = useEdges();
  return useMemo(() => {
    const known = new Set(ports.map((p) => p.id));
    const missingIn = new Set<string>();
    const missingOut = new Set<string>();
    for (const e of edges) {
      if (e.target === nodeId && e.targetHandle && !known.has(e.targetHandle)) missingIn.add(e.targetHandle);
      if (e.source === nodeId && e.sourceHandle && !known.has(e.sourceHandle)) missingOut.add(e.sourceHandle);
    }
    return { missingIn: [...missingIn], missingOut: [...missingOut] };
  }, [edges, nodeId, ports]);
};

// ---- shell -------------------------------------------------------------------

function NodeShellV2({
  id,
  data,
  selected,
  icon: Icon,
  typeLabel,
  subtitle,
}: {
  id: string;
  data: StudioNodeDataV2;
  selected?: boolean;
  icon: typeof Send;
  typeLabel: string;
  subtitle?: string | null;
}) {
  const updateNodeInternals = useUpdateNodeInternals();
  const inputs = data.ports.filter((p) => p.kind === "data" && p.direction === "in");
  const outputs = data.ports.filter((p) => p.kind === "data" && p.direction === "out");
  const { missingIn, missingOut } = useMissingHandles(id, data.ports);

  // React Flow caches handle positions — refresh whenever the port list changes
  // (a request re-picked, a mapper/mux row added, the duplicator count edited).
  const portsSignature = [...data.ports.map((p) => p.id), ...missingIn, ...missingOut].join("|");
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, portsSignature, updateNodeInternals]);

  const staticInputs =
    ((data.flowNode.config as { staticInputs?: Record<string, StaticInputV2> }).staticInputs) || {};
  const verifying = (data.flowNode.config as RequestNodeConfigV2).verify?.enabled;

  return (
    <div
      className={`w-[240px] rounded-xl border bg-cream shadow-sm transition-colors ${
        selected ? "border-clay" : data.requestMissing ? "border-red-300" : "border-line"
      }`}
    >
      <div className="relative flex items-center gap-2 rounded-t-xl border-b border-line bg-panel px-3 py-2">
        <Handle id={TRIGGER_IN} type="target" position={Position.Left} className={triggerHandleCls} style={{ left: -4 }} title="after — start once these finish (no data)" />
        <Icon className="h-3.5 w-3.5 text-clay flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-ink">{data.flowNode.name}</div>
          <div className="text-[9px] uppercase tracking-wide text-stone">{typeLabel}</div>
        </div>
        {verifying && <ShieldCheck className="h-3 w-3 flex-shrink-0 text-clay" aria-label="verifies its response" />}
        {data.streamBadge && (
          <span className="flex-shrink-0 rounded bg-clay/10 px-1 py-0.5 font-mono text-[9px] text-clay">
            {data.streamBadge}
          </span>
        )}
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT[data.status]}`} title={data.status} />
        <Handle id={TRIGGER_OUT} type="source" position={Position.Right} className={triggerHandleCls} style={{ right: -4 }} title="done — fires when this node's stream ends" />
      </div>

      {(subtitle || data.requestLabel) && (
        <div className={`truncate px-3 py-1 font-mono text-[10px] ${data.requestMissing ? "text-red-600" : "text-mute"}`}>
          {subtitle ?? data.requestLabel}
        </div>
      )}
      {data.status === "partial" && !!data.failedItems && (
        <div className="px-3 pb-1 text-[10px] text-orange-600">{data.failedItems} item(s) failed</div>
      )}

      {(inputs.length > 0 || missingIn.length > 0) && (
        <div className="border-b border-line/60 py-0.5">
          {inputs.map((p) => (
            <InputPortRow
              key={p.id}
              nodeId={id}
              port={p}
              staticInput={staticInputs[p.name]}
              latched={(data.latchedInputs || []).includes(p.name)}
            />
          ))}
          {missingIn.map((h) => (
            <MissingPortRow key={h} handleId={h} direction="in" />
          ))}
        </div>
      )}
      {(outputs.length > 0 || missingOut.length > 0) && (
        <div className="py-0.5">
          {outputs.map((p) => (
            <OutputPortRow key={p.id} port={p} />
          ))}
          {missingOut.map((h) => (
            <MissingPortRow key={h} handleId={h} direction="out" />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- registry ----------------------------------------------------------------

// Every card is the same shell differing only in icon and labels; the inner
// component is named so React DevTools (and the display-name lint rule) see it.
const shell = (
  displayName: string,
  icon: typeof Send,
  typeLabel: (data: StudioNodeDataV2) => string,
  subtitle?: (data: StudioNodeDataV2) => string | null
) => {
  const Card = ({ id, data, selected }: NodeProps<StudioNodeV2>) => (
    <NodeShellV2
      id={id}
      data={data}
      selected={selected}
      icon={icon}
      typeLabel={typeLabel(data)}
      subtitle={subtitle?.(data)}
    />
  );
  Card.displayName = displayName;
  return memo(Card);
};

const RequestNodeV2 = shell("RequestNodeV2", Send, () => "request");
const DelayNodeV2 = shell("DelayNodeV2", Timer, (d) => `delay · ${(d.flowNode.config as { ms?: number }).ms ?? 0} ms`);
const ArrayEmitNodeV2 = shell(
  "ArrayEmitNodeV2",
  Rows3,
  () => "array emit",
  (d) => {
    const items = (d.flowNode.config as { staticItems?: StaticInputV2 }).staticItems;
    if (!items?.value) return null;
    if (items.type === "number") return `repeat × ${items.value}`;
    return `static ${items.value.slice(0, 28)}${items.value.length > 28 ? "…" : ""}`;
  }
);
const AccumulatorNodeV2 = shell("AccumulatorNodeV2", Layers, () => "accumulator");
const MapperNodeV2 = shell("MapperNodeV2", Split, () => "mapper · split");
const MuxNodeV2 = shell("MuxNodeV2", Combine, () => "mux · combine");
const GeneratorNodeV2 = shell(
  "GeneratorNodeV2",
  Wand2,
  () => "generator",
  (d) => (d.flowNode.config as GeneratorNodeConfigV2).token || null
);

export const studioNodeTypesV2 = {
  v2request: RequestNodeV2,
  v2delay: DelayNodeV2,
  v2arrayEmit: ArrayEmitNodeV2,
  v2accumulator: AccumulatorNodeV2,
  v2mapper: MapperNodeV2,
  v2generator: GeneratorNodeV2,
  v2mux: MuxNodeV2,
};
