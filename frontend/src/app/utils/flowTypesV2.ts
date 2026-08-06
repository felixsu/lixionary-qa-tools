// API Studio V2 flow data model: a STREAMING dataflow graph.
//
// Unlike V1 (flowTypes.ts — frozen; legacy flows keep running on it), a V2 edge
// does not carry one value: it carries an ordered stream of items terminated by
// an end-of-stream marker (see streamV2.ts). That is why there is no loop
// construct — a loop is just composition:
//
//     ArrayEmit → Request → Accumulator
//
// A data input takes exactly one connection, so a value is never ambiguously
// merged; an output may feed as many inputs as you like, since copying a stream
// to several consumers means only one thing. Nodes with several connected
// inputs pair them positionally (zip), latching any input whose stream turned
// out to be a single value.
//
// This module is the schema owner and the single source of truth for the
// handle-id grammar. It is mirrored by backend/services/flow_runner_v2.py —
// keep the two in sync.
//
// Handle-id grammar (stored on edges as sourceHandle/targetHandle):
//   "in:<name>"   data input   (target handle, left side)
//   "out:<name>"  data output  (source handle, right side)
//   "after"       trigger input  — pure ordering, no data
//   "done"        trigger output — fires once when the node's stream ends
// Config-derived ports use a stable row id inside the name so renaming a
// JSONPath or field never orphans an edge:
//   demux output      "out:o:<rowId>"
//   mux input         "in:i:<rowId>"
//   verify expected   "in:cmp:<checkId>"

import type { Collection } from "../context/AppContext";
import { lookupRequest } from "./flowRunner";
import { scanInputNames } from "./requestTokens";
import type { ComparisonOperator } from "./flowTypes";

export type FlowNodeTypeV2 =
  | "request"
  | "delay"
  | "arrayEmit"
  | "accumulator"
  | "demux"
  | "mux";

export const FLOW_NODE_TYPES_V2: readonly FlowNodeTypeV2[] = [
  "request",
  "delay",
  "arrayEmit",
  "accumulator",
  "demux",
  "mux",
];

export const isKnownNodeTypeV2 = (type: string): type is FlowNodeTypeV2 =>
  (FLOW_NODE_TYPES_V2 as readonly string[]).includes(type);

// A single emitter may release at most this many items in total. Bounds
// runaway HTTP traffic; static arrays are checked at edit time, connected
// streams at run time.
export const EMIT_MAX_ITEMS = 100;

// ---- Handles ----------------------------------------------------------------

export const TRIGGER_IN = "after";
export const TRIGGER_OUT = "done";

export const dataInHandle = (name: string): string => `in:${name}`;
export const dataOutHandle = (name: string): string => `out:${name}`;

export const demuxOutName = (rowId: string): string => `o:${rowId}`;
export const muxInName = (rowId: string): string => `i:${rowId}`;
export const verifyCheckPortName = (checkId: string): string => `cmp:${checkId}`;

export type ParsedHandle =
  | { kind: "data"; direction: "in" | "out"; name: string }
  | { kind: "trigger"; direction: "in" | "out"; name: null };

// The only place handle-id strings are interpreted.
export const parseHandle = (id: string | null | undefined): ParsedHandle | null => {
  if (!id) return null;
  if (id === TRIGGER_IN) return { kind: "trigger", direction: "in", name: null };
  if (id === TRIGGER_OUT) return { kind: "trigger", direction: "out", name: null };
  if (id.startsWith("in:")) return { kind: "data", direction: "in", name: id.slice(3) };
  if (id.startsWith("out:")) return { kind: "data", direction: "out", name: id.slice(4) };
  return null;
};

// ---- Ports ------------------------------------------------------------------

export type PortDataType = "string" | "number" | "boolean" | "array" | "json" | "any";

export interface PortSpec {
  id: string; // handle id, e.g. "in:orderId"
  name: string; // parsed from the handle id — stable, may be an opaque row id
  label?: string; // display text from config (JSONPath, field name, "out 2")
  kind: "data" | "trigger";
  direction: "in" | "out";
  dataType: PortDataType;
  // Inline editor for an unconnected data input; "none" = not hardcodeable.
  widget?: "typed" | "json" | "none";
}

// ---- Hardcoded inputs -------------------------------------------------------

export type StaticInputType = "string" | "number" | "boolean" | "json";

export interface StaticInputV2 {
  type: StaticInputType;
  // Always stored as text; parsed per `type` at run time. May contain
  // {{env.X}} / {{$...}} tokens, which the backend executor resolves.
  value: string;
}

export const emptyStaticInput = (type: StaticInputType = "string"): StaticInputV2 => ({
  type,
  value: "",
});

/** Parses a hardcoded value per its declared type. Tokens are left alone —
 * only the executor can resolve {{env.X}} / {{$...}}. */
export const parseStaticInput = (
  input: StaticInputV2
): { ok: true; value: unknown } | { ok: false; error: string } => {
  const raw = input.value ?? "";
  if (/\{\{/.test(raw)) return { ok: true, value: raw }; // token — resolved downstream
  switch (input.type) {
    case "number": {
      const n = Number(raw.trim());
      if (raw.trim() === "" || !Number.isFinite(n)) return { ok: false, error: `"${raw}" is not a number` };
      return { ok: true, value: n };
    }
    case "boolean": {
      const v = raw.trim().toLowerCase();
      if (v === "true") return { ok: true, value: true };
      if (v === "false") return { ok: true, value: false };
      return { ok: false, error: `"${raw}" is not true or false` };
    }
    case "json":
      try {
        return { ok: true, value: JSON.parse(raw || "null") };
      } catch (e) {
        return { ok: false, error: `invalid JSON (${e instanceof Error ? e.message : String(e)})` };
      }
    default:
      return { ok: true, value: raw };
  }
};

// ---- Node configs -----------------------------------------------------------

export interface VerifyCheckV2 {
  id: string; // stable — becomes port "in:cmp:<id>" when expectedSource is "port"
  path: string; // JSONPath into the response, e.g. "$.status" or "$.body.total"
  operator: ComparisonOperator;
  expectedSource: "static" | "port";
  expected: string; // static text; unused for "port" or the "exists" operator
}

// Folded into request nodes: the standalone verifier node type is gone.
export interface RequestVerifyConfigV2 {
  enabled: boolean;
  checks: VerifyCheckV2[];
  maxAttempts: number; // >= 1
  intervalMs: number; // wait between attempts
}

export interface RequestNodeConfigV2 {
  requestId: string;
  // Hardcoded values for inputs with no incoming edge. Runtime precedence per
  // input: incoming edge > staticInputs[name] > the saved request's binding.
  staticInputs: Record<string, StaticInputV2>;
  verify?: RequestVerifyConfigV2;
}

export interface DelayNodeConfigV2 {
  ms: number;
}

export interface ArrayEmitNodeConfigV2 {
  // Used when "in:array" is unconnected.
  staticItems?: StaticInputV2;
}

export type AccumulatorNodeConfigV2 = Record<string, never>;

export interface DemuxRowV2 {
  id: string;
  path: string; // JSONPath extracted onto this row's output, e.g. "$.color"
}

export interface DemuxNodeConfigV2 {
  rows: DemuxRowV2[];
}

export interface MuxRowV2 {
  id: string;
  field: string; // key this input becomes in the emitted object
}

export interface MuxNodeConfigV2 {
  rows: MuxRowV2[];
  staticInputs?: Record<string, StaticInputV2>; // keyed by muxInName(rowId)
}

export type FlowNodeConfigV2 =
  | RequestNodeConfigV2
  | DelayNodeConfigV2
  | ArrayEmitNodeConfigV2
  | AccumulatorNodeConfigV2
  | DemuxNodeConfigV2
  | MuxNodeConfigV2;

// ---- Graph ------------------------------------------------------------------

export interface FlowNodeV2 {
  id: string;
  // Display/report name. Uniqueness is auto-repaired by the editor on commit.
  name: string;
  type: FlowNodeTypeV2;
  position: { x: number; y: number };
  config: FlowNodeConfigV2;
}

export interface FlowEdgeV2 {
  id: string;
  source: string; // FlowNodeV2.id
  target: string;
  sourceHandle: string; // "out:<name>" | "done"
  targetHandle: string; // "in:<name>" | "after"
  // Optional JSONPath applied to each item before delivery.
  path?: string;
}

export interface FlowV2 {
  id: string;
  cloudId?: string | null;
  name: string;
  description?: string;
  schemaVersion: 2;
  nodes: FlowNodeV2[];
  edges: FlowEdgeV2[];
}

export type AnyFlow = import("./flowTypes").Flow | FlowV2;

export const isFlowV2 = (f: { schemaVersion?: number } | null | undefined): f is FlowV2 =>
  !!f && (f as FlowV2).schemaVersion === 2;

export const edgeKindV2 = (e: Pick<FlowEdgeV2, "sourceHandle" | "targetHandle">): "data" | "trigger" =>
  e.sourceHandle === TRIGGER_OUT || e.targetHandle === TRIGGER_IN ? "trigger" : "data";

// ---- Port derivation --------------------------------------------------------
// Ports are DERIVED from the node type + config + the linked saved request,
// never stored — so editing a saved request surfaces immediately as port drift
// instead of going stale inside the flow blob.

const triggerPorts = (): PortSpec[] => [
  { id: TRIGGER_IN, name: "after", kind: "trigger", direction: "in", dataType: "any" },
  { id: TRIGGER_OUT, name: "done", kind: "trigger", direction: "out", dataType: "any" },
];

const requestDataPorts = (
  requestId: string,
  collections: Collection[]
): { inputs: PortSpec[]; outputs: PortSpec[] } => {
  const req = lookupRequest(collections, requestId);
  if (!req) return { inputs: [], outputs: [] };
  const scanned = scanInputNames({
    url: req.url,
    headers: req.headers || [],
    queryParams: req.queryParams || [],
    body: req.body || "",
    authType: req.authType,
    authConfig: req.authConfig || {},
  });
  const names = [...scanned];
  for (const b of req.inputs || []) if (!names.includes(b.name)) names.push(b.name);
  return {
    inputs: names.map((n) => ({
      id: dataInHandle(n),
      name: n,
      kind: "data",
      direction: "in",
      dataType: "any",
      widget: "typed",
    })),
    outputs: (req.outputs || []).map((o) => ({
      id: dataOutHandle(o),
      name: o,
      kind: "data",
      direction: "out",
      dataType: "any",
    })),
  };
};

export const nodePorts = (node: FlowNodeV2, collections: Collection[]): PortSpec[] => {
  switch (node.type) {
    case "request": {
      const cfg = node.config as RequestNodeConfigV2;
      const { inputs, outputs } = requestDataPorts(cfg.requestId, collections);
      const verify = cfg.verify;
      const checkPorts: PortSpec[] = !verify?.enabled
        ? []
        : (verify.checks || [])
            .filter((c) => c.expectedSource === "port")
            .map((c) => ({
              id: dataInHandle(verifyCheckPortName(c.id)),
              name: verifyCheckPortName(c.id),
              label: `expected: ${c.path || "?"}`,
              kind: "data",
              direction: "in",
              dataType: "any",
              widget: "none",
            }));
      // No "passed" output: an item whose checks never pass is failed and
      // dropped, so such a port could only ever emit `true`.
      return [...triggerPorts(), ...inputs, ...checkPorts, ...outputs];
    }
    case "delay":
      // The passthrough port is what lets a Delay pace a stream (rate limiting);
      // leaving it unconnected keeps the plain "wait once" behavior.
      return [
        ...triggerPorts(),
        { id: dataInHandle("value"), name: "value", kind: "data", direction: "in", dataType: "any", widget: "none" },
        { id: dataOutHandle("value"), name: "value", kind: "data", direction: "out", dataType: "any" },
      ];
    case "arrayEmit":
      return [
        ...triggerPorts(),
        { id: dataInHandle("array"), name: "array", kind: "data", direction: "in", dataType: "array", widget: "json" },
        { id: dataOutHandle("item"), name: "item", kind: "data", direction: "out", dataType: "any" },
        { id: dataOutHandle("index"), name: "index", kind: "data", direction: "out", dataType: "number" },
      ];
    case "accumulator":
      return [
        ...triggerPorts(),
        { id: dataInHandle("item"), name: "item", kind: "data", direction: "in", dataType: "any", widget: "none" },
        { id: dataOutHandle("array"), name: "array", kind: "data", direction: "out", dataType: "array" },
        { id: dataOutHandle("count"), name: "count", kind: "data", direction: "out", dataType: "number" },
      ];
    case "demux": {
      const cfg = node.config as DemuxNodeConfigV2;
      return [
        ...triggerPorts(),
        { id: dataInHandle("object"), name: "object", kind: "data", direction: "in", dataType: "json", widget: "json" },
        ...(cfg.rows || []).map(
          (r): PortSpec => ({
            id: dataOutHandle(demuxOutName(r.id)),
            name: demuxOutName(r.id),
            label: r.path || "(unset)",
            kind: "data",
            direction: "out",
            dataType: "any",
          })
        ),
      ];
    }
    case "mux": {
      const cfg = node.config as MuxNodeConfigV2;
      return [
        ...triggerPorts(),
        ...(cfg.rows || []).map(
          (r): PortSpec => ({
            id: dataInHandle(muxInName(r.id)),
            name: muxInName(r.id),
            label: r.field || "(unset)",
            kind: "data",
            direction: "in",
            dataType: "any",
            widget: "typed",
          })
        ),
        { id: dataOutHandle("object"), name: "object", kind: "data", direction: "out", dataType: "json" },
      ];
    }
  }
};

export const portById = (ports: PortSpec[], handleId: string | null | undefined): PortSpec | undefined =>
  handleId ? ports.find((p) => p.id === handleId) : undefined;

export const portLabel = (port: PortSpec): string => port.label ?? port.name;

// ---- Migration --------------------------------------------------------------

/** Rewrites flows saved before outputs could fan out. A Duplicator was a pure
 * passthrough, so each of its outgoing connections becomes a direct connection
 * from whatever fed it — the graph means exactly the same thing with one fewer
 * block. Called when a flow is loaded and again by both runners, so a stored
 * flow behaves identically whether or not it has been opened since.
 *
 * Also drops any block whose type this version no longer knows. */
export const migrateFlowV2 = (
  nodes: FlowNodeV2[],
  edges: FlowEdgeV2[]
): { nodes: FlowNodeV2[]; edges: FlowEdgeV2[]; changed: number } => {
  const legacy = nodes.filter((n) => !isKnownNodeTypeV2(n.type));
  if (!legacy.length) return { nodes, edges, changed: 0 };

  let nextNodes = nodes;
  let nextEdges = edges;

  for (const node of legacy) {
    const incomingData = nextEdges.find(
      (e) => e.target === node.id && parseHandle(e.targetHandle)?.kind === "data"
    );
    const outgoingData = nextEdges.filter(
      (e) => e.source === node.id && parseHandle(e.sourceHandle)?.kind === "data"
    );
    const rewired: FlowEdgeV2[] = [];

    // Only a passthrough (one data input) can be dissolved into its consumers;
    // anything else just goes away with its connections.
    if (incomingData && (node.type as string) === "duplicator") {
      for (const out of outgoingData) {
        rewired.push({
          id: crypto.randomUUID(),
          source: incomingData.source,
          sourceHandle: incomingData.sourceHandle,
          target: out.target,
          targetHandle: out.targetHandle,
          // Two projections can't be composed into one connection; keep the
          // upstream one and let validation flag it.
          ...(incomingData.path || out.path ? { path: incomingData.path ?? out.path } : {}),
        });
      }
      // `after` gated the passthrough, which gated everything it fed.
      for (const trigger of nextEdges.filter((e) => e.target === node.id && e.targetHandle === TRIGGER_IN)) {
        for (const out of outgoingData) {
          rewired.push({
            id: crypto.randomUUID(),
            source: trigger.source,
            sourceHandle: trigger.sourceHandle,
            target: out.target,
            targetHandle: TRIGGER_IN,
          });
        }
      }
      // A passthrough's stream ends exactly when its source's does.
      for (const trigger of nextEdges.filter((e) => e.source === node.id && e.sourceHandle === TRIGGER_OUT)) {
        rewired.push({
          id: crypto.randomUUID(),
          source: incomingData.source,
          sourceHandle: TRIGGER_OUT,
          target: trigger.target,
          targetHandle: trigger.targetHandle,
        });
      }
    }

    nextNodes = nextNodes.filter((n) => n.id !== node.id);
    nextEdges = [...nextEdges.filter((e) => e.source !== node.id && e.target !== node.id), ...rewired];
  }

  return { nodes: nextNodes, edges: nextEdges, changed: legacy.length };
};

// ---- Validation -------------------------------------------------------------

export interface FlowIssueV2 {
  level: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

// Kahn's over the whole graph — with the loop container gone there is exactly
// one scope, so data and trigger edges share a single cycle check.
const topoCycleV2 = (nodes: FlowNodeV2[], edges: FlowEdgeV2[]): string[] | null => {
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const adjacency = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!inDegree.has(e.source) || !inDegree.has(e.target)) continue;
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    adjacency.get(e.source)!.push(e.target);
  }
  const queue = nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
  const seen: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    seen.push(id);
    for (const next of adjacency.get(id) || []) {
      const d = inDegree.get(next)! - 1;
      inDegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (seen.length !== nodes.length) {
    const seenSet = new Set(seen);
    return nodes.filter((n) => !seenSet.has(n.id)).map((n) => n.name);
  }
  return null;
};

/** Which emitters can drive each node's output stream, propagated to a
 * fixpoint. An empty set means "scalar" (one item). Two different non-empty
 * sets meeting at one node is a likely zip length mismatch — a warning, since
 * only the run can know the real lengths. */
const emitterSets = (nodes: FlowNodeV2[], edges: FlowEdgeV2[]): Map<string, Set<string>> => {
  const sets = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
  const dataEdges = edges.filter((e) => edgeKindV2(e) === "data");
  for (let pass = 0; pass <= nodes.length; pass++) {
    let changed = false;
    for (const node of nodes) {
      // An emitter creates a stream; an accumulator collapses one back to a
      // single value. Everything else inherits from its inputs.
      const next =
        node.type === "arrayEmit"
          ? new Set([node.id])
          : node.type === "accumulator"
            ? new Set<string>()
            : new Set(
                dataEdges
                  .filter((e) => e.target === node.id)
                  .flatMap((e) => Array.from(sets.get(e.source) || []))
              );
      const prev = sets.get(node.id)!;
      if (next.size !== prev.size || [...next].some((v) => !prev.has(v))) {
        sets.set(node.id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return sets;
};

/** Full structural validation. The editor surfaces every issue; both runners
 * call this pre-run and refuse to start on any "error"-level issue. */
export const validateFlowV2 = (flow: FlowV2, collections: Collection[]): FlowIssueV2[] => {
  const issues: FlowIssueV2[] = [];
  const nodeById = new Map(flow.nodes.map((n) => [n.id, n]));
  const portsByNode = new Map(flow.nodes.map((n) => [n.id, nodePorts(n, collections)]));

  const error = (message: string, where: Partial<FlowIssueV2> = {}) =>
    issues.push({ level: "error", message, ...where });
  const warn = (message: string, where: Partial<FlowIssueV2> = {}) =>
    issues.push({ level: "warning", message, ...where });

  // -- nodes --
  const seenNames = new Set<string>();
  for (const node of flow.nodes) {
    if (!node.name) error("A node has no name", { nodeId: node.id });
    else if (seenNames.has(node.name))
      warn(`Duplicate node name "${node.name}" — records will be ambiguous`, { nodeId: node.id });
    else seenNames.add(node.name);

    if (!isKnownNodeTypeV2(node.type)) {
      error(`"${node.name}" has an unsupported type "${node.type}"`, { nodeId: node.id });
      continue;
    }

    const connectedIn = (portName: string) =>
      flow.edges.some((e) => e.target === node.id && e.targetHandle === dataInHandle(portName));

    switch (node.type) {
      case "request": {
        const cfg = node.config as RequestNodeConfigV2;
        if (!cfg.requestId) error(`"${node.name}" has no request selected`, { nodeId: node.id });
        else if (!lookupRequest(collections, cfg.requestId))
          error(`"${node.name}": linked request not found`, { nodeId: node.id });
        const verify = cfg.verify;
        if (verify?.enabled) {
          if (!(verify.checks || []).length)
            error(`"${node.name}": verification is on but has no checks`, { nodeId: node.id });
          if ((verify.maxAttempts || 0) < 1)
            error(`"${node.name}": max attempts must be at least 1`, { nodeId: node.id });
          for (const c of verify.checks || []) {
            if (!c.path.trim()) error(`"${node.name}": a check has no path`, { nodeId: node.id });
            if (c.expectedSource === "port" && !connectedIn(verifyCheckPortName(c.id)))
              error(`"${node.name}": the expected-value port for "${c.path}" is not connected`, {
                nodeId: node.id,
              });
          }
        }
        break;
      }
      case "arrayEmit": {
        const cfg = node.config as ArrayEmitNodeConfigV2;
        if (!connectedIn("array")) {
          const parsed = parseStaticInput(cfg.staticItems || emptyStaticInput("json"));
          if (!parsed.ok || !Array.isArray(parsed.value))
            error(`"${node.name}": connect the array input or provide a static JSON array`, {
              nodeId: node.id,
            });
          else if (parsed.value.length > EMIT_MAX_ITEMS)
            error(
              `"${node.name}" emits ${parsed.value.length} items, over the maximum of ${EMIT_MAX_ITEMS}`,
              { nodeId: node.id }
            );
        }
        break;
      }
      case "demux": {
        const cfg = node.config as DemuxNodeConfigV2;
        const rows = cfg.rows || [];
        if (!rows.length) error(`"${node.name}" has no outputs configured`, { nodeId: node.id });
        const paths = new Set<string>();
        for (const r of rows) {
          if (!r.path.trim()) error(`"${node.name}" has an output with no path`, { nodeId: node.id });
          else if (paths.has(r.path.trim()))
            warn(`"${node.name}" extracts "${r.path}" more than once`, { nodeId: node.id });
          paths.add(r.path.trim());
        }
        break;
      }
      case "mux": {
        const cfg = node.config as MuxNodeConfigV2;
        const rows = cfg.rows || [];
        if (rows.length < 2) error(`"${node.name}" needs at least two inputs`, { nodeId: node.id });
        const fields = new Set<string>();
        for (const r of rows) {
          if (!r.field.trim()) error(`"${node.name}" has an input with no field name`, { nodeId: node.id });
          else if (fields.has(r.field.trim()))
            error(`"${node.name}" uses the field name "${r.field}" twice`, { nodeId: node.id });
          fields.add(r.field.trim());
        }
        break;
      }
      case "accumulator":
      case "delay":
        break;
    }

    // Hardcoded values must parse as their declared type.
    const staticInputs =
      (node.config as { staticInputs?: Record<string, StaticInputV2> }).staticInputs || {};
    for (const [name, input] of Object.entries(staticInputs)) {
      if (!input?.value) continue;
      const parsed = parseStaticInput(input);
      if (!parsed.ok) error(`"${node.name}": input "${name}" — ${parsed.error}`, { nodeId: node.id });
    }
  }

  // -- edges --
  const dataEdgesPerTarget = new Map<string, number>();
  for (const edge of flow.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      error("A connection references a missing node", { edgeId: edge.id });
      continue;
    }

    const srcParsed = parseHandle(edge.sourceHandle);
    const tgtParsed = parseHandle(edge.targetHandle);
    if (!srcParsed || srcParsed.direction !== "out" || !tgtParsed || tgtParsed.direction !== "in") {
      error(`Connection "${source.name}" → "${target.name}" has malformed ports`, { edgeId: edge.id });
      continue;
    }
    if (srcParsed.kind !== tgtParsed.kind) {
      error(
        `Connection "${source.name}" → "${target.name}" joins a ${srcParsed.kind} port to a ${tgtParsed.kind} port`,
        { edgeId: edge.id }
      );
      continue;
    }

    const srcPort = portById(portsByNode.get(source.id)!, edge.sourceHandle);
    const tgtPort = portById(portsByNode.get(target.id)!, edge.targetHandle);
    if (!srcPort)
      error(
        `"${source.name}" has a connection from a missing port "${edge.sourceHandle}" — the saved request may have changed`,
        { edgeId: edge.id }
      );
    if (!tgtPort)
      error(
        `"${target.name}" has a connection into a missing port "${edge.targetHandle}" — the saved request may have changed`,
        { edgeId: edge.id }
      );
    if (!srcPort || !tgtPort) continue;

    // An input takes exactly one connection so a value is never ambiguously
    // merged. Outputs may fan out to as many inputs as they like — each branch
    // receives the same item at the same position.
    if (srcParsed.kind === "data") {
      const tgtKey = `${edge.target} ${edge.targetHandle}`;
      dataEdgesPerTarget.set(tgtKey, (dataEdgesPerTarget.get(tgtKey) || 0) + 1);
      if (dataEdgesPerTarget.get(tgtKey) === 2)
        error(`Input "${portLabel(tgtPort)}" of "${target.name}" has more than one connection`, {
          edgeId: edge.id,
        });
    }
  }

  // -- cycles --
  const cycle = topoCycleV2(flow.nodes, flow.edges);
  if (cycle) error(`Flow contains a cycle involving: ${cycle.join(", ")}`);

  // -- stream-arity heuristic --
  if (!cycle) {
    const sets = emitterSets(flow.nodes, flow.edges);
    const dataEdges = flow.edges.filter((e) => edgeKindV2(e) === "data");
    for (const node of flow.nodes) {
      if (node.type === "accumulator") {
        const incoming = dataEdges.filter((e) => e.target === node.id);
        if (incoming.length && incoming.every((e) => (sets.get(e.source)?.size || 0) === 0))
          warn(`"${node.name}" accumulates a single value — it will emit a one-element array`, {
            nodeId: node.id,
          });
        continue;
      }
      const incomingSets = dataEdges
        .filter((e) => e.target === node.id)
        .map((e) => sets.get(e.source) || new Set<string>())
        .filter((s) => s.size > 0);
      if (incomingSets.length < 2) continue;
      const signatures = new Set(incomingSets.map((s) => [...s].sort().join(",")));
      if (signatures.size > 1)
        warn(
          `"${node.name}" pairs inputs driven by different emitters — their stream lengths must match at run time`,
          { nodeId: node.id }
        );
    }
  }

  return issues;
};

export const flowErrorsV2 = (issues: FlowIssueV2[]): FlowIssueV2[] => issues.filter((i) => i.level === "error");

// ---- Defaults ---------------------------------------------------------------

export const defaultConfigForTypeV2 = (type: FlowNodeTypeV2): FlowNodeConfigV2 => {
  switch (type) {
    case "request":
      return { requestId: "", staticInputs: {} };
    case "delay":
      return { ms: 1000 };
    case "arrayEmit":
      return { staticItems: { type: "json", value: "[]" } };
    case "accumulator":
      return {};
    case "demux":
      return { rows: [{ id: crypto.randomUUID(), path: "$." }] };
    case "mux":
      return {
        rows: [
          { id: crypto.randomUUID(), field: "field1" },
          { id: crypto.randomUUID(), field: "field2" },
        ],
      };
  }
};

export const defaultVerifyConfig = (): RequestVerifyConfigV2 => ({
  enabled: true,
  checks: [{ id: crypto.randomUUID(), path: "$.status", operator: "equals", expectedSource: "static", expected: "200" }],
  maxAttempts: 3,
  intervalMs: 1000,
});
