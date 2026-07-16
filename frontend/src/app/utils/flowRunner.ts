// API Studio client-side flow orchestrator: walks the graph in topological
// order, executes request/looper/delay/verifier nodes against the existing
// POST /api/executor/run endpoint, and feeds each node's outputs into
// downstream input mappings.

import type { Collection, RequestItem, InputBinding } from "../context/AppContext";
import { findRequestInTree } from "../context/AppContext";
import { scanInputNames } from "./requestTokens";
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

export type NodeRunStatus = "idle" | "pending" | "running" | "success" | "failed" | "skipped";

export interface RunRecord {
  nodeId: string;
  nodeName: string;
  nodeType: FlowNode["type"];
  iteration?: number; // looper, 0-based
  attempt?: number; // verifier, 1-based
  status: "success" | "failed" | "skipped";
  resolvedInputs: Record<string, string>;
  outputs: Record<string, any> | null;
  requestPayload: Record<string, any> | null; // exact /api/executor/run body
  response: { status: number; statusText: string; headers: Record<string, string>; body: any } | null;
  error?: string;
  startedAt: string; // ISO
  durationMs: number;
}

export interface FlowRunDeps {
  apiCall: (path: string, options?: RequestInit) => Promise<any>;
  collections: Collection[];
  environmentId: string | null; // selectedEnvCloudId
  resolveAuthFunctionCloudId: (id?: string | null) => string | null;
}

export interface FlowRunCallbacks {
  onNodeStatus: (nodeId: string, status: NodeRunStatus) => void;
  onRecord: (record: RunRecord) => void;
}

export interface FlowRunSummary {
  status: "success" | "failed" | "cancelled";
  records: RunRecord[];
  startedAt: string;
  durationMs: number;
}

export interface RunHandle {
  cancel: () => void;
  done: Promise<FlowRunSummary>;
}

// Kahn's algorithm. Nodes with no incoming edges run first; edges only
// define ordering (fan-in/fan-out allowed).
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

// Upstream results: nodeName -> published outputs object.
export type RunContext = Record<string, Record<string, any>>;

// Walk a dot-path ("node.out.a.0.b") through the run context / an object.
// A "*" segment projects over an array: "loop.results.*.uuid" collects the
// uuid of every iteration into a flat array (elements that don't resolve are
// dropped, JSONPath-style). Wildcards nest.
const walkPath = (root: any, segments: string[]): any => {
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

const stringifyValue = (value: any): string => {
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

interface ExecutionResult {
  ok: boolean;
  error?: string;
  resolvedInputs: Record<string, string>;
  requestPayload: Record<string, any> | null;
  response: RunRecord["response"];
  outputs: Record<string, any>;
  raw: any | null; // full executor result
}

class FlowCancelledError extends Error {
  constructor() {
    super("Run cancelled");
  }
}

interface RunState {
  cancelled: boolean;
  abort: AbortController;
  wakers: Set<() => void>;
}

const cancellableDelay = (ms: number, state: RunState): Promise<void> =>
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

// Resolve mappings + run the linked request once via /api/executor/run.
const executeRequestConfig = async (
  cfg: RequestNodeConfig,
  ctx: RunContext,
  deps: FlowRunDeps,
  state: RunState,
  iterationItem?: any
): Promise<ExecutionResult> => {
  const empty: ExecutionResult = {
    ok: false,
    resolvedInputs: {},
    requestPayload: null,
    response: null,
    outputs: {},
    raw: null,
  };

  const request = findRequest(deps.collections, cfg.requestId);
  if (!request) {
    return { ...empty, error: cfg.requestId ? "Linked request not found" : "No request selected" };
  }

  // Auth parity with the API Explorer: HOOK auth is kept user-local — the
  // shared collection stores authFunctionId as null and the real binding
  // lives in localStorage (see handleSaveRequest / the hydration effect in
  // AppContext). Apply the same per-device override here.
  let authType = request.authType;
  let authConfig = request.authConfig || {};
  try {
    const override = localStorage.getItem(`lixionary_auth_${request.id}`);
    if (override) {
      const parsed = JSON.parse(override);
      authType = parsed.authType ?? authType;
      authConfig = parsed.authConfig ?? authConfig;
    }
  } catch {
    // storage unavailable / malformed override — fall back to the saved values
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
        return { ...empty, error: `Reference "${mapping.value}" not found for input "${mapping.inputName}"` };
      }
      value = stringifyValue(refValue);
    } else {
      value = interpolateStudioTokens(mapping.value, ctx, iterationItem);
    }
    bindings.set(mapping.inputName, { name: mapping.inputName, source: "literal", value });
    resolvedInputs[mapping.inputName] = value;
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
      authFunctionId: deps.resolveAuthFunctionCloudId(authConfig?.authFunctionId),
    },
    responseParserScript: request.responseParserScript || "",
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

const makeRecord = (
  node: FlowNode,
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

export function runFlow(flow: Flow, deps: FlowRunDeps, cb: FlowRunCallbacks): RunHandle {
  const state: RunState = { cancelled: false, abort: new AbortController(), wakers: new Set() };

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
    const emit = (record: RunRecord) => {
      records.push(record);
      cb.onRecord(record);
    };

    const sorted = topoSort(flow.nodes, flow.edges);
    if ("cycle" in sorted) {
      throw new Error(`Flow contains a cycle involving: ${sorted.cycle.join(", ")}`);
    }
    const nodeById = new Map(flow.nodes.map((n) => [n.id, n]));
    const order = sorted.order.map((id) => nodeById.get(id)!);

    for (const node of order) cb.onNodeStatus(node.id, "pending");

    const ctx: RunContext = {};
    let failed = false;
    let cancelled = false;

    const skipRemaining = (fromIndex: number) => {
      for (let i = fromIndex; i < order.length; i++) {
        const node = order[i];
        cb.onNodeStatus(node.id, "skipped");
        emit(makeRecord(node, null, "skipped", new Date().toISOString(), 0));
      }
    };

    for (let i = 0; i < order.length; i++) {
      const node = order[i];
      cb.onNodeStatus(node.id, "running");
      const nodeStartedAt = new Date().toISOString();
      const nodeStart = Date.now();

      try {
        if (node.type === "delay") {
          const cfg = node.config as DelayNodeConfig;
          await cancellableDelay(Math.max(0, cfg.ms || 0), state);
          cb.onNodeStatus(node.id, "success");
          emit(makeRecord(node, null, "success", nodeStartedAt, Date.now() - nodeStart));
          continue;
        }

        if (node.type === "request") {
          const cfg = node.config as RequestNodeConfig;
          const exec = await executeRequestConfig(cfg, ctx, deps, state);
          const status = exec.ok ? "success" : "failed";
          cb.onNodeStatus(node.id, status);
          emit(makeRecord(node, exec, status, nodeStartedAt, Date.now() - nodeStart));
          if (!exec.ok) {
            failed = true;
            skipRemaining(i + 1);
            break;
          }
          ctx[node.name] = exec.outputs;
          continue;
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
            cb.onNodeStatus(node.id, "failed");
            emit(makeRecord(node, null, "failed", nodeStartedAt, Date.now() - nodeStart, { error: e.message }));
            failed = true;
            skipRemaining(i + 1);
            break;
          }

          const results: Record<string, any>[] = [];
          let looperFailed = false;
          for (let iter = 0; iter < items.length; iter++) {
            const iterStartedAt = new Date().toISOString();
            const iterStart = Date.now();
            const exec = await executeRequestConfig(cfg.request, ctx, deps, state, items[iter]);
            const status = exec.ok ? "success" : "failed";
            emit(makeRecord(node, exec, status, iterStartedAt, Date.now() - iterStart, { iteration: iter }));
            if (!exec.ok) {
              looperFailed = true;
              break;
            }
            results.push(exec.outputs);
          }

          if (looperFailed) {
            cb.onNodeStatus(node.id, "failed");
            failed = true;
            skipRemaining(i + 1);
            break;
          }
          cb.onNodeStatus(node.id, "success");
          ctx[node.name] = { results, count: results.length };
          continue;
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
            cb.onNodeStatus(node.id, "failed");
            failed = true;
            skipRemaining(i + 1);
            break;
          }
          cb.onNodeStatus(node.id, "success");
          ctx[node.name] = { ...(lastExec?.outputs || {}), passed: true };
          continue;
        }
      } catch (e: any) {
        if (e instanceof FlowCancelledError) {
          cancelled = true;
          cb.onNodeStatus(node.id, "failed");
          emit(makeRecord(node, null, "failed", nodeStartedAt, Date.now() - nodeStart, { error: "Run cancelled" }));
          skipRemaining(i + 1);
          break;
        }
        cb.onNodeStatus(node.id, "failed");
        emit(makeRecord(node, null, "failed", nodeStartedAt, Date.now() - nodeStart, { error: e.message || String(e) }));
        failed = true;
        skipRemaining(i + 1);
        break;
      }
    }

    return {
      status: cancelled ? "cancelled" : failed ? "failed" : "success",
      records,
      startedAt,
      durationMs: Date.now() - runStart,
    };
  })();

  return { cancel, done };
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
