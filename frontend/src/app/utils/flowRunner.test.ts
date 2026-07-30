// Scheduler tests for the API Studio flow runner: parallel fan-out, implicit
// merge (wait-for-all), branch-isolated failure, and cancellation. The
// executor endpoint is mocked through deps.apiCall; deferred promises control
// completion order so concurrency is asserted deterministically.

import { describe, expect, it, vi } from "vitest";
import {
  runFlow,
  mergeRetrySummary,
  structuralSignature,
  type FlowRunDeps,
  type FlowRunSummary,
  type NodeRunStatus,
  type RunRecord,
} from "./flowRunner";
import { buildRunCsv } from "./flowReport";
import type { Flow, FlowNode, FlowEdge } from "./flowTypes";

// AppContext is Next-coupled; the runner only needs request lookup from it.
vi.mock("../context/AppContext", () => ({
  findRequestInTree: (col: any, requestId: string) =>
    (col.requests || []).find((r: any) => r.id === requestId) || null,
}));

type ExecutorResult = Record<string, any>;

const ok = (outputs: Record<string, any> = {}): ExecutorResult => ({
  status: 200,
  statusText: "OK",
  headers: {},
  body: null,
  outputs,
  missingOutputs: [],
});

const httpError = (): ExecutorResult => ({
  status: 500,
  statusText: "Internal Server Error",
  headers: {},
  body: null,
  outputs: {},
  missingOutputs: [],
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// Drains all pending microtasks (and zero-delay timers).
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const makeHarness = (handlers: Record<string, () => Promise<ExecutorResult> | ExecutorResult>) => {
  const payloads = new Map<string, any[]>();
  const collections = [
    {
      id: "col",
      requests: Object.keys(handlers).map((id) => ({
        id,
        method: "GET",
        url: `http://test/${id}`,
        headers: [],
        queryParams: [],
        bodyType: "none",
        body: "",
        authType: "none",
        authConfig: {},
        inputs: [],
        outputs: [],
      })),
    },
  ] as any;
  const apiCall = async (path: string, options?: RequestInit) => {
    if (path.startsWith("/api/local-store/pref/")) return { value: null };
    if (path === "/api/executor/run") {
      const payload = JSON.parse(String(options?.body));
      if (!payloads.has(payload.requestId)) payloads.set(payload.requestId, []);
      payloads.get(payload.requestId)!.push(payload);
      return await handlers[payload.requestId]();
    }
    throw new Error(`Unexpected apiCall path: ${path}`);
  };
  const statuses = new Map<string, NodeRunStatus[]>();
  const records: RunRecord[] = [];
  return {
    deps: { apiCall, collections, environmentId: null } as FlowRunDeps,
    payloads,
    statuses,
    records,
    cb: {
      onNodeStatus: (nodeId: string, status: NodeRunStatus) => {
        if (!statuses.has(nodeId)) statuses.set(nodeId, []);
        statuses.get(nodeId)!.push(status);
      },
      onRecord: (record: RunRecord) => records.push(record),
    },
    status: (id: string) => statuses.get(id)?.at(-1),
  };
};

const reqNode = (id: string, mappings: any[] = []): FlowNode => ({
  id,
  name: id,
  type: "request",
  position: { x: 0, y: 0 },
  config: { requestId: id, mappings },
});

const looperNode = (id: string, requestId: string, items: any[]): FlowNode => ({
  id,
  name: id,
  type: "looper",
  position: { x: 0, y: 0 },
  config: {
    itemsSource: "static",
    itemsValue: JSON.stringify(items),
    request: { requestId, mappings: [] },
  },
});

const edge = (source: string, target: string): FlowEdge => ({ id: `${source}-${target}`, source, target });

const makeFlow = (nodes: FlowNode[], edges: FlowEdge[]): Flow => ({ id: "flow", name: "flow", nodes, edges });

describe("runFlow scheduling", () => {
  it("runs a linear chain in order and pipes outputs downstream", async () => {
    const h = makeHarness({
      A: () => ok({ val: "from-a" }),
      B: () => ok({ val: "from-b" }),
      C: () => ok(),
    });
    const f = makeFlow(
      [
        reqNode("A"),
        reqNode("B", [{ inputName: "x", source: "reference", value: "A.val" }]),
        reqNode("C", [{ inputName: "y", source: "reference", value: "B.val" }]),
      ],
      [edge("A", "B"), edge("B", "C")]
    );
    const summary = await runFlow(f, h.deps, h.cb).done;
    expect(summary.status).toBe("success");
    expect(h.records.map((r) => r.nodeName)).toEqual(["A", "B", "C"]);
    expect(h.records.every((r) => r.status === "success")).toBe(true);
    expect(h.payloads.get("B")![0].inputs).toContainEqual({ name: "x", source: "literal", value: "from-a" });
    expect(h.payloads.get("C")![0].inputs).toContainEqual({ name: "y", source: "literal", value: "from-b" });
  });

  it("fans out sibling branches concurrently", async () => {
    const b = deferred<ExecutorResult>();
    const c = deferred<ExecutorResult>();
    const h = makeHarness({ A: () => ok(), B: () => b.promise, C: () => c.promise });
    const f = makeFlow([reqNode("A"), reqNode("B"), reqNode("C")], [edge("A", "B"), edge("A", "C")]);
    const handle = runFlow(f, h.deps, h.cb);
    await flush();
    expect(h.status("B")).toBe("running");
    expect(h.status("C")).toBe("running");
    b.resolve(ok());
    c.resolve(ok());
    const summary = await handle.done;
    expect(summary.status).toBe("success");
  });

  it("runs multiple start nodes and isolated nodes in parallel", async () => {
    const h = makeHarness({ A: () => ok(), B: () => ok(), C: () => ok() });
    const f = makeFlow([reqNode("A"), reqNode("B"), reqNode("C")], [edge("A", "C")]);
    const summary = await runFlow(f, h.deps, h.cb).done;
    expect(summary.status).toBe("success");
    expect(["A", "B", "C"].map((id) => h.status(id))).toEqual(["success", "success", "success"]);
  });

  it("implicit merge waits for all incoming branches and sees both outputs", async () => {
    const b = deferred<ExecutorResult>();
    const c = deferred<ExecutorResult>();
    const h = makeHarness({ A: () => ok(), B: () => b.promise, C: () => c.promise, D: () => ok() });
    const f = makeFlow(
      [
        reqNode("A"),
        reqNode("B"),
        reqNode("C"),
        reqNode("D", [
          { inputName: "x", source: "reference", value: "B.val" },
          { inputName: "y", source: "reference", value: "C.val" },
        ]),
      ],
      [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D")]
    );
    const handle = runFlow(f, h.deps, h.cb);
    await flush();
    c.resolve(ok({ val: "from-c" }));
    await flush();
    expect(h.status("C")).toBe("success");
    expect(h.status("D")).toBe("pending"); // still waiting on B
    b.resolve(ok({ val: "from-b" }));
    const summary = await handle.done;
    expect(summary.status).toBe("success");
    expect(h.status("D")).toBe("success");
    const dInputs = h.payloads.get("D")![0].inputs;
    expect(dInputs).toContainEqual({ name: "x", source: "literal", value: "from-b" });
    expect(dInputs).toContainEqual({ name: "y", source: "literal", value: "from-c" });
  });

  it("a failure skips only its downstream; independent branches finish", async () => {
    const h = makeHarness({
      A: () => ok(),
      B: () => httpError(),
      C: () => ok(),
      D: () => ok(),
      E: () => ok(),
    });
    const f = makeFlow(
      [reqNode("A"), reqNode("B"), reqNode("C"), reqNode("D"), reqNode("E")],
      [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "E")]
    );
    const summary = await runFlow(f, h.deps, h.cb).done;
    expect(summary.status).toBe("failed");
    expect(h.status("B")).toBe("failed");
    expect(h.status("D")).toBe("skipped");
    expect(h.status("C")).toBe("success");
    expect(h.status("E")).toBe("success");
    const dRecord = h.records.find((r) => r.nodeName === "D")!;
    expect(dRecord.error).toBe('Skipped: upstream "B" failed');
    expect(h.records.filter((r) => r.nodeName === "D")).toHaveLength(1);
    expect(h.payloads.has("D")).toBe(false); // never dispatched
  });

  it("skips a merge exactly once when one branch fails while the other is in flight", async () => {
    const c = deferred<ExecutorResult>();
    const h = makeHarness({ A: () => ok(), B: () => httpError(), C: () => c.promise, D: () => ok() });
    const f = makeFlow(
      [reqNode("A"), reqNode("B"), reqNode("C"), reqNode("D")],
      [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D")]
    );
    const handle = runFlow(f, h.deps, h.cb);
    await flush();
    expect(h.status("D")).toBe("skipped"); // B already failed; C still running
    expect(h.status("C")).toBe("running");
    c.resolve(ok());
    const summary = await handle.done;
    expect(summary.status).toBe("failed");
    expect(h.status("C")).toBe("success");
    expect(h.statuses.get("D")).not.toContain("running"); // never launched after C completed
    expect(h.records.filter((r) => r.nodeName === "D")).toHaveLength(1);
    expect(h.payloads.has("D")).toBe(false);
  });

  it("cancel aborts all in-flight branches and skips the rest", async () => {
    const a = deferred<ExecutorResult>();
    const b = deferred<ExecutorResult>();
    const h = makeHarness({ A: () => a.promise, B: () => b.promise, C: () => ok() });
    const f = makeFlow([reqNode("A"), reqNode("B"), reqNode("C")], [edge("A", "C")]);
    const handle = runFlow(f, h.deps, h.cb);
    await flush();
    expect(h.status("A")).toBe("running");
    expect(h.status("B")).toBe("running");
    handle.cancel();
    a.resolve(ok());
    b.resolve(ok());
    const summary = await handle.done;
    expect(summary.status).toBe("cancelled");
    expect(h.status("A")).toBe("failed");
    expect(h.status("B")).toBe("failed");
    expect(h.records.find((r) => r.nodeName === "A")!.error).toBe("Run cancelled");
    expect(h.status("C")).toBe("skipped");
    expect(h.records.find((r) => r.nodeName === "C")!.error).toBe('Skipped: upstream "A" was cancelled');
  });

  it("looper iterations stay serial while a sibling branch progresses", async () => {
    const iters = [deferred<ExecutorResult>(), deferred<ExecutorResult>()];
    let call = 0;
    const h = makeHarness({
      A: () => ok(),
      LREQ: () => iters[call++].promise,
      C: () => ok(),
    });
    const f = makeFlow(
      [reqNode("A"), looperNode("L", "LREQ", ["one", "two"]), reqNode("C")],
      [edge("A", "L"), edge("A", "C")]
    );
    const handle = runFlow(f, h.deps, h.cb);
    await flush();
    expect(h.status("C")).toBe("success"); // sibling finished while looper mid-iteration
    expect(h.status("L")).toBe("running");
    expect(call).toBe(1); // second iteration not started yet
    iters[0].resolve(ok({ out: "one" }));
    await flush();
    expect(call).toBe(2);
    iters[1].resolve(ok({ out: "two" }));
    const summary = await handle.done;
    expect(summary.status).toBe("success");
    expect(h.records.filter((r) => r.nodeName === "L").map((r) => r.iteration)).toEqual([0, 1]);
  });
});

describe("runFlow resume", () => {
  const completedOf = (summary: FlowRunSummary) =>
    Object.entries(summary.nodeStatuses!)
      .filter(([, status]) => status === "success")
      .map(([nodeId]) => nodeId);

  it("re-runs only failed and skipped nodes; successful branches stay untouched", async () => {
    let bFails = true;
    const h = makeHarness({
      A: () => ok({ val: "a" }),
      B: () => (bFails ? httpError() : ok()),
      C: () => ok(),
      D: () => ok(),
      E: () => ok(),
    });
    const f = makeFlow(
      [reqNode("A"), reqNode("B"), reqNode("C"), reqNode("D"), reqNode("E")],
      [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "E")]
    );
    const first = await runFlow(f, h.deps, h.cb).done;
    expect(first.status).toBe("failed");
    expect(first.nodeStatuses).toEqual({ A: "success", B: "failed", C: "success", D: "skipped", E: "success" });

    bFails = false;
    const second = await runFlow(f, h.deps, h.cb, { context: first.context!, completedNodeIds: completedOf(first) }).done;
    expect(second.status).toBe("success");
    expect(h.payloads.get("A")).toHaveLength(1);
    expect(h.payloads.get("C")).toHaveLength(1);
    expect(h.payloads.get("E")).toHaveLength(1);
    expect(h.payloads.get("B")).toHaveLength(2);
    expect(h.payloads.get("D")).toHaveLength(1);
    expect(second.records.map((r) => r.nodeName).sort()).toEqual(["B", "D"]);
    expect(second.nodeStatuses).toEqual({ A: "success", B: "success", C: "success", D: "success", E: "success" });
  });

  it("seeds context so retried nodes see the original upstream outputs", async () => {
    let bFails = true;
    const h = makeHarness({
      A: () => ok({ val: "from-a" }),
      B: () => (bFails ? httpError() : ok()),
    });
    const f = makeFlow(
      [reqNode("A"), reqNode("B", [{ inputName: "x", source: "reference", value: "A.val" }])],
      [edge("A", "B")]
    );
    const first = await runFlow(f, h.deps, h.cb).done;
    expect(first.status).toBe("failed");
    bFails = false;
    const second = await runFlow(f, h.deps, h.cb, { context: first.context!, completedNodeIds: ["A"] }).done;
    expect(second.status).toBe("success");
    expect(h.payloads.get("A")).toHaveLength(1); // A never re-ran
    expect(h.payloads.get("B")![1].inputs).toContainEqual({ name: "x", source: "literal", value: "from-a" });
  });

  it("completed nodes are seeded success with no records emitted", async () => {
    let bFails = true;
    const handlers = {
      A: () => ok({ val: "a" }),
      B: () => (bFails ? httpError() : ok()),
    };
    const h1 = makeHarness(handlers);
    const f = makeFlow([reqNode("A"), reqNode("B")], [edge("A", "B")]);
    const first = await runFlow(f, h1.deps, h1.cb).done;
    bFails = false;
    const h2 = makeHarness(handlers); // fresh harness: per-run statuses/payloads
    const second = await runFlow(f, h2.deps, h2.cb, { context: first.context!, completedNodeIds: ["A"] }).done;
    expect(second.status).toBe("success");
    expect(h2.statuses.get("A")).toEqual(["success"]); // no pending/running for completed
    expect(h2.payloads.has("A")).toBe(false);
    expect(second.records.map((r) => r.nodeName)).toEqual(["B"]);
  });

  it("a partially-failed retry is itself retryable via the merged summary", async () => {
    let bFails = true;
    let dFails = true;
    const h = makeHarness({
      A: () => ok({ val: "a" }),
      B: () => (bFails ? httpError() : ok({ val: "b" })),
      D: () => (dFails ? httpError() : ok()),
    });
    const f = makeFlow([reqNode("A"), reqNode("B"), reqNode("D")], [edge("A", "B"), edge("B", "D")]);
    const first = await runFlow(f, h.deps, h.cb).done;
    expect(first.status).toBe("failed");

    bFails = false;
    const retry1 = await runFlow(f, h.deps, h.cb, { context: first.context!, completedNodeIds: completedOf(first) }).done;
    const merged1 = mergeRetrySummary(first, retry1);
    expect(merged1.status).toBe("failed");
    expect(merged1.nodeStatuses).toEqual({ A: "success", B: "success", D: "failed" });

    dFails = false;
    const retry2 = await runFlow(f, h.deps, h.cb, { context: merged1.context!, completedNodeIds: completedOf(merged1) }).done;
    const merged2 = mergeRetrySummary(merged1, retry2);
    expect(merged2.status).toBe("success");
    expect(h.payloads.get("A")).toHaveLength(1);
    expect(h.payloads.get("B")).toHaveLength(2);
    expect(h.payloads.get("D")).toHaveLength(2);
    expect(merged2.records.map((r) => r.nodeName)).toEqual(["A", "B", "D"]);
    expect(merged2.records.every((r) => r.status === "success")).toBe(true);
  });

  it("a cancelled run can be resumed from its successes", async () => {
    const b = deferred<ExecutorResult>();
    let bDeferred = true;
    const h = makeHarness({
      A: () => ok({ val: "a" }),
      B: () => (bDeferred ? b.promise : ok()),
      C: () => ok(),
    });
    const f = makeFlow([reqNode("A"), reqNode("B"), reqNode("C")], [edge("A", "B"), edge("B", "C")]);
    const handle = runFlow(f, h.deps, h.cb);
    await flush();
    handle.cancel();
    b.resolve(ok());
    const first = await handle.done;
    expect(first.status).toBe("cancelled");
    expect(first.nodeStatuses).toEqual({ A: "success", B: "failed", C: "skipped" });

    bDeferred = false;
    const second = await runFlow(f, h.deps, h.cb, { context: first.context!, completedNodeIds: completedOf(first) }).done;
    const merged = mergeRetrySummary(first, second);
    expect(merged.status).toBe("success");
    expect(h.payloads.get("A")).toHaveLength(1);
    expect(merged.records.map((r) => r.nodeName)).toEqual(["A", "B", "C"]);
  });
});

describe("mergeRetrySummary", () => {
  const rec = (nodeId: string, status: RunRecord["status"], extra: Partial<RunRecord> = {}): RunRecord => ({
    nodeId,
    nodeName: nodeId,
    nodeType: "request",
    status,
    resolvedInputs: {},
    outputs: null,
    requestPayload: null,
    response: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 1,
    ...extra,
  });

  it("keeps successful nodes' full record sets and replaces retried nodes' records", () => {
    const prior: FlowRunSummary = {
      status: "failed",
      records: [
        rec("L", "success", { iteration: 0 }),
        rec("L", "success", { iteration: 1 }),
        rec("B", "failed"),
        rec("D", "skipped"),
      ],
      startedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 100,
      context: { L: { results: [], count: 0 } },
      nodeStatuses: { L: "success", B: "failed", D: "skipped" },
      runSignature: "sig",
    };
    const next: FlowRunSummary = {
      status: "success",
      records: [rec("B", "success"), rec("D", "success")],
      startedAt: "2026-01-01T00:01:00.000Z",
      durationMs: 50,
      context: { L: { results: [], count: 0 }, B: { val: "b" } },
      nodeStatuses: { L: "success", B: "success", D: "success" },
      runSignature: "sig",
    };
    const merged = mergeRetrySummary(prior, next);
    expect(merged.records.map((r) => [r.nodeId, r.status])).toEqual([
      ["L", "success"],
      ["L", "success"],
      ["B", "success"],
      ["D", "success"],
    ]);
    expect(merged.status).toBe("success");
    expect(merged.startedAt).toBe(prior.startedAt);
    expect(merged.durationMs).toBe(150);
    expect(merged.context).toBe(next.context);
    expect(merged.nodeStatuses).toBe(next.nodeStatuses);
    expect(merged.runSignature).toBe(next.runSignature);
  });
});

describe("structuralSignature", () => {
  it("ignores positions and ordering but detects structural edits", () => {
    const a = reqNode("A");
    const b = reqNode("B");
    const movedA = { ...a, position: { x: 100, y: 200 } };
    expect(structuralSignature([a, b], [edge("A", "B")])).toBe(structuralSignature([b, movedA], [edge("A", "B")]));
    expect(structuralSignature([a, b], [edge("A", "B")])).not.toBe(structuralSignature([a, b], []));
    const renamed = { ...b, name: "B2" };
    expect(structuralSignature([a, b], [])).not.toBe(structuralSignature([a, renamed], []));
  });
});

describe("buildRunCsv", () => {
  it("orders rows by started_at with a stable tiebreak", () => {
    const rec = (nodeName: string, startedAt: string): RunRecord => ({
      nodeId: nodeName,
      nodeName,
      nodeType: "request",
      status: "success",
      resolvedInputs: {},
      outputs: null,
      requestPayload: null,
      response: null,
      startedAt,
      durationMs: 1,
    });
    const csv = buildRunCsv([
      rec("late", "2026-01-01T00:00:02.000Z"),
      rec("early", "2026-01-01T00:00:01.000Z"),
      rec("tie1", "2026-01-01T00:00:01.500Z"),
      rec("tie2", "2026-01-01T00:00:01.500Z"),
    ]);
    const names = csv.split("\n").slice(1).map((line) => line.split(",")[0]);
    expect(names).toEqual(["early", "tie1", "tie2", "late"]);
  });
});
