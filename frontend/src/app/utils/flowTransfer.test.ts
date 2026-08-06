// Round-trip and matching tests for the flow export/import format.

import { describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import {
  FLOW_EXPORT_FORMAT,
  FLOW_EXPORT_VERSION,
  flowExportFilename,
  parseFlowImport,
  prepareImportedFlow,
  serializeFlowForExport,
} from "./flowTransfer";
import type { FlowV2, RequestNodeConfigV2, RequestSnapshotV2 } from "./flowTypesV2";

// Same shallow mock the other V2 suites use. Exact-id lookups in these tests
// only ever hit top-level requests; the nested-collection case exercises
// walkRequests, which traverses children itself rather than through this.
vi.mock("../context/AppContext", () => ({
  findRequestInTree: (col: { requests?: { id: string }[] }, requestId: string) =>
    (col.requests || []).find((r) => r.id === requestId) || null,
}));

const savedRequest = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  method: "POST",
  url: `http://test/${id}/{{seq}}`,
  headers: [],
  queryParams: [],
  bodyType: "none",
  body: "",
  authType: "none",
  authConfig: {},
  inputs: [],
  outputs: ["tracking_id"],
  ...overrides,
});

type Collections = Parameters<typeof serializeFlowForExport>[1];

const collections = [
  {
    id: "col",
    requests: [savedRequest("req_order", "Create order")],
    children: [],
  },
] as unknown as Collections;

const requestNode = (id: string, requestId: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type: "request" as const,
  position: { x: 0, y: 0 },
  config: { requestId, staticInputs: {}, ...extra },
});

const makeFlow = (nodes: FlowV2["nodes"], edges: FlowV2["edges"] = []): FlowV2 => ({
  id: "flow",
  name: "Order Flow",
  description: "creates orders",
  schemaVersion: 2,
  nodes,
  edges,
});

const SNAPSHOT: RequestSnapshotV2 = {
  name: "Create order",
  method: "POST",
  url: "http://test/req_order/{{seq}}",
  inputs: ["seq"],
  outputs: ["tracking_id"],
};

describe("export", () => {
  it("round-trips through YAML with an interface snapshot per request", () => {
    const flow = makeFlow([requestNode("order", "req_order")]);
    const text = serializeFlowForExport(flow, collections, "yaml");
    expect(text).not.toContain("headers"); // interface only — nothing else travels

    const parsed = parseFlowImport(text);
    expect(parsed.flow.name).toBe("Order Flow");
    expect(parsed.flow.nodes).toEqual(flow.nodes);
    expect(parsed.requests.req_order).toEqual(SNAPSHOT);
  });

  it("round-trips through JSON identically", () => {
    const flow = makeFlow([requestNode("order", "req_order")]);
    const yaml = parseFlowImport(serializeFlowForExport(flow, collections, "yaml"));
    const json = parseFlowImport(serializeFlowForExport(flow, collections, "json"));
    expect(json.flow).toEqual(yaml.flow);
    expect(json.requests).toEqual(yaml.requests);
  });

  it("strips a stale snapshot from a node whose request resolves", () => {
    const flow = makeFlow([requestNode("order", "req_order", { expected: SNAPSHOT })]);
    const parsed = parseFlowImport(serializeFlowForExport(flow, collections, "yaml"));
    expect((parsed.flow.nodes[0].config as RequestNodeConfigV2).expected).toBeUndefined();
  });

  it("keeps the stored snapshot for a request already missing at export time", () => {
    const flow = makeFlow([requestNode("order", "req_gone", { expected: SNAPSHOT })]);
    const parsed = parseFlowImport(serializeFlowForExport(flow, collections, "yaml"));
    expect(parsed.requests.req_gone).toEqual(SNAPSHOT);
    expect((parsed.flow.nodes[0].config as RequestNodeConfigV2).expected).toEqual(SNAPSHOT);
  });

  it("builds a filename slug per format", () => {
    expect(flowExportFilename("Order Flow!", "yaml")).toBe("order-flow.flow.yaml");
    expect(flowExportFilename("Order Flow!", "json")).toBe("order-flow.flow.json");
    expect(flowExportFilename("???", "yaml")).toBe("flow.flow.yaml");
  });
});

describe("parseFlowImport rejections", () => {
  it("rejects files that are not flow exports, with a reason", () => {
    expect(() => parseFlowImport("{not json")).toThrow(/Not a readable/);
    expect(() => parseFlowImport('{"format": "nv-collection-export"}')).toThrow(/not an API Studio flow export/);
    expect(() =>
      parseFlowImport(YAML.stringify({ format: FLOW_EXPORT_FORMAT, version: 99, flow: { nodes: [], edges: [] } }))
    ).toThrow(/version 99/);
    expect(() =>
      parseFlowImport(
        YAML.stringify({
          format: FLOW_EXPORT_FORMAT,
          version: FLOW_EXPORT_VERSION,
          flow: { name: "old", schemaVersion: 1, nodes: [], edges: [] },
        })
      )
    ).toThrow(/legacy flow/);
    expect(() =>
      parseFlowImport(YAML.stringify({ format: FLOW_EXPORT_FORMAT, version: FLOW_EXPORT_VERSION, flow: { name: "x" } }))
    ).toThrow(/nodes and edges/);
  });
});

describe("prepareImportedFlow", () => {
  const exported = (nodes: FlowV2["nodes"], requests: Record<string, RequestSnapshotV2>) => ({
    format: FLOW_EXPORT_FORMAT as typeof FLOW_EXPORT_FORMAT,
    version: FLOW_EXPORT_VERSION,
    exportedAt: "",
    flow: { name: "Order Flow", description: "", schemaVersion: 2 as const, nodes, edges: [] },
    requests,
  });

  it("counts an exact requestId hit as matched", () => {
    const prepared = prepareImportedFlow(
      exported([requestNode("order", "req_order")], { req_order: SNAPSHOT }),
      [],
      collections
    );
    expect(prepared.summary).toEqual({ matched: 1, autoLinked: [], missing: [] });
    expect((prepared.nodes[0].config as RequestNodeConfigV2).requestId).toBe("req_order");
  });

  it("auto-links a unique name+method match, rewriting the requestId", () => {
    const prepared = prepareImportedFlow(
      exported([requestNode("order", "req_other_workspace_id")], { req_other_workspace_id: SNAPSHOT }),
      [],
      collections
    );
    expect(prepared.summary.autoLinked).toEqual([
      { nodeName: "order", requestName: "Create order", method: "POST" },
    ]);
    const cfg = prepared.nodes[0].config as RequestNodeConfigV2;
    expect(cfg.requestId).toBe("req_order");
    expect(cfg.expected).toBeUndefined();
  });

  it("treats an ambiguous name+method (two candidates) as missing, never guessing", () => {
    const twins = [
      { id: "col", requests: [savedRequest("req_a", "Create order"), savedRequest("req_b", "Create order")], children: [] },
    ] as unknown as Collections;
    const prepared = prepareImportedFlow(
      exported([requestNode("order", "req_x")], { req_x: SNAPSHOT }),
      [],
      twins
    );
    expect(prepared.summary.autoLinked).toEqual([]);
    expect(prepared.summary.missing).toEqual([{ nodeName: "order", snapshot: SNAPSHOT }]);
  });

  it("finds a name+method match nested inside child collections", () => {
    const nested = [
      { id: "root", requests: [], children: [{ id: "sub", requests: [savedRequest("req_deep", "Create order")], children: [] }] },
    ] as unknown as Collections;
    const prepared = prepareImportedFlow(
      exported([requestNode("order", "req_x")], { req_x: SNAPSHOT }),
      [],
      nested
    );
    expect(prepared.summary.autoLinked.length).toBe(1);
    expect((prepared.nodes[0].config as RequestNodeConfigV2).requestId).toBe("req_deep");
  });

  it("injects the snapshot as config.expected when nothing matches", () => {
    const prepared = prepareImportedFlow(
      exported([requestNode("order", "req_x")], { req_x: SNAPSHOT }),
      [],
      [] as unknown as Collections
    );
    expect(prepared.summary.missing).toEqual([{ nodeName: "order", snapshot: SNAPSHOT }]);
    expect((prepared.nodes[0].config as RequestNodeConfigV2).expected).toEqual(SNAPSHOT);
  });

  it("records a missing node with no snapshot as missing with null", () => {
    const prepared = prepareImportedFlow(
      exported([requestNode("order", "req_x")], {}),
      [],
      [] as unknown as Collections
    );
    expect(prepared.summary.missing).toEqual([{ nodeName: "order", snapshot: null }]);
    expect((prepared.nodes[0].config as RequestNodeConfigV2).expected).toBeUndefined();
  });

  it("runs the type-rename migration on imported nodes", () => {
    const demux = {
      id: "d", name: "d", type: "demux" as FlowV2["nodes"][0]["type"],
      position: { x: 0, y: 0 }, config: { rows: [{ id: "r1", path: "$.a" }] },
    };
    const prepared = prepareImportedFlow(exported([demux], {}), [], collections);
    expect(prepared.nodes[0].type).toBe("splitter");
  });

  it("uniquifies the flow name against existing flows", () => {
    const prepared = prepareImportedFlow(
      exported([], {}),
      ["Order Flow", "Order Flow 2"],
      collections
    );
    expect(prepared.name).toBe("Order Flow 3");
  });
});
