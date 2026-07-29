// Scheduler tests for the API Studio flow runner: parallel fan-out, implicit
// merge (wait-for-all), branch-isolated failure, and cancellation. The
// executor endpoint is mocked through deps.apiCall; deferred promises control
// completion order so concurrency is asserted deterministically.

import { describe, expect, it, vi } from "vitest";
import { runFlow, type FlowRunDeps, type NodeRunStatus, type RunRecord } from "./flowRunner";
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
