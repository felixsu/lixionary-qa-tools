// Behavioral tests for the V2 streaming engine: item streams, zip + latch,
// continue-on-error holes through a fork/join, per-item verification retries,
// pipelining, trigger barriers, and cancellation.

import { describe, expect, it, vi } from "vitest";
import { runFlowV2 } from "./flowRunnerV2";
import type { FlowRunDeps, NodeRunStatus, RunRecord } from "./flowRunner";
import { EMIT_MAX_ITEMS, type FlowEdgeV2, type FlowNodeV2, type FlowV2 } from "./flowTypesV2";

vi.mock("../context/AppContext", () => ({
  findRequestInTree: (col: { requests?: { id: string }[] }, requestId: string) =>
    (col.requests || []).find((r) => r.id === requestId) || null,
}));

type ExecutorResult = Record<string, unknown>;

const ok = (outputs: Record<string, unknown> = {}, body: unknown = null): ExecutorResult => ({
  status: 200,
  statusText: "OK",
  headers: {},
  body,
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

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

interface RequestSpec {
  handler: (call: number) => Promise<ExecutorResult> | ExecutorResult;
  url?: string;
  outputs?: string[];
}

const makeHarness = (specs: Record<string, RequestSpec>) => {
  const calls = new Map<string, number>();
  const bindings = new Map<string, Record<string, string>[]>();
  const collections = [
    {
      id: "col",
      requests: Object.entries(specs).map(([id, spec]) => ({
        id,
        method: "GET",
        url: spec.url ?? `http://test/${id}`,
        headers: [],
        queryParams: [],
        bodyType: "none",
        body: "",
        authType: "none",
        authConfig: {},
        inputs: [],
        outputs: spec.outputs ?? [],
      })),
    },
  ] as unknown as FlowRunDeps["collections"];
  const apiCall = async (path: string, options?: RequestInit) => {
    if (path.startsWith("/api/local-store/pref/")) return { value: null };
    if (path === "/api/executor/run") {
      const payload = JSON.parse(String(options?.body));
      const id = payload.requestId;
      const call = calls.get(id) || 0;
      calls.set(id, call + 1);
      if (!bindings.has(id)) bindings.set(id, []);
      bindings
        .get(id)!
        .push(
          Object.fromEntries(
            (payload.inputs as { name: string; value: string }[]).map((b) => [b.name, b.value])
          )
        );
      return await specs[id].handler(call);
    }
    throw new Error(`Unexpected apiCall path: ${path}`);
  };
  const statuses = new Map<string, NodeRunStatus[]>();
  const records: RunRecord[] = [];
  return {
    deps: { apiCall, collections, environmentId: null } as FlowRunDeps,
    calls,
    bindings,
    records,
    cb: {
      onNodeStatus: (nodeId: string, status: NodeRunStatus) => {
        if (!statuses.has(nodeId)) statuses.set(nodeId, []);
        statuses.get(nodeId)!.push(status);
      },
      onRecord: (r: RunRecord) => records.push(r),
    },
    status: (id: string) => statuses.get(id)?.at(-1),
    inputsOf: (requestId: string) => bindings.get(requestId) || [],
    recordsOf: (nodeName: string) => records.filter((r) => r.nodeName === nodeName),
  };
};

const node = (id: string, type: FlowNodeV2["type"], config: FlowNodeV2["config"]): FlowNodeV2 => ({
  id,
  name: id,
  type,
  position: { x: 0, y: 0 },
  config,
});
const req = (id: string, requestId = id, extra: Record<string, unknown> = {}) =>
  node(id, "request", { requestId, staticInputs: {}, ...extra });
const emitNode = (id: string, items: unknown[]) =>
  node(id, "arrayEmit", { staticItems: { type: "json", value: JSON.stringify(items) } });

const edge = (
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  path?: string
): FlowEdgeV2 => ({
  id: `${source}:${sourceHandle}->${target}:${targetHandle}`,
  source,
  target,
  sourceHandle,
  targetHandle,
  ...(path ? { path } : {}),
});

const makeFlow = (nodes: FlowNodeV2[], edges: FlowEdgeV2[]): FlowV2 => ({
  id: "flow",
  name: "flow",
  schemaVersion: 2,
  nodes,
  edges,
});

describe("scalar flows (no emitters)", () => {
  it("runs each node exactly once and pipes values along connections", async () => {
    const h = makeHarness({
      A: { handler: () => ok({ uuid: "u-1" }), outputs: ["uuid"] },
      B: { handler: () => ok(), url: "http://test/{{orderId}}" },
    });
    const f = makeFlow([req("a", "A"), req("b", "B")], [edge("a", "out:uuid", "b", "in:orderId")]);
    const summary = await runFlowV2(f, h.deps, h.cb).done;

    expect(summary.status).toBe("success");
    expect(h.calls.get("A")).toBe(1);
    expect(h.inputsOf("B")).toEqual([{ orderId: "u-1" }]);
    expect(h.recordsOf("b")[0].iteration).toBe(0);
  });

  it("uses a hardcoded value when an input is unconnected", async () => {
    const h = makeHarness({ B: { handler: () => ok(), url: "http://test/{{orderId}}" } });
    const f = makeFlow(
      [req("b", "B", { staticInputs: { orderId: { type: "number", value: "42" } } })],
      []
    );
    const summary = await runFlowV2(f, h.deps, h.cb).done;
    expect(summary.status).toBe("success");
    expect(h.inputsOf("B")).toEqual([{ orderId: "42" }]);
  });
});

describe("streams", () => {
  it("emits an array item by item and accumulates it back", async () => {
    const h = makeHarness({
      R: { handler: (c) => ok({ id: `id-${c}` }), url: "http://test/{{x}}", outputs: ["id"] },
    });
    const f = makeFlow(
      [emitNode("emit", ["a", "b", "c"]), req("r", "R"), node("acc", "accumulator", {})],
      [edge("emit", "out:item", "r", "in:x"), edge("r", "out:id", "acc", "in:item")]
    );
    const summary = await runFlowV2(f, h.deps, h.cb).done;

    expect(summary.status).toBe("success");
    expect(h.inputsOf("R")).toEqual([{ x: "a" }, { x: "b" }, { x: "c" }]);
    expect(h.recordsOf("r").map((r) => r.iteration)).toEqual([0, 1, 2]);
    expect(h.recordsOf("acc")[0].outputs).toEqual({
      items: ["id-0", "id-1", "id-2"],
      count: 3,
      dropped: 0,
    });
    expect(summary.nodeItemCounts?.r).toEqual({ ok: 3, failed: 0, skipped: 0 });
  });

  it("exposes the item index alongside the item", async () => {
    const h = makeHarness({ R: { handler: () => ok(), url: "http://test/{{i}}" } });
    const f = makeFlow([emitNode("emit", ["x", "y"]), req("r", "R")], [edge("emit", "out:index", "r", "in:i")]);
    await runFlowV2(f, h.deps, h.cb).done;
    expect(h.inputsOf("R")).toEqual([{ i: "0" }, { i: "1" }]);
  });

  it("flattens a stream of arrays in sequence", async () => {
    const h = makeHarness({
      SRC: {
        handler: (c) => ok({ list: c === 0 ? ["a", "b"] : ["c"] }),
        url: "http://test/{{seed}}",
        outputs: ["list"],
      },
      R: { handler: () => ok(), url: "http://test/{{x}}" },
    });
    const f = makeFlow(
      [emitNode("outer", [1, 2]), req("src", "SRC"), node("inner", "arrayEmit", {}), req("r", "R")],
      [
        edge("outer", "out:item", "src", "in:seed"),
        edge("src", "out:list", "inner", "in:array"),
        edge("inner", "out:item", "r", "in:x"),
      ]
    );
    const summary = await runFlowV2(f, h.deps, h.cb).done;
    expect(summary.status).toBe("success");
    expect(h.inputsOf("R").map((b) => b.x)).toEqual(["a", "b", "c"]);
  });

  it("applies a connection path to each item", async () => {
    const h = makeHarness({ R: { handler: () => ok(), url: "http://test/{{x}}" } });
    const f = makeFlow(
      [emitNode("emit", [{ id: "one" }, { id: "two" }]), req("r", "R")],
      [edge("emit", "out:item", "r", "in:x", "$.id")]
    );
    await runFlowV2(f, h.deps, h.cb).done;
    expect(h.inputsOf("R").map((b) => b.x)).toEqual(["one", "two"]);
  });

  it("fails the emitter when a connected array exceeds the cap", async () => {
    const big = Array.from({ length: EMIT_MAX_ITEMS + 1 }, (_, i) => i);
    const h = makeHarness({
      SRC: { handler: () => ok({ list: big }), outputs: ["list"] },
      R: { handler: () => ok(), url: "http://test/{{x}}" },
    });
    const f = makeFlow(
      [req("src", "SRC"), node("emit", "arrayEmit", {}), req("r", "R")],
      [edge("src", "out:list", "emit", "in:array"), edge("emit", "out:item", "r", "in:x")]
    );
    const summary = await runFlowV2(f, h.deps, h.cb).done;
    expect(summary.status).toBe("failed");
    expect(h.status("emit")).toBe("failed");
    expect(h.recordsOf("emit").at(-1)?.error).toContain(`maximum of ${EMIT_MAX_ITEMS}`);
    expect(h.calls.get("R")).toBeUndefined();
    expect(h.status("r")).toBe("skipped");
  });
});

describe("zip and latch", () => {
  it("reuses a single value across every item of a stream", async () => {
    const h = makeHarness({
      AUTH: { handler: () => ok({ token: "tok-1" }), outputs: ["token"] },
      R: { handler: () => ok(), url: "http://test/{{x}}/{{t}}" },
    });
    const f = makeFlow(
      [emitNode("emit", ["a", "b", "c"]), req("auth", "AUTH"), req("r", "R")],
      [edge("emit", "out:item", "r", "in:x"), edge("auth", "out:token", "r", "in:t")]
    );
    const summary = await runFlowV2(f, h.deps, h.cb).done;
    expect(summary.status).toBe("success");
    expect(h.calls.get("AUTH")).toBe(1); // fetched once, latched for every item
    expect(h.inputsOf("R")).toEqual([
      { x: "a", t: "tok-1" },
      { x: "b", t: "tok-1" },
      { x: "c", t: "tok-1" },
    ]);
  });

  it("hard-fails a node whose streams have different lengths", async () => {
    const h = makeHarness({
      R: { handler: () => ok(), url: "http://test/{{a}}/{{b}}" },
      NEXT: { handler: () => ok(), url: "http://test/{{v}}" },
    });
    const f = makeFlow(
      [
        emitNode("e1", [1, 2, 3]),
        emitNode("e2", ["x", "y"]),
        node("m", "mux", { rows: [{ id: "r1", field: "a" }, { id: "r2", field: "b" }] }),
        req("next", "NEXT"),
      ],
      [
        edge("e1", "out:item", "m", "in:i:r1"),
        edge("e2", "out:item", "m", "in:i:r2"),
        edge("m", "out:object", "next", "in:v"),
      ]
    );
    const summary = await runFlowV2(f, h.deps, h.cb).done;
    expect(summary.status).toBe("failed");
    expect(h.status("m")).toBe("failed");
    expect(h.recordsOf("m").at(-1)?.error).toMatch(/ended after 2 items/);
    expect(h.status("next")).toBe("skipped");
  });
});

describe("continue on error", () => {
  it("drops the failed item and keeps the rest of the stream flowing", async () => {
    const h = makeHarness({
      R: { handler: (c) => (c === 1 ? httpError() : ok({ id: `id-${c}` })), url: "http://test/{{x}}", outputs: ["id"] },
    });
    const f = makeFlow(
      [emitNode("emit", ["a", "b", "c"]), req("r", "R"), node("acc", "accumulator", {})],
      [edge("emit", "out:item", "r", "in:x"), edge("r", "out:id", "acc", "in:item")]
    );
    const summary = await runFlowV2(f, h.deps, h.cb).done;

    expect(summary.status).toBe("failed"); // partial failure still fails the run
    expect(h.calls.get("R")).toBe(3); // every item was attempted
    expect(h.status("r")).toBe("partial");
    expect(summary.nodeItemCounts?.r).toEqual({ ok: 2, failed: 1, skipped: 0 });
    expect(h.recordsOf("acc")[0].outputs).toEqual({ items: ["id-0", "id-2"], count: 2, dropped: 1 });
  });

  it("keeps branches aligned when a hole forks and rejoins", async () => {
    // emit 3 → duplicator → (left fails on item 1 | right always ok) → mux → accumulator.
    // If the hole were silently dropped, left's item 2 would pair with right's item 1.
    const h = makeHarness({
      LEFT: { handler: (c) => (c === 1 ? httpError() : ok({ v: `L${c}` })), url: "http://test/{{x}}", outputs: ["v"] },
      RIGHT: { handler: (c) => ok({ v: `R${c}` }), url: "http://test/{{x}}", outputs: ["v"] },
    });
    const f = makeFlow(
      [
        emitNode("emit", ["a", "b", "c"]),
        node("dup", "duplicator", { count: 2 }),
        req("left", "LEFT"),
        req("right", "RIGHT"),
        node("m", "mux", { rows: [{ id: "r1", field: "l" }, { id: "r2", field: "r" }] }),
        node("acc", "accumulator", {}),
      ],
      [
        edge("emit", "out:item", "dup", "in:value"),
        edge("dup", "out:o:0", "left", "in:x"),
        edge("dup", "out:o:1", "right", "in:x"),
        edge("left", "out:v", "m", "in:i:r1"),
        edge("right", "out:v", "m", "in:i:r2"),
        edge("m", "out:object", "acc", "in:item"),
      ]
    );
    const summary = await runFlowV2(f, h.deps, h.cb).done;

    expect(h.calls.get("RIGHT")).toBe(3); // the right branch never saw a failure
    // Position 1 was holed on both sides — 0 and 2 pair with their own partners.
    expect(h.recordsOf("acc")[0].outputs).toEqual({
      items: [
        { l: "L0", r: "R0" },
        { l: "L2", r: "R2" },
      ],
      count: 2,
      dropped: 1,
    });
    expect(summary.status).toBe("failed");
  });

  it("records a skipped item where a request was bypassed by a hole", async () => {
    const h = makeHarness({
      FIRST: { handler: (c) => (c === 0 ? httpError() : ok({ v: "v" })), url: "http://test/{{x}}", outputs: ["v"] },
      SECOND: { handler: () => ok(), url: "http://test/{{x}}" },
    });
    const f = makeFlow(
      [emitNode("emit", ["a", "b"]), req("first", "FIRST"), req("second", "SECOND")],
      [edge("emit", "out:item", "first", "in:x"), edge("first", "out:v", "second", "in:x")]
    );
    await runFlowV2(f, h.deps, h.cb).done;

    const secondRecords = h.recordsOf("second");
    expect(secondRecords[0].status).toBe("skipped");
    expect(secondRecords[0].error).toContain('item failed upstream in "first"');
    expect(h.calls.get("SECOND")).toBe(1); // only the surviving item was sent
  });
});

describe("demux and mux", () => {
  it("splits an object into one output per configured path", async () => {
    const h = makeHarness({
      SRC: { handler: () => ok({ fruit: { name: "apple", color: "red" } }), outputs: ["fruit"] },
      NAME: { handler: () => ok(), url: "http://test/{{v}}" },
      COLOR: { handler: () => ok(), url: "http://test/{{v}}" },
    });
    const f = makeFlow(
      [
        req("src", "SRC"),
        node("d", "demux", { rows: [{ id: "r1", path: "$.name" }, { id: "r2", path: "$.color" }] }),
        req("n", "NAME"),
        req("c", "COLOR"),
      ],
      [
        edge("src", "out:fruit", "d", "in:object"),
        edge("d", "out:o:r1", "n", "in:v"),
        edge("d", "out:o:r2", "c", "in:v"),
      ]
    );
    const summary = await runFlowV2(f, h.deps, h.cb).done;
    expect(summary.status).toBe("success");
    expect(h.inputsOf("NAME")).toEqual([{ v: "apple" }]);
    expect(h.inputsOf("COLOR")).toEqual([{ v: "red" }]);
  });

  it("holes only the output whose path missed", async () => {
    const h = makeHarness({
      SRC: { handler: () => ok({ fruit: { name: "apple" } }), outputs: ["fruit"] },
      NAME: { handler: () => ok(), url: "http://test/{{v}}" },
      COLOR: { handler: () => ok(), url: "http://test/{{v}}" },
    });
    const f = makeFlow(
      [
        req("src", "SRC"),
        node("d", "demux", { rows: [{ id: "r1", path: "$.name" }, { id: "r2", path: "$.color" }] }),
        req("n", "NAME"),
        req("c", "COLOR"),
      ],
      [
        edge("src", "out:fruit", "d", "in:object"),
        edge("d", "out:o:r1", "n", "in:v"),
        edge("d", "out:o:r2", "c", "in:v"),
      ]
    );
    await runFlowV2(f, h.deps, h.cb).done;
    expect(h.inputsOf("NAME")).toEqual([{ v: "apple" }]); // unaffected branch still ran
    expect(h.calls.get("COLOR")).toBeUndefined();
    expect(h.recordsOf("c")[0].status).toBe("skipped");
  });

  it("combines several inputs into one object", async () => {
    const h = makeHarness({
      A: { handler: () => ok({ v: "1" }), outputs: ["v"] },
      B: { handler: () => ok({ v: "2" }), outputs: ["v"] },
      SINK: { handler: () => ok(), url: "http://test/{{obj}}" },
    });
    const f = makeFlow(
      [
        req("a", "A"),
        req("b", "B"),
        node("m", "mux", { rows: [{ id: "r1", field: "first" }, { id: "r2", field: "second" }] }),
        req("sink", "SINK"),
      ],
      [
        edge("a", "out:v", "m", "in:i:r1"),
        edge("b", "out:v", "m", "in:i:r2"),
        edge("m", "out:object", "sink", "in:obj"),
      ]
    );
    await runFlowV2(f, h.deps, h.cb).done;
    expect(h.inputsOf("SINK")).toEqual([{ obj: '{"first":"1","second":"2"}' }]);
  });
});

describe("request verification", () => {
  it("retries an item until its checks pass", async () => {
    const h = makeHarness({
      CHECK: { handler: (c) => ok({}, { state: c === 0 ? "PENDING" : "DONE" }) },
    });
    const verify = {
      enabled: true,
      checks: [{ id: "c1", path: "$.body.state", operator: "equals", expectedSource: "static", expected: "DONE" }],
      maxAttempts: 3,
      intervalMs: 1,
    };
    const f = makeFlow([req("v", "CHECK", { verify })], []);
    const summary = await runFlowV2(f, h.deps, h.cb).done;

    expect(summary.status).toBe("success");
    expect(h.recordsOf("v").map((r) => [r.attempt, r.status])).toEqual([
      [1, "failed"],
      [2, "success"],
    ]);
  });

  it("verifies every item of a stream independently", async () => {
    // item 0 passes first try; item 1 needs a retry.
    let call = 0;
    const h = makeHarness({
      CHECK: {
        handler: () => {
          const n = call++;
          const state = n === 0 || n === 2 ? "DONE" : "PENDING";
          return ok({}, { state });
        },
        url: "http://test/{{x}}",
      },
    });
    const verify = {
      enabled: true,
      checks: [{ id: "c1", path: "$.body.state", operator: "equals", expectedSource: "static", expected: "DONE" }],
      maxAttempts: 3,
      intervalMs: 1,
    };
    const f = makeFlow(
      [emitNode("emit", ["a", "b"]), req("v", "CHECK", { verify })],
      [edge("emit", "out:item", "v", "in:x")]
    );
    const summary = await runFlowV2(f, h.deps, h.cb).done;
    expect(summary.status).toBe("success");
    expect(h.recordsOf("v").map((r) => [r.iteration, r.attempt, r.status])).toEqual([
      [0, 1, "success"],
      [1, 1, "failed"],
      [1, 2, "success"],
    ]);
  });

  it("takes an expected value from a connected port", async () => {
    const h = makeHarness({
      EXPECT: { handler: () => ok({ total: 7 }), outputs: ["total"] },
      CHECK: { handler: () => ok({}, { total: 7 }) },
    });
    const verify = {
      enabled: true,
      checks: [{ id: "c1", path: "$.body.total", operator: "equals", expectedSource: "port", expected: "" }],
      maxAttempts: 1,
      intervalMs: 0,
    };
    const f = makeFlow(
      [req("e", "EXPECT"), req("v", "CHECK", { verify })],
      [edge("e", "out:total", "v", "in:cmp:c1")]
    );
    const summary = await runFlowV2(f, h.deps, h.cb).done;
    expect(summary.status).toBe("success");
    expect(h.recordsOf("v").at(-1)?.status).toBe("success");
  });
});

describe("scheduling", () => {
  it("pipelines items — a later item enters the first node before the previous leaves the second", async () => {
    const gate = deferred<ExecutorResult>();
    const h = makeHarness({
      FIRST: { handler: () => ok({ v: "x" }), url: "http://test/{{x}}", outputs: ["v"] },
      SECOND: { handler: (c) => (c === 0 ? gate.promise : ok()), url: "http://test/{{x}}" },
    });
    const f = makeFlow(
      [emitNode("emit", ["a", "b"]), req("first", "FIRST"), req("second", "SECOND")],
      [edge("emit", "out:item", "first", "in:x"), edge("first", "out:v", "second", "in:x")]
    );
    const handle = runFlowV2(f, h.deps, h.cb);
    await flush();
    await flush();
    // "second" is parked on item 0 while "first" has already taken item 1.
    expect(h.calls.get("SECOND")).toBe(1);
    expect(h.calls.get("FIRST")).toBe(2);
    gate.resolve(ok());
    expect((await handle.done).status).toBe("success");
  });

  it("a done → after connection makes the downstream node wait for the whole stream", async () => {
    const order: string[] = [];
    const h = makeHarness({
      R: {
        handler: (c) => {
          order.push(`r${c}`);
          return ok();
        },
        url: "http://test/{{x}}",
      },
      AFTER: {
        handler: () => {
          order.push("after");
          return ok();
        },
      },
    });
    const f = makeFlow(
      [emitNode("emit", ["a", "b", "c"]), req("r", "R"), req("after", "AFTER")],
      [edge("emit", "out:item", "r", "in:x"), edge("r", "done", "after", "after")]
    );
    const summary = await runFlowV2(f, h.deps, h.cb).done;
    expect(summary.status).toBe("success");
    expect(order).toEqual(["r0", "r1", "r2", "after"]);
  });

  it("cancels mid-stream", async () => {
    const gate = deferred<ExecutorResult>();
    const h = makeHarness({
      R: { handler: (c) => (c === 0 ? gate.promise : ok()), url: "http://test/{{x}}" },
    });
    const f = makeFlow([emitNode("emit", ["a", "b", "c"]), req("r", "R")], [edge("emit", "out:item", "r", "in:x")]);
    const handle = runFlowV2(f, h.deps, h.cb);
    await flush();
    handle.cancel();
    gate.resolve(ok());
    const summary = await handle.done;
    expect(summary.status).toBe("cancelled");
  });

  it("refuses to start an invalid flow", async () => {
    const h = makeHarness({ A: { handler: () => ok() } });
    const f = makeFlow([req("a", "A"), req("b", "A")], [edge("a", "out:gone", "b", "in:nope")]);
    await expect(runFlowV2(f, h.deps, h.cb).done).rejects.toThrow(/missing port/);
    expect(h.calls.size).toBe(0);
  });
});
