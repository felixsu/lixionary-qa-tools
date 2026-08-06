// Schema tests for the V2 streaming model: handle grammar, port derivation per
// node type, typed hardcoded inputs, and structural validation (one-to-one
// wiring, per-type config rules, cycles, stream-arity warnings).

import { describe, expect, it, vi } from "vitest";
import {
  dataInHandle,
  dataOutHandle,
  demuxOutName,
  edgeKindV2,
  EMIT_MAX_ITEMS,
  flowErrorsV2,
  isFlowV2,
  isKnownNodeTypeV2,
  migrateFlowV2,
  muxInName,
  nodePorts,
  parseHandle,
  parseStaticInput,
  portLabel,
  validateFlowV2,
  verifyCheckPortName,
  type FlowEdgeV2,
  type FlowNodeV2,
  type FlowV2,
} from "./flowTypesV2";

vi.mock("../context/AppContext", () => ({
  findRequestInTree: (col: { requests?: { id: string }[] }, requestId: string) =>
    (col.requests || []).find((r) => r.id === requestId) || null,
}));

const savedRequest = (id: string, overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

const collections = [
  {
    id: "col",
    requests: [
      savedRequest("req1", { url: "http://test/{{orderId}}", outputs: ["uuid"] }),
      savedRequest("req2", { outputs: ["total"] }),
    ],
  },
] as unknown as Parameters<typeof nodePorts>[1];

const node = (id: string, type: FlowNodeV2["type"], config: FlowNodeV2["config"]): FlowNodeV2 => ({
  id,
  name: id,
  type,
  position: { x: 0, y: 0 },
  config,
});

const requestNode = (id: string, requestId = "req1", extra: Record<string, unknown> = {}) =>
  node(id, "request", { requestId, staticInputs: {}, ...extra });

const edge = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string
): FlowEdgeV2 => ({ id, source, target, sourceHandle, targetHandle });

const makeFlow = (nodes: FlowNodeV2[], edges: FlowEdgeV2[]): FlowV2 => ({
  id: "flow",
  name: "flow",
  schemaVersion: 2,
  nodes,
  edges,
});

const errors = (flow: FlowV2) => flowErrorsV2(validateFlowV2(flow, collections)).map((i) => i.message);
const warnings = (flow: FlowV2) =>
  validateFlowV2(flow, collections)
    .filter((i) => i.level === "warning")
    .map((i) => i.message);

describe("handle grammar", () => {
  it("parses data and trigger handles", () => {
    expect(parseHandle(dataInHandle("orderId"))).toEqual({ kind: "data", direction: "in", name: "orderId" });
    expect(parseHandle(dataOutHandle("uuid"))).toEqual({ kind: "data", direction: "out", name: "uuid" });
    expect(parseHandle("after")).toEqual({ kind: "trigger", direction: "in", name: null });
    expect(parseHandle("done")).toEqual({ kind: "trigger", direction: "out", name: null });
    expect(parseHandle("nope")).toBeNull();
  });

  it("keeps row ids intact inside config-derived port names", () => {
    expect(parseHandle(dataOutHandle(demuxOutName("abc-123")))?.name).toBe("o:abc-123");
    expect(parseHandle(dataInHandle(muxInName("abc-123")))?.name).toBe("i:abc-123");
    expect(parseHandle(dataInHandle(verifyCheckPortName("c1")))?.name).toBe("cmp:c1");
  });

  it("classifies edges as data or trigger", () => {
    expect(edgeKindV2({ sourceHandle: "out:a", targetHandle: "in:b" })).toBe("data");
    expect(edgeKindV2({ sourceHandle: "done", targetHandle: "after" })).toBe("trigger");
  });
});

describe("typed hardcoded inputs", () => {
  it("parses each declared type", () => {
    expect(parseStaticInput({ type: "string", value: "hi" })).toEqual({ ok: true, value: "hi" });
    expect(parseStaticInput({ type: "number", value: " 42 " })).toEqual({ ok: true, value: 42 });
    expect(parseStaticInput({ type: "boolean", value: "true" })).toEqual({ ok: true, value: true });
    expect(parseStaticInput({ type: "json", value: '{"a":1}' })).toEqual({ ok: true, value: { a: 1 } });
  });

  it("rejects values that don't match their type", () => {
    expect(parseStaticInput({ type: "number", value: "abc" }).ok).toBe(false);
    expect(parseStaticInput({ type: "boolean", value: "yes" }).ok).toBe(false);
    expect(parseStaticInput({ type: "json", value: "{oops" }).ok).toBe(false);
  });

  it("passes tokens through untouched for the executor to resolve", () => {
    expect(parseStaticInput({ type: "number", value: "{{env.PORT}}" })).toEqual({
      ok: true,
      value: "{{env.PORT}}",
    });
  });
});

describe("nodePorts", () => {
  it("derives request ports from the saved request, with no `each` driver by default", () => {
    const ports = nodePorts(requestNode("n1"), collections);
    expect(ports.map((p) => p.id)).toEqual(["after", "done", "in:orderId", "out:uuid"]);
  });

  it("adds the `each` driver when enabled, namespaced so request tokens can't collide", () => {
    const collides = [
      { id: "col", requests: [savedRequest("reqEach", { url: "http://test/{{each}}" })] },
    ] as unknown as Parameters<typeof nodePorts>[1];
    const ids = nodePorts(requestNode("n1", "reqEach", { useEach: true }), collides).map((p) => p.id);
    // the request's own {{each}} token and the repeat driver are distinct ports
    expect(ids).toContain("in:each");
    expect(ids).toContain("in:ctl:each");
    const driver = nodePorts(requestNode("n2", "req1", { useEach: true }), collections).find(
      (p) => p.id === "in:ctl:each"
    )!;
    expect(portLabel(driver)).toBe("each");
    expect(driver.widget).toBe("none"); // drives execution, never hardcoded
  });

  it("adds verify ports only when verification is enabled", () => {
    const verify = {
      enabled: true,
      checks: [
        { id: "c1", path: "$.total", operator: "equals", expectedSource: "port", expected: "" },
        { id: "c2", path: "$.status", operator: "equals", expectedSource: "static", expected: "200" },
      ],
      maxAttempts: 3,
      intervalMs: 100,
    };
    const ids = nodePorts(requestNode("n1", "req1", { verify }), collections).map((p) => p.id);
    expect(ids).toContain("in:cmp:c1");
    expect(ids).not.toContain("in:cmp:c2");
    // Verification never adds an output: a failing item is dropped, so a
    // "passed" port could only ever emit true.
    expect(ids).not.toContain("out:passed");
  });

  it("gives arrayEmit an array input and item/index outputs", () => {
    const ports = nodePorts(node("e", "arrayEmit", {}), collections);
    expect(ports.map((p) => p.id)).toEqual(["after", "done", "in:array", "out:item", "out:index"]);
  });

  it("gives accumulator array/count outputs", () => {
    const ports = nodePorts(node("a", "accumulator", {}), collections);
    expect(ports.map((p) => p.id)).toEqual(["after", "done", "in:item", "out:array", "out:count"]);
  });

  it("gives delay a passthrough port so it can pace a stream", () => {
    const ports = nodePorts(node("d", "delay", { ms: 10 }), collections);
    expect(ports.map((p) => p.id)).toEqual(["after", "done", "in:value", "out:value"]);
  });

  it("derives one demux output per row, labelled by its path", () => {
    const n = node("d", "demux", { rows: [{ id: "r1", path: "$.name" }, { id: "r2", path: "$.color" }] });
    const ports = nodePorts(n, collections).filter((p) => p.direction === "out" && p.kind === "data");
    expect(ports.map((p) => p.id)).toEqual(["out:o:r1", "out:o:r2"]);
    expect(ports.map((p) => portLabel(p))).toEqual(["$.name", "$.color"]);
  });

  it("derives one mux input per row, labelled by its field", () => {
    const n = node("m", "mux", { rows: [{ id: "r1", field: "name" }, { id: "r2", field: "color" }] });
    const ports = nodePorts(n, collections).filter((p) => p.direction === "in" && p.kind === "data");
    expect(ports.map((p) => p.id)).toEqual(["in:i:r1", "in:i:r2"]);
    expect(ports.map((p) => portLabel(p))).toEqual(["name", "color"]);
  });

});

describe("validateFlowV2 — wiring", () => {
  it("accepts a well-formed streaming flow", () => {
    const flow = makeFlow(
      [
        node("emit", "arrayEmit", { staticItems: { type: "json", value: '["a","b"]' } }),
        requestNode("req"),
        node("acc", "accumulator", {}),
      ],
      [
        edge("e1", "emit", "out:item", "req", "in:orderId"),
        edge("e2", "req", "out:uuid", "acc", "in:item"),
      ]
    );
    expect(errors(flow)).toEqual([]);
  });

  it("allows one output to feed several inputs", () => {
    const flow = makeFlow(
      [requestNode("a"), requestNode("b"), requestNode("c")],
      [
        edge("e1", "a", "out:uuid", "b", "in:orderId"),
        edge("e2", "a", "out:uuid", "c", "in:orderId"),
      ]
    );
    expect(errors(flow)).toEqual([]);
  });

  it("rejects a second connection into one input", () => {
    const flow = makeFlow(
      [requestNode("a"), requestNode("b"), requestNode("c")],
      [
        edge("e1", "a", "out:uuid", "c", "in:orderId"),
        edge("e2", "b", "out:uuid", "c", "in:orderId"),
      ]
    );
    expect(errors(flow).some((m) => m.includes("more than one connection"))).toBe(true);
  });

  it("allows triggers to fan in and out", () => {
    const flow = makeFlow(
      [requestNode("a"), requestNode("b"), requestNode("c")],
      [
        edge("e1", "a", "done", "b", "after"),
        edge("e2", "a", "done", "c", "after"),
        edge("e3", "b", "done", "c", "after"),
      ]
    );
    expect(errors(flow)).toEqual([]);
  });

  it("rejects mixing data and trigger ports", () => {
    const flow = makeFlow(
      [requestNode("a"), requestNode("b")],
      [edge("e1", "a", "out:uuid", "b", "after")]
    );
    expect(errors(flow).some((m) => m.includes("joins a data port to a trigger port"))).toBe(true);
  });

  it("flags a connection whose port no longer exists", () => {
    const flow = makeFlow(
      [requestNode("a"), requestNode("b")],
      [edge("e1", "a", "out:gone", "b", "in:orderId")]
    );
    expect(errors(flow).some((m) => m.includes('missing port "out:gone"'))).toBe(true);
  });

  it("detects cycles across data and trigger edges alike", () => {
    const flow = makeFlow(
      [requestNode("a"), requestNode("b")],
      [edge("e1", "a", "done", "b", "after"), edge("e2", "b", "done", "a", "after")]
    );
    expect(errors(flow).some((m) => m.includes("cycle"))).toBe(true);
  });
});

describe("validateFlowV2 — per-type config", () => {
  it("requires arrayEmit to have a source of items", () => {
    const flow = makeFlow([node("e", "arrayEmit", { staticItems: { type: "json", value: "nope" } })], []);
    expect(errors(flow).some((m) => m.includes("connect the array input"))).toBe(true);
  });

  it("caps a static array at the emitter limit", () => {
    const items = JSON.stringify(Array.from({ length: EMIT_MAX_ITEMS + 1 }, (_, i) => i));
    const flow = makeFlow([node("e", "arrayEmit", { staticItems: { type: "json", value: items } })], []);
    expect(errors(flow).some((m) => m.includes(`over the maximum of ${EMIT_MAX_ITEMS}`))).toBe(true);
  });

  it("requires demux rows to have paths", () => {
    const flow = makeFlow([node("d", "demux", { rows: [{ id: "r1", path: "" }] })], []);
    expect(errors(flow).some((m) => m.includes("output with no path"))).toBe(true);
  });

  it("requires mux to have at least two uniquely-named inputs", () => {
    const single = makeFlow([node("m", "mux", { rows: [{ id: "r1", field: "a" }] })], []);
    expect(errors(single).some((m) => m.includes("at least two inputs"))).toBe(true);

    const dup = makeFlow(
      [node("m", "mux", { rows: [{ id: "r1", field: "a" }, { id: "r2", field: "a" }] })],
      []
    );
    expect(errors(dup).some((m) => m.includes('field name "a" twice'))).toBe(true);
  });

  it("checks the request verify block", () => {
    const noChecks = makeFlow(
      [requestNode("r", "req1", { verify: { enabled: true, checks: [], maxAttempts: 3, intervalMs: 0 } })],
      []
    );
    expect(errors(noChecks).some((m) => m.includes("no checks"))).toBe(true);

    const unconnectedPort = makeFlow(
      [
        requestNode("r", "req1", {
          verify: {
            enabled: true,
            checks: [{ id: "c1", path: "$.total", operator: "equals", expectedSource: "port", expected: "" }],
            maxAttempts: 3,
            intervalMs: 0,
          },
        }),
      ],
      []
    );
    expect(errors(unconnectedPort).some((m) => m.includes("expected-value port"))).toBe(true);
  });

  it("rejects hardcoded values that don't match their type", () => {
    const flow = makeFlow(
      [requestNode("r", "req1", { staticInputs: { orderId: { type: "number", value: "abc" } } })],
      []
    );
    expect(errors(flow).some((m) => m.includes("is not a number"))).toBe(true);
  });

  it("rejects unknown node types left over from an older format", () => {
    const flow = makeFlow([node("old", "loop" as FlowNodeV2["type"], {} as FlowNodeV2["config"])], []);
    expect(errors(flow).some((m) => m.includes("unsupported type"))).toBe(true);
    expect(isKnownNodeTypeV2("loop")).toBe(false);
    expect(isKnownNodeTypeV2("arrayEmit")).toBe(true);
  });
});

describe("validateFlowV2 — stream arity warnings", () => {
  it("warns when a node pairs inputs from two different emitters", () => {
    const flow = makeFlow(
      [
        node("e1", "arrayEmit", { staticItems: { type: "json", value: "[1,2]" } }),
        node("e2", "arrayEmit", { staticItems: { type: "json", value: "[1,2,3]" } }),
        node("m", "mux", { rows: [{ id: "r1", field: "a" }, { id: "r2", field: "b" }] }),
      ],
      [
        edge("x1", "e1", "out:item", "m", "in:i:r1"),
        edge("x2", "e2", "out:item", "m", "in:i:r2"),
      ]
    );
    expect(warnings(flow).some((m) => m.includes("driven by different emitters"))).toBe(true);
  });

  it("stays quiet when a scalar is latched alongside a stream", () => {
    const flow = makeFlow(
      [
        node("e1", "arrayEmit", { staticItems: { type: "json", value: "[1,2]" } }),
        requestNode("token", "req2"),
        node("m", "mux", { rows: [{ id: "r1", field: "a" }, { id: "r2", field: "b" }] }),
      ],
      [
        edge("x1", "e1", "out:item", "m", "in:i:r1"),
        edge("x2", "token", "out:total", "m", "in:i:r2"),
      ]
    );
    expect(warnings(flow).some((m) => m.includes("driven by different emitters"))).toBe(false);
  });

  it("stays quiet when both inputs descend from the same emitter", () => {
    const flow = makeFlow(
      [
        node("e", "arrayEmit", { staticItems: { type: "json", value: "[1,2]" } }),
        node("m", "mux", { rows: [{ id: "r1", field: "a" }, { id: "r2", field: "b" }] }),
      ],
      [
        edge("x1", "e", "out:item", "m", "in:i:r1"),
        edge("x2", "e", "out:item", "m", "in:i:r2"),
      ]
    );
    expect(warnings(flow).some((m) => m.includes("driven by different emitters"))).toBe(false);
  });

  it("warns when an accumulator is fed a single value", () => {
    const flow = makeFlow(
      [requestNode("r"), node("acc", "accumulator", {})],
      [edge("x1", "r", "out:uuid", "acc", "in:item")]
    );
    expect(warnings(flow).some((m) => m.includes("accumulates a single value"))).toBe(true);
  });
});

describe("migrateFlowV2", () => {
  it("turns on `each` for a request already wired to it", () => {
    const nodes = [node("emit", "arrayEmit", { staticItems: { type: "number", value: "2" } }), requestNode("r")];
    const edges = [edge("e1", "emit", "out:index", "r", "in:ctl:each")];
    const migrated = migrateFlowV2(nodes, edges);
    const request = migrated.nodes.find((n) => n.id === "r")!;
    expect((request.config as { useEach?: boolean }).useEach).toBe(true);
    // the port is back, so the existing connection still resolves
    expect(nodePorts(request, collections).map((p) => p.id)).toContain("in:ctl:each");
    expect(flowErrorsV2(validateFlowV2(makeFlow(migrated.nodes, migrated.edges), collections))).toEqual([]);
  });

  it("leaves requests without an each connection alone", () => {
    const migrated = migrateFlowV2([requestNode("r")], []);
    expect((migrated.nodes[0].config as { useEach?: boolean }).useEach).toBeUndefined();
  });
});

describe("misc", () => {
  it("discriminates V2 flows", () => {
    expect(isFlowV2({ schemaVersion: 2 })).toBe(true);
    expect(isFlowV2({})).toBe(false);
    expect(isFlowV2(null)).toBe(false);
  });
});
