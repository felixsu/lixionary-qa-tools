// API Studio flow data model. Flows are stored as a synced "flow" entity
// (local-store SQLite + cloud Mongo); nodes/edges are an opaque blob to the
// server — this module is the schema owner.

export type FlowNodeType = "request" | "looper" | "delay" | "verifier";

export interface FlowInputMapping {
  inputName: string; // a {{name}} token declared by the linked request
  // reference: value is "nodeName.outputName" (deeper dot-paths allowed);
  // static: free text, may contain {{nodeName.path}} tokens (resolved
  // client-side) plus {{env.X}}/{{$...}} tokens (left for the backend).
  source: "static" | "reference";
  value: string;
}

export interface RequestNodeConfig {
  requestId: string;
  mappings: FlowInputMapping[];
}

export interface LooperNodeConfig {
  itemsSource: "reference" | "static";
  itemsValue: string; // reference "node.output" | static JSON array text
  request: RequestNodeConfig; // inner mappings may reference "item" / "item.field"
}

export type ComparisonOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "exists"
  | "greater_than"
  | "less_than";

export interface VerifierComparison {
  field: string; // "status" | "body.<path>" | "outputs.<path>" | bare path (= outputs)
  operator: ComparisonOperator;
  expectedSource: "static" | "reference";
  expected: string; // ignored for "exists"
}

export interface VerifierNodeConfig {
  request: RequestNodeConfig;
  comparisons: VerifierComparison[];
  maxAttempts: number; // >= 1
  intervalMs: number; // wait between attempts
}

export interface DelayNodeConfig {
  ms: number;
}

export type FlowNodeConfig =
  | RequestNodeConfig
  | LooperNodeConfig
  | DelayNodeConfig
  | VerifierNodeConfig;

export interface FlowNode {
  id: string;
  // Identifier-safe: becomes the JSON key namespacing this node's outputs
  // for downstream references ("nodeName.outputName").
  name: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  config: FlowNodeConfig;
}

export interface FlowEdge {
  id: string;
  source: string; // FlowNode.id
  target: string; // FlowNode.id
}

export interface Flow {
  id: string; // local-store localId — stable offline, before any cloud sync
  cloudId?: string | null; // Mongo _id once synced
  name: string;
  description?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const NODE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
// "env" collides with the {{env.X}} grammar; "item" is the looper iteration alias.
export const RESERVED_NODE_NAMES = new Set(["env", "item"]);

// Returns an error message, or null when the name is valid for this node.
export const validateNodeName = (name: string, nodes: FlowNode[], selfId: string): string | null => {
  if (!name) return "Name is required";
  if (!NODE_NAME_RE.test(name)) return "Must be a valid identifier (letters, digits, _; not starting with a digit)";
  if (RESERVED_NODE_NAMES.has(name)) return `"${name}" is a reserved name`;
  if (nodes.some((n) => n.id !== selfId && n.name === name)) return "Name already used in this flow";
  return null;
};

// Derive an identifier-safe unique node name from a human label.
export const autoNodeName = (label: string, nodes: FlowNode[]): string => {
  const words = label.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let base = words
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
  if (!base || /^[0-9]/.test(base)) base = `node${base}`;
  if (RESERVED_NODE_NAMES.has(base)) base = `${base}Node`;
  if (!nodes.some((n) => n.name === base)) return base;
  let i = 2;
  while (nodes.some((n) => n.name === `${base}_${i}`)) i++;
  return `${base}_${i}`;
};

export const defaultConfigForType = (type: FlowNodeType): FlowNodeConfig => {
  switch (type) {
    case "request":
      return { requestId: "", mappings: [] };
    case "looper":
      return { itemsSource: "static", itemsValue: "[]", request: { requestId: "", mappings: [] } };
    case "delay":
      return { ms: 1000 };
    case "verifier":
      return {
        request: { requestId: "", mappings: [] },
        comparisons: [],
        maxAttempts: 3,
        intervalMs: 1000,
      };
  }
};
