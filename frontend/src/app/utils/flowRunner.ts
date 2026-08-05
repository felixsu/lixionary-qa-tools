// API Studio client-side flow orchestrator: schedules the graph as a parallel
// wavefront — every root (in-degree 0) node starts immediately, all outgoing
// edges fan out concurrently, and a node with multiple incoming edges waits
// until every predecessor has succeeded (implicit merge). Nodes execute
// request/looper/delay/verifier work against the local sidecar's
// POST /api/executor/run endpoint and feed their outputs into downstream
// input mappings. A failure skips only the failed node's descendants;
// independent branches run to completion.

import type { Collection, RequestItem, InputBinding } from "../context/AppContext";
import { findRequestInTree } from "../context/AppContext";
import type {
  Flow,
  FlowNode,
  FlowEdge,
  RequestNodeConfig,
  LooperNodeConfig,
  DelayNodeConfig,
  VerifierNodeConfig,
  VerifierComparison,
} from "./flowTypes";

// "partial" is V2-only: a streaming node that finished with some items failed.
export type NodeRunStatus =
  | "idle"
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "partial";

export interface RunRecord {
  nodeId: string;
  nodeName: string;
  // V1 FlowNodeType or V2 FlowNodeTypeV2 (plain string keeps the two models decoupled).
  nodeType: string;
  iteration?: number; // looper/loop, 0-based
  attempt?: number; // verifier, 1-based
  scope?: string; // V2 loop-body records: "loopName[2]"
  parentNodeId?: string; // V2 loop-body records: the containing loop node's id
  status: "success" | "failed" | "skipped";
  resolvedInputs: Record<string, string>;
  outputs: Record<string, any> | null;
  requestPayload: Record<string, any> | null; // exact /api/executor/run body
  response: { status: number; statusText: string; headers: Record<string, string>; body: any } | null;
  testResults?: { name: string; passed: boolean }[] | null;
  testError?: string | null;
  error?: string;
  startedAt: string; // ISO
  durationMs: number;
}

export interface FlowRunDeps {
  apiCall: (path: string, options?: RequestInit) => Promise<any>;
  collections: Collection[];
  environmentId: string | null; // selectedEnvId — the sidecar resolves local or cloud ids
}

export interface FlowRunCallbacks {
  onNodeStatus: (nodeId: string, status: NodeRunStatus) => void;
  onRecord: (record: RunRecord) => void;
}

export interface FlowRunSummary {
  status: "success" | "failed" | "cancelled";
  records: RunRecord[]; // resume runs: records of the re-run nodes only (see mergeRetrySummary)
  startedAt: string;
  durationMs: number;
  // Resume metadata — absent on runs persisted before the Retry feature, in
  // which case Retry is unavailable for that stored run.
  context?: RunContext; // final published outputs, incl. entries seeded from a resume
  nodeStatuses?: Record<string, "success" | "failed" | "skipped" | "partial">;
  // V2 streaming runs: per-node item tallies (absent on V1 runs).
  nodeItemCounts?: Record<string, { ok: number; failed: number; skipped: number }>;
  runSignature?: string; // structuralSignature of the graph that ran
  contextTruncated?: boolean; // set only by persistLastRun when context was too large to store
}

// Prior successful state fed back into runFlow to re-run only what failed.
export interface ResumeState {
  context: RunContext; // published outputs of the prior run's successful nodes
  completedNodeIds: string[]; // nodes to treat as already-succeeded (never re-executed)
}

export interface RunHandle {
  cancel: () => void;
  done: Promise<FlowRunSummary>;
}

// Kahn's algorithm. Used for cycle detection (validation and the pre-run
// check); execution itself is scheduled by the wavefront runner in runFlow.
export function topoSort(nodes: FlowNode[], edges: FlowEdge[]): { order: string[] } | { cycle: string[] } {
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const adjacency = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!inDegree.has(e.source) || !inDegree.has(e.target)) continue; // dangling edge
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    adjacency.get(e.source)!.push(e.target);
  }
  const queue = nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adjacency.get(id) || []) {
      const d = inDegree.get(next)! - 1;
      inDegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (order.length !== nodes.length) {
    return { cycle: nodes.filter((n) => !order.includes(n.id)).map((n) => n.name) };
  }
  return { order };
}

// Structure-only fingerprint of a flow graph: node ids/names/types/configs and
// edge pairs, order- and position-insensitive. Used to gate "Retry from
// failed" — a node drag must not invalidate a stored run, an edit to the
// graph must. Deliberately excludes the linked collection requests and the
// environment: a retry re-resolves those live, like any run.
export const structuralSignature = (nodes: FlowNode[], edges: FlowEdge[]): string =>
  JSON.stringify({
    nodes: [...nodes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, name, type, config }) => ({ id, name, type, config })),
    edges: edges
      .map(({ source, target }) => ({ source, target }))
      .sort((a, b) => (a.source + "\u0000" + a.target).localeCompare(b.source + "\u0000" + b.target)),
  });

// Upstream results: nodeName -> published outputs object.
export type RunContext = Record<string, Record<string, any>>;

// Walk a dot-path ("node.out.a.0.b") through the run context / an object.
// A "*" segment projects over an array: "loop.results.*.uuid" collects the
// uuid of every iteration into a flat array (elements that don't resolve are
// dropped, JSONPath-style). Wildcards nest.
export const walkPath = (root: any, segments: string[]): any => {
  let cur = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (cur === null || cur === undefined) return undefined;
    // JSON-string leaves (e.g. an output that stringified an object) are
    // transparently parsed so paths can continue into them.
    if (typeof cur === "string") {
      try {
        cur = JSON.parse(cur);
      } catch {
        return undefined;
      }
    }
    if (seg === "*") {
      if (!Array.isArray(cur)) return undefined;
      const rest = segments.slice(i + 1);
      return cur
        .map((el) => (rest.length ? walkPath(el, rest) : el))
        .filter((v) => v !== undefined);
    }
    cur = cur?.[seg];
  }
  return cur;
};

export const resolveReference = (
  reference: string,
  ctx: RunContext,
  iterationItem?: any
): { found: boolean; value: any } => {
  const segments = reference.split(".").map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return { found: false, value: undefined };
  const [head, ...rest] = segments;
  let root: any;
  if (head === "item") {
    if (iterationItem === undefined) return { found: false, value: undefined };
    root = iterationItem;
  } else if (ctx[head] !== undefined) {
    root = ctx[head];
  } else {
    return { found: false, value: undefined };
  }
  const value = rest.length ? walkPath(root, rest) : root;
  return { found: value !== undefined, value };
};

export const stringifyValue = (value: any): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

// Replace {{node.path}} / {{item.path}} tokens in static values. Tokens whose
// first segment is not a known node name (or "item") — e.g. {{env.X}},
// {{$date}}, plain request inputs — are left untouched for the backend.
export const interpolateStudioTokens = (text: string, ctx: RunContext, iterationItem?: any): string => {
  if (!text) return text;
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key: string) => {
    if (key.startsWith("$") || key.startsWith("env.")) return match;
    const head = key.split(".")[0].trim();
    if (head !== "item" && ctx[head] === undefined) return match;
    const { found, value } = resolveReference(key, ctx, iterationItem);
    return found ? stringifyValue(value) : match;
  });
};

const findRequest = (collections: Collection[], requestId: string): RequestItem | null => {
  for (const col of collections) {
    const req = findRequestInTree(col, requestId);
    if (req) return req;
  }
  return null;
};

export interface ExecutionResult {
  ok: boolean;
  error?: string;
  resolvedInputs: Record<string, string>;
  requestPayload: Record<string, any> | null;
  response: RunRecord["response"];
  outputs: Record<string, any>;
  raw: any | null; // full executor result
}

export class FlowCancelledError extends Error {
  constructor() {
    super("Run cancelled");
  }
}

export interface RunState {
  cancelled: boolean;
  abort: AbortController;
  wakers: Set<() => void>;
}

export const cancellableDelay = (ms: number, state: RunState): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.wakers.delete(wake);
      resolve();
    }, ms);
    const wake = () => {
      clearTimeout(timer);
      reject(new FlowCancelledError());
    };
    state.wakers.add(wake);
  });

// Run a saved request once via /api/executor/run with fully-resolved input
// bindings. Shared by the V1 mapping resolver below and the V2 port-based
// engine (flowRunnerV2.ts).
export const executeResolvedRequest = async (
  request: RequestItem,
  bindings: Map<string, InputBinding>,
  resolvedInputs: Record<string, string>,
  deps: FlowRunDeps,
  state: RunState
): Promise<ExecutionResult> => {
  const empty: ExecutionResult = {
    ok: false,
    resolvedInputs,
    requestPayload: null,
    response: null,
    outputs: {},
    raw: null,
  };

  // Auth parity with the API Explorer: HOOK auth is kept user-local — the
  // shared collection stores authFunctionId as null and the real binding
  // lives in a device-local pref (see handleSaveRequest / the hydration
  // effect in AppContext). Apply the same per-device override here.
  let authType = request.authType;
  let authConfig = request.authConfig || {};
  try {
    const res = await deps.apiCall(`/api/local-store/pref/${encodeURIComponent(`auth_override:${request.id}`)}`);
    if (res?.value) {
      const parsed = JSON.parse(res.value);
      authType = parsed.authType ?? authType;
      authConfig = parsed.authConfig ?? authConfig;
    }
  } catch {
    // pref unavailable / malformed override — fall back to the saved values
  }

  const payload = {
    requestId: request.id,
    method: request.method,
    url: request.url,
    headers: (request.headers || []).filter((h) => h.key !== ""),
    queryParams: (request.queryParams || []).filter((p) => p.key !== ""),
    bodyType: request.bodyType,
    body: request.body,
    authType,
    authConfig: {
      token: authConfig?.token,
      key: authConfig?.key,
      value: authConfig?.value,
      authFunctionId: authConfig?.authFunctionId ?? null,
      tokenField: authConfig?.tokenField,
    },
    responseParserScript: request.responseParserScript || "",
    requestInterceptorScript: request.requestInterceptorScript || "",
    testScript: request.testScript || "",
    inputs: Array.from(bindings.values()),
    outputs: request.outputs || [],
    environmentId: deps.environmentId,
  };

  let result: any;
  try {
    result = await deps.apiCall("/api/executor/run", {
      method: "POST",
      body: JSON.stringify(payload),
      signal: state.abort.signal,
    });
  } catch (e: any) {
    if (state.cancelled) throw new FlowCancelledError();
    return { ...empty, resolvedInputs, requestPayload: payload, error: e.message || "Request failed" };
  }
  if (state.cancelled) throw new FlowCancelledError();

  const response = {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers || {},
    body: result.body,
  };
  const outputs = result.outputs || {};
  const missing: string[] = result.missingOutputs || [];

  let error: string | undefined;
  if (result.status >= 400) {
    error = `HTTP ${result.status} ${result.statusText || ""}`.trim();
  } else if (result.parserError) {
    error = `Parser error: ${result.parserError}`;
  } else if (missing.length) {
    error = `Missing declared outputs: ${missing.join(", ")}`;
  }

  return {
    ok: !error,
    error,
    resolvedInputs,
    requestPayload: payload,
    response,
    outputs,
    raw: result,
  };
};

// Resolve V1 mappings + run the linked request once via /api/executor/run.
const executeRequestConfig = async (
  cfg: RequestNodeConfig,
  ctx: RunContext,
  deps: FlowRunDeps,
  state: RunState,
  iterationItem?: any
): Promise<ExecutionResult> => {
  const fail = (error: string): ExecutionResult => ({
    ok: false,
    error,
    resolvedInputs: {},
    requestPayload: null,
    response: null,
    outputs: {},
    raw: null,
  });

  const request = findRequest(deps.collections, cfg.requestId);
  if (!request) {
    return fail(cfg.requestId ? "Linked request not found" : "No request selected");
  }

  // Start from the request's own stored bindings; flow mappings override.
  const bindings = new Map<string, InputBinding>();
  for (const b of request.inputs || []) bindings.set(b.name, b);

  const resolvedInputs: Record<string, string> = {};
  for (const mapping of cfg.mappings || []) {
    if (!mapping.inputName) continue;
    let value: string;
    if (mapping.source === "reference") {
      const { found, value: refValue } = resolveReference(mapping.value, ctx, iterationItem);
      if (!found) {
        return fail(`Reference "${mapping.value}" not found for input "${mapping.inputName}"`);
      }
      value = stringifyValue(refValue);
    } else {
      value = interpolateStudioTokens(mapping.value, ctx, iterationItem);
    }
    bindings.set(mapping.inputName, { name: mapping.inputName, source: "literal", value });
    resolvedInputs[mapping.inputName] = value;
  }

  return executeResolvedRequest(request, bindings, resolvedInputs, deps, state);
};

// Structurally typed on the node so V2 nodes work too; exported for flowRunnerV2.
export const makeRecord = (
  node: { id: string; name: string; type: string },
  exec: ExecutionResult | null,
  status: RunRecord["status"],
  startedAt: string,
  durationMs: number,
  extra?: Partial<RunRecord>
): RunRecord => ({
  nodeId: node.id,
  nodeName: node.name,
  nodeType: node.type,
  status,
  resolvedInputs: exec?.resolvedInputs || {},
  outputs: exec ? exec.outputs : null,
  requestPayload: exec?.requestPayload || null,
  response: exec?.response || null,
  testResults: exec?.raw?.testResults ?? null,
  testError: exec?.raw?.testError ?? null,
  error: exec?.error,
  startedAt,
  durationMs,
  ...extra,
});

const evaluateComparison = (
  comparison: VerifierComparison,
  exec: ExecutionResult,
  ctx: RunContext
): { pass: boolean; actual: any; detail: string } => {
  const segments = comparison.field.split(".").map((s) => s.trim()).filter(Boolean);
  let actual: any;
  if (segments[0] === "status") {
    actual = exec.response?.status;
  } else if (segments[0] === "body") {
    actual = walkPath(exec.response?.body, segments.slice(1));
  } else if (segments[0] === "outputs") {
    actual = walkPath(exec.outputs, segments.slice(1));
  } else {
    actual = walkPath(exec.outputs, segments);
  }

  let expected: any = comparison.expected;
  if (comparison.expectedSource === "reference") {
    const resolved = resolveReference(comparison.expected, ctx);
    expected = resolved.found ? resolved.value : undefined;
  }

  const bothNumeric =
    actual !== null && actual !== undefined && actual !== "" &&
    Number.isFinite(Number(actual)) && Number.isFinite(Number(expected));

  let pass: boolean;
  switch (comparison.operator) {
    case "exists":
      pass = actual !== undefined && actual !== null;
      break;
    case "equals":
      pass = bothNumeric ? Number(actual) === Number(expected) : String(actual) === String(expected);
      break;
    case "not_equals":
      pass = bothNumeric ? Number(actual) !== Number(expected) : String(actual) !== String(expected);
      break;
    case "contains":
      pass = Array.isArray(actual)
        ? actual.some((v) => String(v) === String(expected))
        : String(actual ?? "").includes(String(expected ?? ""));
      break;
    case "greater_than":
      pass = bothNumeric && Number(actual) > Number(expected);
      break;
    case "less_than":
      pass = bothNumeric && Number(actual) < Number(expected);
      break;
  }

  const detail = `${comparison.field} ${comparison.operator} ${comparison.operator === "exists" ? "" : JSON.stringify(String(expected))} — actual: ${stringifyValue(actual) || "<missing>"} ${pass ? "✓" : "✗"}`;
  return { pass, actual, detail };
};

// Execute one node to completion. Per-iteration looper records, per-attempt
// verifier records, and the node's terminal status are emitted here. Returns
// whether the node succeeded and the outputs object to publish under the
// node's name (null = nothing to publish). Throws FlowCancelledError when the
// run is cancelled mid-node.
const executeNode = async (
  node: FlowNode,
  ctx: RunContext,
  deps: FlowRunDeps,
  state: RunState,
  emit: (record: RunRecord) => void,
  onNodeStatus: FlowRunCallbacks["onNodeStatus"]
): Promise<{ ok: boolean; publish: Record<string, any> | null }> => {
  const nodeStartedAt = new Date().toISOString();
  const nodeStart = Date.now();

  if (node.type === "delay") {
    const cfg = node.config as DelayNodeConfig;
    await cancellableDelay(Math.max(0, cfg.ms || 0), state);
    onNodeStatus(node.id, "success");
    emit(makeRecord(node, null, "success", nodeStartedAt, Date.now() - nodeStart));
    return { ok: true, publish: null };
  }

  if (node.type === "request") {
    const cfg = node.config as RequestNodeConfig;
    const exec = await executeRequestConfig(cfg, ctx, deps, state);
    const status = exec.ok ? "success" : "failed";
    onNodeStatus(node.id, status);
    emit(makeRecord(node, exec, status, nodeStartedAt, Date.now() - nodeStart));
    return { ok: exec.ok, publish: exec.ok ? exec.outputs : null };
  }

  if (node.type === "looper") {
    const cfg = node.config as LooperNodeConfig;
    let items: any[];
    try {
      if (cfg.itemsSource === "reference") {
        const { found, value } = resolveReference(cfg.itemsValue, ctx);
        if (!found) throw new Error(`Items reference "${cfg.itemsValue}" not found`);
        const resolved = typeof value === "string" ? JSON.parse(value) : value;
        if (!Array.isArray(resolved)) throw new Error(`Items reference "${cfg.itemsValue}" is not an array`);
        items = resolved;
      } else {
        const parsed = JSON.parse(cfg.itemsValue || "[]");
        if (!Array.isArray(parsed)) throw new Error("Static items must be a JSON array");
        items = parsed;
      }
    } catch (e: any) {
      onNodeStatus(node.id, "failed");
      emit(makeRecord(node, null, "failed", nodeStartedAt, Date.now() - nodeStart, { error: e.message }));
      return { ok: false, publish: null };
    }

    const results: Record<string, any>[] = [];
    for (let iter = 0; iter < items.length; iter++) {
      const iterStartedAt = new Date().toISOString();
      const iterStart = Date.now();
      const exec = await executeRequestConfig(cfg.request, ctx, deps, state, items[iter]);
      const status = exec.ok ? "success" : "failed";
      emit(makeRecord(node, exec, status, iterStartedAt, Date.now() - iterStart, { iteration: iter }));
      if (!exec.ok) {
        onNodeStatus(node.id, "failed");
        return { ok: false, publish: null };
      }
      results.push(exec.outputs);
    }
    onNodeStatus(node.id, "success");
    return { ok: true, publish: { results, count: results.length } };
  }

  if (node.type === "verifier") {
    const cfg = node.config as VerifierNodeConfig;
    const maxAttempts = Math.max(1, cfg.maxAttempts || 1);
    let lastExec: ExecutionResult | null = null;
    let passed = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStartedAt = new Date().toISOString();
      const attemptStart = Date.now();
      const exec = await executeRequestConfig(cfg.request, ctx, deps, state);
      lastExec = exec;

      let attemptError = exec.error;
      let attemptPassed = false;
      // Comparisons run even when the request "failed" (e.g. asserting
      // on an expected error status) as long as we got a response.
      if (exec.response) {
        const evaluations = (cfg.comparisons || []).map((c) => evaluateComparison(c, exec, ctx));
        attemptPassed = evaluations.length > 0 && evaluations.every((e) => e.pass);
        const detail = evaluations.map((e) => e.detail).join("; ");
        if (!attemptPassed) {
          attemptError = (cfg.comparisons || []).length
            ? `Verification failed: ${detail}`
            : "Verifier has no comparisons configured";
        } else {
          attemptError = undefined;
        }
      }

      emit(
        makeRecord(node, { ...exec, error: attemptError }, attemptPassed ? "success" : "failed", attemptStartedAt, Date.now() - attemptStart, {
          attempt,
        })
      );

      if (attemptPassed) {
        passed = true;
        break;
      }
      if (attempt < maxAttempts) {
        await cancellableDelay(Math.max(0, cfg.intervalMs || 0), state);
      }
    }

    if (!passed) {
      onNodeStatus(node.id, "failed");
      return { ok: false, publish: null };
    }
    onNodeStatus(node.id, "success");
    return { ok: true, publish: { ...(lastExec?.outputs || {}), passed: true } };
  }

  // Exhaustiveness guard — a new FlowNodeType must be handled above.
  const exhaustive: never = node.type;
  throw new Error(`Unknown node type: ${exhaustive}`);
};

export function runFlow(flow: Flow, deps: FlowRunDeps, cb: FlowRunCallbacks, resume?: ResumeState): RunHandle {
  const state: RunState = { cancelled: false, abort: new AbortController(), wakers: new Set() };

  // Aborts every in-flight fetch (shared AbortController) and wakes every
  // pending delay/verifier-interval sleep (shared wakers set) — all branches.
  const cancel = () => {
    if (state.cancelled) return;
    state.cancelled = true;
    state.abort.abort();
    for (const wake of Array.from(state.wakers)) wake();
  };

  const done = (async (): Promise<FlowRunSummary> => {
    const startedAt = new Date().toISOString();
    const runStart = Date.now();
    const records: RunRecord[] = [];
    // Single-threaded push keeps records in emission order; parallel branches
    // interleave chronologically while per-node order stays sequential.
    const emit = (record: RunRecord) => {
      records.push(record);
      cb.onRecord(record);
    };

    const sorted = topoSort(flow.nodes, flow.edges);
    if ("cycle" in sorted) {
      throw new Error(`Flow contains a cycle involving: ${sorted.cycle.join(", ")}`);
    }

    const nodeById = new Map(flow.nodes.map((n) => [n.id, n]));

    // Nodes a resume treats as already-succeeded: never launched, no records,
    // outputs come pre-seeded via resume.context.
    const completed = new Set((resume?.completedNodeIds || []).filter((id) => nodeById.has(id)));

    // Adjacency + runtime in-degree (dangling edges skipped, as in topoSort).
    // Edges from completed sources are pre-satisfied and don't count toward
    // in-degree, so a node whose predecessors all succeeded before becomes a
    // root of the retry wavefront.
    const succ = new Map<string, string[]>(flow.nodes.map((n) => [n.id, []]));
    const remaining = new Map<string, number>(flow.nodes.map((n) => [n.id, 0]));
    for (const e of flow.edges) {
      if (!succ.has(e.source) || !succ.has(e.target)) continue;
      if (!completed.has(e.source)) remaining.set(e.target, (remaining.get(e.target) || 0) + 1);
      succ.get(e.source)!.push(e.target);
    }

    // Wraps the status callback to also collect each node's terminal status
    // for the summary's resume metadata.
    const nodeStatuses: Record<string, "success" | "failed" | "skipped" | "partial"> = {};
    const emitStatus: FlowRunCallbacks["onNodeStatus"] = (nodeId, status) => {
      if (status === "success" || status === "failed" || status === "skipped") nodeStatuses[nodeId] = status;
      cb.onNodeStatus(nodeId, status);
    };

    for (const node of flow.nodes) emitStatus(node.id, completed.has(node.id) ? "success" : "pending");

    // Each node writes exactly one unique ctx key (names are validated
    // unique) and only reads keys of its edge-ancestors, which are always
    // written before it launches — concurrent branches can't conflict.
    const ctx: RunContext = { ...(resume?.context || {}) };
    const terminal = new Set<string>(completed); // nodes with a final status
    let failed = false;
    let active = 0;
    let resolveAll: () => void = () => {};
    const allSettled = new Promise<void>((resolve) => {
      resolveAll = resolve;
    });

    const skipNode = (node: FlowNode, reason: string) => {
      terminal.add(node.id);
      emitStatus(node.id, "skipped");
      emit(makeRecord(node, null, "skipped", new Date().toISOString(), 0, { error: reason }));
    };

    // Mark every descendant of fromId skipped (exclusive). Descendants of a
    // failed node can never already be running — they transitively required
    // it — so this only touches nodes that haven't started. The terminal
    // guard gives shared descendants exactly one skip record even when
    // multiple upstream branches fail.
    const skipDescendants = (fromId: string, reasonName: string) => {
      const reason = `Skipped: upstream "${reasonName}" ${state.cancelled ? "was cancelled" : "failed"}`;
      const stack = [...(succ.get(fromId) || [])];
      while (stack.length) {
        const id = stack.pop()!;
        if (terminal.has(id)) continue;
        skipNode(nodeById.get(id)!, reason);
        stack.push(...(succ.get(id) || []));
      }
    };

    const runOne = async (node: FlowNode) => {
      emitStatus(node.id, "running");
      const nodeStartedAt = new Date().toISOString();
      const nodeStart = Date.now();
      try {
        const { ok, publish } = await executeNode(node, ctx, deps, state, emit, emitStatus);
        terminal.add(node.id);
        if (!ok) {
          failed = true;
          skipDescendants(node.id, node.name);
          return;
        }
        if (publish !== null) ctx[node.name] = publish;
        for (const succId of succ.get(node.id) || []) {
          const d = remaining.get(succId)! - 1;
          remaining.set(succId, d);
          // The terminal guard blocks launching a merge that was already
          // skipped because another of its incoming branches failed.
          if (d === 0 && !terminal.has(succId)) launch(nodeById.get(succId)!);
        }
      } catch (e: any) {
        terminal.add(node.id);
        emitStatus(node.id, "failed");
        if (e instanceof FlowCancelledError) {
          emit(makeRecord(node, null, "failed", nodeStartedAt, Date.now() - nodeStart, { error: "Run cancelled" }));
        } else {
          failed = true;
          emit(makeRecord(node, null, "failed", nodeStartedAt, Date.now() - nodeStart, { error: e.message || String(e) }));
        }
        skipDescendants(node.id, node.name);
      }
    };

    // No concurrency cap: fan-out is bounded by the hand-built graph's width,
    // each node issues at most one HTTP call at a time, and the browser
    // throttles per-host connections anyway.
    const launch = (node: FlowNode) => {
      if (state.cancelled) return; // never start new work after Stop
      active += 1;
      // Successors launch inside runOne before this decrement, so `active`
      // never transiently hits 0 while work remains.
      void runOne(node).finally(() => {
        active -= 1;
        if (active === 0) resolveAll();
      });
    };

    const roots = flow.nodes.filter((n) => !completed.has(n.id) && remaining.get(n.id) === 0);
    if (roots.length === 0) resolveAll(); // empty flow, or a resume with nothing left to run
    roots.forEach(launch);
    await allSettled;

    // Anything still non-terminal was stranded by cancellation (its
    // ancestors were aborted before it became ready).
    for (const node of flow.nodes) {
      if (!terminal.has(node.id)) skipNode(node, "Skipped: run cancelled");
    }

    return {
      status: state.cancelled ? "cancelled" : failed ? "failed" : "success",
      records,
      startedAt,
      durationMs: Date.now() - runStart,
      context: ctx,
      nodeStatuses,
      runSignature: structuralSignature(flow.nodes, flow.edges),
    };
  })();

  return { cancel, done };
}

// Combine the summary being retried with the resume run's summary (which
// holds records for the re-run nodes only) into one complete last run. The
// result carries full resume metadata, so a partially-failed retry is itself
// retryable.
export function mergeRetrySummary(prior: FlowRunSummary, next: FlowRunSummary): FlowRunSummary {
  // Keep prior records only for nodes that succeeded then — a retried node's
  // old failure records are replaced by its new attempt, while a successful
  // looper/verifier keeps its full per-iteration/per-attempt set.
  const kept = new Set(
    Object.entries(prior.nodeStatuses || {})
      .filter(([, status]) => status === "success")
      .map(([nodeId]) => nodeId)
  );
  return {
    status: next.status,
    records: [...prior.records.filter((r) => kept.has(r.nodeId)), ...next.records],
    startedAt: prior.startedAt, // the logical run began with the original run
    durationMs: prior.durationMs + next.durationMs, // executed time, not wall-clock gap
    context: next.context, // already the union of seeded + new publishes
    nodeStatuses: next.nodeStatuses, // already complete: resume seeds prior successes
    runSignature: next.runSignature,
  };
}

// Published output names offered by the mapping UI per upstream node.
export const publishedOutputs = (node: FlowNode, collections: Collection[]): string[] => {
  switch (node.type) {
    case "request": {
      const cfg = node.config as RequestNodeConfig;
      const req = findRequest(collections, cfg.requestId);
      return req?.outputs || [];
    }
    case "looper":
      return ["results", "count"];
    case "verifier": {
      const cfg = node.config as VerifierNodeConfig;
      const req = findRequest(collections, cfg.request.requestId);
      return [...(req?.outputs || []), "passed"];
    }
    case "delay":
      return [];
  }
};

// Ancestor node ids of `nodeId` following edges backwards (for the
// reference dropdown: only upstream outputs are guaranteed to exist).
export const ancestorNodeIds = (nodeId: string, edges: FlowEdge[]): Set<string> => {
  const parents = new Map<string, string[]>();
  for (const e of edges) {
    if (!parents.has(e.target)) parents.set(e.target, []);
    parents.get(e.target)!.push(e.source);
  }
  const seen = new Set<string>();
  const stack = [...(parents.get(nodeId) || [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(parents.get(id) || []));
  }
  return seen;
};

// Requests are looked up by id across all collections at edit/run time.
export const lookupRequest = findRequest;
