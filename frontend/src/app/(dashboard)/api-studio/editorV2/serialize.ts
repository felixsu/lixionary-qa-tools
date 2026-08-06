// Boundary between the domain model (flowTypesV2) and React Flow state.
// Edges MUST round-trip sourceHandle/targetHandle (they carry the data
// bindings) and their optional JSONPath projection.

import type { Edge, Node } from "@xyflow/react";
import type { Collection } from "../../../context/AppContext";
import { lookupRequest, type NodeRunStatus } from "../../../utils/flowRunner";
import {
  edgeKindV2,
  nodePorts,
  type FlowEdgeV2,
  type FlowNodeV2,
  type FlowNodeTypeV2,
  type PortSpec,
  type RequestNodeConfigV2,
} from "../../../utils/flowTypesV2";

export interface StudioNodeDataV2 extends Record<string, unknown> {
  flowNode: FlowNodeV2;
  status: NodeRunStatus;
  requestLabel: string | null;
  requestMissing: boolean;
  ports: PortSpec[];
  // "item 3" / "3/10" while a stream is flowing through this node.
  streamBadge?: string | null;
  // How many items failed here, shown alongside a "partial" status.
  failedItems?: number;
}

export type StudioNodeV2 = Node<StudioNodeDataV2>;

// React Flow node-type registry keys (see nodes.tsx).
export const RF_TYPE: Record<FlowNodeTypeV2, string> = {
  request: "v2request",
  delay: "v2delay",
  arrayEmit: "v2arrayEmit",
  accumulator: "v2accumulator",
  demux: "v2demux",
  mux: "v2mux",
};

export const decorateV2 = (
  fn: FlowNodeV2,
  status: NodeRunStatus,
  collections: Collection[]
): StudioNodeDataV2 => {
  const ports = nodePorts(fn, collections);
  if (fn.type !== "request") {
    return { flowNode: fn, status, requestLabel: null, requestMissing: false, ports };
  }
  const cfg = fn.config as RequestNodeConfigV2;
  if (!cfg.requestId) {
    return { flowNode: fn, status, requestLabel: "No request selected", requestMissing: true, ports };
  }
  const req = lookupRequest(collections, cfg.requestId);
  if (!req) {
    return { flowNode: fn, status, requestLabel: "Linked request not found", requestMissing: true, ports };
  }
  return { flowNode: fn, status, requestLabel: `${req.method} ${req.name}`, requestMissing: false, ports };
};

export const toStudioNodeV2 = (
  fn: FlowNodeV2,
  status: NodeRunStatus,
  collections: Collection[]
): StudioNodeV2 => ({
  id: fn.id,
  type: RF_TYPE[fn.type],
  position: fn.position,
  data: decorateV2(fn, status, collections),
});

export const toStudioNodesV2 = (
  flowNodes: FlowNodeV2[],
  statusOf: (nodeId: string) => NodeRunStatus,
  collections: Collection[]
): StudioNodeV2[] => flowNodes.map((fn) => toStudioNodeV2(fn, statusOf(fn.id), collections));

export const serializeNodesV2 = (nodes: StudioNodeV2[]): FlowNodeV2[] =>
  nodes.map((n) => ({
    ...n.data.flowNode,
    position: { x: n.position.x, y: n.position.y },
  }));

// ---- edges ------------------------------------------------------------------

const DATA_EDGE_STYLE: React.CSSProperties = { strokeWidth: 1.75 };
const TRIGGER_EDGE_STYLE: React.CSSProperties = {
  strokeWidth: 1.25,
  strokeDasharray: "6 4",
  stroke: "#a8a29e",
};

export const styleForEdge = (e: Pick<FlowEdgeV2, "sourceHandle" | "targetHandle">): React.CSSProperties =>
  edgeKindV2(e) === "trigger" ? TRIGGER_EDGE_STYLE : DATA_EDGE_STYLE;

/** What a React Flow edge carries in `data` for V2 flows. */
export interface EdgeDataV2 extends Record<string, unknown> {
  path?: string;
}

export const toRfEdgeV2 = (e: FlowEdgeV2): Edge => ({
  id: e.id,
  source: e.source,
  target: e.target,
  sourceHandle: e.sourceHandle,
  targetHandle: e.targetHandle,
  data: { path: e.path },
  style: styleForEdge(e),
});

export const serializeEdgesV2 = (edges: Edge[]): FlowEdgeV2[] =>
  edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle || "",
    targetHandle: e.targetHandle || "",
    ...((e.data as EdgeDataV2 | undefined)?.path ? { path: String((e.data as EdgeDataV2).path) } : {}),
  }));

// Dirty-tracking signature (positions rounded, like the legacy editor).
export const flowSignatureV2 = (nodes: FlowNodeV2[], edges: FlowEdgeV2[]): string =>
  JSON.stringify({
    nodes: nodes.map((n) => ({
      ...n,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    })),
    edges,
  });
