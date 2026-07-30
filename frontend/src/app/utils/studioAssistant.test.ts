// Tests for the AI canvas assistant's pure logic: request-name resolution,
// proposal validation/simulation, layout determinism, and catalog assembly.

import { describe, expect, it, vi } from "vitest";
import {
  buildCatalog,
  buildCanvasContext,
  resolveRequestName,
  validateAndPlan,
  toWireCatalog,
  CATALOG_LIMIT,
  type AssistantAction,
  type CatalogRow,
} from "./studioAssistant";
import { topoSort } from "./flowRunner";
import type { FlowNode, FlowEdge, RequestNodeConfig, LooperNodeConfig, DelayNodeConfig } from "./flowTypes";

// AppContext is Next-coupled; the assistant logic only needs request lookup.
vi.mock("../context/AppContext", () => ({
  findRequestInTree: (col: any, requestId: string) =>
    (col.requests || []).find((r: any) => r.id === requestId) ||
    (col.children || []).map((c: any) => (c.requests || []).find((r: any) => r.id === requestId)).find(Boolean) ||
    null,
}));

const makeRequest = (id: string, name: string, extra: Record<string, any> = {}) => ({
  id,
  name,
  method: "GET",
  url: `http://test/${id}`,
  headers: [],
  queryParams: [],
  bodyType: "NONE",
  body: "",
  authType: "NONE",
  authConfig: {},
  inputs: [],
  outputs: [],
  ...extra,
});

const collections = [
  {
    id: "col",
    name: "Demo",
    requests: [
      makeRequest("r1", "Get UUID", { outputs: ["uuid"] }),
      makeRequest("r2", "Echo", { url: "http://test/echo?id={{myId}}", outputs: ["echoed"] }),
      makeRequest("r3", "Get Orders", { outputs: ["ids"] }),
    ],
    children: [
      {
        id: "sub",
        name: "Admin",
        requests: [makeRequest("r4", "Get Order", { url: "http://test/order/{{id}}", outputs: ["status"] })],
        children: [],
      },
    ],
  },
] as any;

const catalog = (): CatalogRow[] => buildCatalog(collections).rows;

const reqNode = (id: string, name: string, requestId: string, mappings: any[] = []): FlowNode => ({
  id,
  name,
  type: "request",
  position: { x: 10, y: 20 },
  config: { requestId, mappings } as RequestNodeConfig,
});

describe("buildCatalog", () => {
  it("flattens folders, derives inputs from tokens, and carries declared outputs", () => {
    const { rows, truncated } = buildCatalog(collections);
    expect(truncated).toBe(false);
    expect(rows.map((r) => r.name)).toEqual(["Get UUID", "Echo", "Get Orders", "Get Order"]);
    const echo = rows.find((r) => r.name === "Echo")!;
    expect(echo.inputs).toEqual(["myId"]);
    expect(echo.outputs).toEqual(["echoed"]);
    const order = rows.find((r) => r.name === "Get Order")!;
    expect(order.path).toBe("Demo / Admin");
    expect(order.inputs).toEqual(["id"]);
    expect(toWireCatalog(rows).every((r) => !("requestId" in r))).toBe(true);
  });

  it("caps huge catalogs and flags truncation", () => {
    const big = [
      {
        id: "big",
        name: "Big",
        requests: Array.from({ length: CATALOG_LIMIT + 5 }, (_, i) => makeRequest(`b${i}`, `Req ${i}`)),
        children: [],
      },
    ] as any;
    const { rows, truncated } = buildCatalog(big);
    expect(rows).toHaveLength(CATALOG_LIMIT);
    expect(truncated).toBe(true);
  });
});

describe("resolveRequestName", () => {
  it("matches exactly, case- and whitespace-insensitively", () => {
    const r = resolveRequestName(catalog(), "  get   uuid ");
    expect(r.ok && r.row.requestId).toBe("r1");
  });

  it("falls back to a unique substring match", () => {
    const r = resolveRequestName(catalog(), "uuid");
    expect(r.ok && r.row.requestId).toBe("r1");
  });

  it("reports ambiguity instead of guessing", () => {
    const r = resolveRequestName(catalog(), "get order");
    // Exact match on "Get Order" wins over the substring-similar "Get Orders".
    expect(r.ok && r.row.requestId).toBe("r4");
    const partial = resolveRequestName(catalog(), "orders");
    expect(partial.ok && (partial as any).row.requestId).toBe("r3");
  });

  it("rejects unknown names with a build-it-first message", () => {
    const r = resolveRequestName(catalog(), "Delete Account");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("build it in API Explorer first");
  });
});

describe("validateAndPlan", () => {
  it("builds a runnable flow from a happy-path proposal", () => {
    const actions: AssistantAction[] = [
      { type: "add_node", nodeType: "request", name: "getUuid", config: { requestName: "Get UUID", mappings: [] } },
      { type: "add_node", nodeType: "delay", name: "wait", config: { ms: 500 } },
      {
        type: "add_node",
        nodeType: "request",
        name: "echo",
        config: {
          requestName: "Echo",
          mappings: [{ inputName: "myId", source: "reference", value: "getUuid.uuid" }],
        },
      },
      { type: "connect", from: "getUuid", to: "wait" },
      { type: "connect", from: "wait", to: "echo" },
    ];
    const plan = validateAndPlan(actions, { nodes: [], edges: [] }, catalog());
    expect(plan.ok).toBe(true);
    const { nodes, edges } = plan.result!;
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
    expect((nodes[0].config as RequestNodeConfig).requestId).toBe("r1");
    expect((nodes[2].config as RequestNodeConfig).requestId).toBe("r2");
    expect("order" in topoSort(nodes, edges)).toBe(true);
    // Layout: columns by depth, deterministic.
    expect(nodes.map((n) => n.position.x)).toEqual([120, 380, 640]);
    const again = validateAndPlan(actions, { nodes: [], edges: [] }, catalog());
    expect(again.result!.nodes.map((n) => n.position)).toEqual(nodes.map((n) => n.position));
  });

  it("auto-suffixes duplicate node names and rewrites later references", () => {
    const existing = [reqNode("n1", "getUuid", "r1")];
    const actions: AssistantAction[] = [
      { type: "add_node", nodeType: "request", name: "getUuid", config: { requestName: "Get UUID", mappings: [] } },
      {
        type: "add_node",
        nodeType: "request",
        name: "echo",
        config: { requestName: "Echo", mappings: [{ inputName: "myId", source: "reference", value: "getUuid.uuid" }] },
      },
      { type: "connect", from: "getUuid", to: "echo" },
    ];
    const plan = validateAndPlan(actions, { nodes: existing, edges: [] }, catalog());
    expect(plan.ok).toBe(true);
    const { nodes, edges } = plan.result!;
    const added = nodes.find((n) => n.name === "getUuid_2")!;
    expect(added).toBeTruthy();
    expect(plan.steps[0].note).toContain("getUuid_2");
    const echo = nodes.find((n) => n.name === "echo")!;
    expect((echo.config as RequestNodeConfig).mappings[0].value).toBe("getUuid_2.uuid");
    expect(edges[0].source).toBe(added.id);
  });

  it("rejects unknown requests atomically", () => {
    const actions: AssistantAction[] = [
      { type: "add_node", nodeType: "request", name: "a", config: { requestName: "Get UUID", mappings: [] } },
      { type: "add_node", nodeType: "request", name: "b", config: { requestName: "Nope", mappings: [] } },
    ];
    const plan = validateAndPlan(actions, { nodes: [], edges: [] }, catalog());
    expect(plan.ok).toBe(false);
    expect(plan.result).toBeUndefined();
    expect(plan.steps[1].error).toContain("build it in API Explorer first");
    expect(plan.steps[0].error).toBeUndefined();
  });

  it("rejects cycle-creating and self connections; skips duplicates", () => {
    const a = reqNode("na", "a", "r1");
    const b = reqNode("nb", "b", "r1");
    const edges: FlowEdge[] = [{ id: "e1", source: "na", target: "nb" }];
    const cyclePlan = validateAndPlan(
      [{ type: "connect", from: "b", to: "a" }],
      { nodes: [a, b], edges },
      catalog()
    );
    expect(cyclePlan.ok).toBe(false);
    expect(cyclePlan.steps[0].error).toContain("cycle");

    const selfPlan = validateAndPlan([{ type: "connect", from: "a", to: "a" }], { nodes: [a, b], edges }, catalog());
    expect(selfPlan.ok).toBe(false);

    const dupPlan = validateAndPlan([{ type: "connect", from: "a", to: "b" }], { nodes: [a, b], edges }, catalog());
    expect(dupPlan.ok).toBe(true);
    expect(dupPlan.steps[0].note).toContain("already exists");
    expect(dupPlan.result!.edges).toHaveLength(1);
  });

  it('allows "item" references only inside loopers', () => {
    const bad: AssistantAction[] = [
      {
        type: "add_node",
        nodeType: "request",
        name: "solo",
        config: { requestName: "Echo", mappings: [{ inputName: "myId", source: "reference", value: "item.id" }] },
      },
    ];
    expect(validateAndPlan(bad, { nodes: [], edges: [] }, catalog()).ok).toBe(false);

    const good: AssistantAction[] = [
      { type: "add_node", nodeType: "request", name: "orders", config: { requestName: "Get Orders", mappings: [] } },
      {
        type: "add_node",
        nodeType: "looper",
        name: "loop",
        config: {
          itemsSource: "reference",
          itemsValue: "orders.ids",
          request: { requestName: "Get Order", mappings: [{ inputName: "id", source: "reference", value: "item" }] },
        },
      },
      { type: "connect", from: "orders", to: "loop" },
    ];
    const plan = validateAndPlan(good, { nodes: [], edges: [] }, catalog());
    expect(plan.ok).toBe(true);
    const loop = plan.result!.nodes.find((n) => n.name === "loop")!;
    expect((loop.config as LooperNodeConfig).request.requestId).toBe("r4");
  });

  it("rejects references to non-ancestor nodes", () => {
    const actions: AssistantAction[] = [
      { type: "add_node", nodeType: "request", name: "a", config: { requestName: "Get UUID", mappings: [] } },
      {
        type: "add_node",
        nodeType: "request",
        name: "b",
        config: { requestName: "Echo", mappings: [{ inputName: "myId", source: "reference", value: "a.uuid" }] },
      },
      // no connect a -> b: the reference has no edge ancestor
    ];
    const plan = validateAndPlan(actions, { nodes: [], edges: [] }, catalog());
    expect(plan.ok).toBe(false);
    expect(plan.steps[1].error).toContain("does not match any upstream node");
  });

  it("update_node merges per field and errors on unknown targets", () => {
    const delay: FlowNode = {
      id: "d1",
      name: "wait",
      type: "delay",
      position: { x: 0, y: 0 },
      config: { ms: 1000 } as DelayNodeConfig,
    };
    const plan = validateAndPlan(
      [{ type: "update_node", name: "wait", config: { ms: 250 } }],
      { nodes: [delay], edges: [] },
      catalog()
    );
    expect(plan.ok).toBe(true);
    expect((plan.result!.nodes[0].config as DelayNodeConfig).ms).toBe(250);

    const missing = validateAndPlan(
      [{ type: "update_node", name: "ghost", config: { ms: 1 } }],
      { nodes: [delay], edges: [] },
      catalog()
    );
    expect(missing.ok).toBe(false);
    expect(missing.steps[0].error).toContain("No node named");
  });

  it("create_flow resets the working canvas and must come first", () => {
    const existing = [reqNode("n1", "old", "r1")];
    const plan = validateAndPlan(
      [
        { type: "create_flow", name: "Fresh" },
        { type: "add_node", nodeType: "request", name: "getUuid", config: { requestName: "Get UUID", mappings: [] } },
      ],
      { nodes: existing, edges: [] },
      catalog()
    );
    expect(plan.ok).toBe(true);
    expect(plan.createFlowName).toBe("Fresh");
    expect(plan.result!.nodes.map((n) => n.name)).toEqual(["getUuid"]);

    const late = validateAndPlan(
      [
        { type: "add_node", nodeType: "delay", name: "wait", config: { ms: 1 } },
        { type: "create_flow", name: "Nope" },
      ],
      { nodes: [], edges: [] },
      catalog()
    );
    expect(late.ok).toBe(false);
  });

  it("does not mutate the input canvas", () => {
    const existing = [reqNode("n1", "getUuid", "r1")];
    const snapshot = JSON.stringify(existing);
    validateAndPlan(
      [{ type: "update_node", name: "getUuid", config: { newName: "renamed" } }],
      { nodes: existing, edges: [] },
      catalog()
    );
    expect(JSON.stringify(existing)).toBe(snapshot);
  });
});

describe("buildCanvasContext", () => {
  it("serializes nodes by name with request names, never ids", () => {
    const nodes = [
      reqNode("n1", "getUuid", "r1"),
      reqNode("n2", "echo", "r2", [{ inputName: "myId", source: "reference", value: "getUuid.uuid" }]),
    ];
    const edges: FlowEdge[] = [{ id: "e1", source: "n1", target: "n2" }];
    const ctx = buildCanvasContext("My flow", nodes, edges, collections);
    expect(ctx.flowName).toBe("My flow");
    expect(ctx.nodes[0].requestName).toBe("Get UUID");
    expect(ctx.edges).toEqual([["getUuid", "echo"]]);
    expect(JSON.stringify(ctx)).not.toContain("r1");
  });
});
