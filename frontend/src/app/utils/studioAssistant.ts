// Pure logic for the API Studio AI canvas assistant: request-catalog and
// canvas context assembly for the LLM, deterministic request-name resolution,
// validation + simulation of proposed actions into a ready-to-apply canvas,
// auto-layout for new nodes, and per-flow chat transcript persistence.
// No React here — everything is unit-testable.

import type { Collection, RequestItem } from "../context/AppContext";
import { scanInputNames } from "./requestTokens";
import { ancestorNodeIds, lookupRequest, topoSort } from "./flowRunner";
import {
  type FlowNode,
  type FlowEdge,
  type FlowNodeType,
  type FlowInputMapping,
  type RequestNodeConfig,
  type LooperNodeConfig,
  type DelayNodeConfig,
  type VerifierNodeConfig,
  type VerifierComparison,
  NODE_NAME_RE,
  RESERVED_NODE_NAMES,
  autoNodeName,
} from "./flowTypes";

// ---- rename propagation (shared with the page's copy/paste logic) -----------

// Unique name for a duplicate: keep the original shape, bump a _n suffix.
export const uniqueCopyName = (name: string, taken: Set<string>): string => {
  if (!taken.has(name)) return name;
  const base = name.replace(/_\d+$/, "") || name;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
};

// Rename the head of a "node.path" reference when it points at a renamed node.
export const renameRef = (ref: string, renames: Map<string, string>): string => {
  const segments = ref.split(".");
  const renamed = renames.get(segments[0]?.trim());
  return renamed ? [renamed, ...segments.slice(1)].join(".") : ref;
};

// Rename {{node.path}} tokens inside static values ({{env.X}} / {{$...}} heads
// never appear in the rename map, so they pass through untouched).
export const renameStaticTokens = (text: string, renames: Map<string, string>): string =>
  text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key: string) => {
    const segments = key.split(".");
    const renamed = renames.get(segments[0]?.trim());
    return renamed ? `{{${[renamed, ...segments.slice(1)].join(".")}}}` : match;
  });

const renameRequestConfig = (cfg: RequestNodeConfig, renames: Map<string, string>): RequestNodeConfig => ({
  ...cfg,
  mappings: (cfg.mappings || []).map((m) =>
    m.source === "reference"
      ? { ...m, value: renameRef(m.value, renames) }
      : { ...m, value: renameStaticTokens(m.value, renames) }
  ),
});

// Rewrite references inside a node's config after upstream nodes were renamed;
// references to nodes outside the rename map stay as they are.
export const renameNodeConfig = (node: FlowNode, renames: Map<string, string>): FlowNode["config"] => {
  switch (node.type) {
    case "request":
      return renameRequestConfig(node.config as RequestNodeConfig, renames);
    case "looper": {
      const cfg = node.config as LooperNodeConfig;
      return {
        ...cfg,
        itemsValue: cfg.itemsSource === "reference" ? renameRef(cfg.itemsValue, renames) : cfg.itemsValue,
        request: renameRequestConfig(cfg.request, renames),
      };
    }
    case "verifier": {
      const cfg = node.config as VerifierNodeConfig;
      return {
        ...cfg,
        request: renameRequestConfig(cfg.request, renames),
        comparisons: (cfg.comparisons || []).map((c) =>
          c.expectedSource === "reference" ? { ...c, expected: renameRef(c.expected, renames) } : c
        ),
      };
    }
    case "delay":
      return node.config;
  }
};

// ---- assistant wire types ----------------------------------------------------

export interface CreateFlowAction {
  type: "create_flow";
  name: string;
}
export interface AddNodeAction {
  type: "add_node";
  nodeType: FlowNodeType;
  name: string;
  config: Record<string, any>; // wire config: requestName instead of requestId
}
export interface UpdateNodeAction {
  type: "update_node";
  name: string;
  config: Record<string, any>; // partial; may include newName
}
export interface ConnectAction {
  type: "connect";
  from: string;
  to: string;
}
export type AssistantAction = CreateFlowAction | AddNodeAction | UpdateNodeAction | ConnectAction;

export interface Proposal {
  message: string;
  actions: AssistantAction[];
  parseError?: boolean;
}

// ---- context assembly --------------------------------------------------------

export const CATALOG_LIMIT = 250;

export interface CatalogRow {
  requestId: string; // client-side only — never sent to the model
  name: string;
  method: string;
  path: string;
  inputs: string[];
  outputs: string[];
  description: string;
}

const snip = (text: string | undefined, max: number): string => {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
};

const requestInputsOf = (req: RequestItem): string[] => {
  // Live token scan ∪ stored bindings — same rule as the studio inspector.
  const names = scanInputNames({
    url: req.url,
    headers: req.headers || [],
    queryParams: req.queryParams || [],
    body: req.body || "",
    authType: req.authType,
    authConfig: req.authConfig || {},
  });
  for (const b of req.inputs || []) if (!names.includes(b.name)) names.push(b.name);
  return names;
};

export function buildCatalog(collections: Collection[]): { rows: CatalogRow[]; truncated: boolean } {
  const rows: CatalogRow[] = [];
  let truncated = false;
  const walk = (node: Collection, trail: string[]) => {
    for (const req of node.requests || []) {
      if (rows.length >= CATALOG_LIMIT) {
        truncated = true;
        return;
      }
      rows.push({
        requestId: req.id,
        name: req.name,
        method: req.method,
        path: trail.join(" / "),
        inputs: requestInputsOf(req),
        outputs: req.outputs || [],
        description: snip(req.description, 80),
      });
    }
    for (const child of node.children || []) walk(child, [...trail, child.name]);
  };
  for (const col of collections) walk(col, [col.name]);
  return { rows, truncated };
}

// The model sees names, never ids — resolution back to ids is a deterministic
// client responsibility (which is also what enforces reject-unknown).
export const toWireCatalog = (rows: CatalogRow[]): Omit<CatalogRow, "requestId">[] =>
  rows.map(({ requestId: _requestId, ...rest }) => rest);

export function buildCanvasContext(
  flowName: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
  collections: Collection[]
): Record<string, any> {
  const nameById = new Map(nodes.map((n) => [n.id, n.name]));
  const requestNameOf = (requestId: string): string =>
    requestId ? lookupRequest(collections, requestId)?.name || "(unknown request)" : "";
  const wireRequestCfg = (cfg: RequestNodeConfig) => ({
    requestName: requestNameOf(cfg.requestId),
    mappings: cfg.mappings || [],
  });
  const wireNode = (n: FlowNode): Record<string, any> => {
    switch (n.type) {
      case "request":
        return { name: n.name, type: n.type, ...wireRequestCfg(n.config as RequestNodeConfig) };
      case "delay":
        return { name: n.name, type: n.type, ms: (n.config as DelayNodeConfig).ms };
      case "looper": {
        const cfg = n.config as LooperNodeConfig;
        return {
          name: n.name,
          type: n.type,
          itemsSource: cfg.itemsSource,
          itemsValue: cfg.itemsValue,
          request: wireRequestCfg(cfg.request),
        };
      }
      case "verifier": {
        const cfg = n.config as VerifierNodeConfig;
        return {
          name: n.name,
          type: n.type,
          request: wireRequestCfg(cfg.request),
          comparisons: cfg.comparisons || [],
          maxAttempts: cfg.maxAttempts,
          intervalMs: cfg.intervalMs,
        };
      }
    }
  };
  return {
    flowName,
    nodes: nodes.map(wireNode),
    edges: edges
      .map((e) => [nameById.get(e.source), nameById.get(e.target)])
      .filter((pair): pair is [string, string] => !!pair[0] && !!pair[1]),
  };
}

// ---- request-name resolution -------------------------------------------------

const normName = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

export function resolveRequestName(
  catalog: CatalogRow[],
  name: string
): { ok: true; row: CatalogRow } | { ok: false; error: string } {
  const target = normName(name || "");
  if (!target) return { ok: false, error: "Empty request name" };
  const exact = catalog.filter((r) => normName(r.name) === target);
  if (exact.length === 1) return { ok: true, row: exact[0] };
  if (exact.length > 1) {
    return {
      ok: false,
      error: `Request name "${name}" is ambiguous — candidates: ${exact.map((r) => `${r.path} / ${r.name}`).join("; ")}`,
    };
  }
  const partial = catalog.filter((r) => {
    const rn = normName(r.name);
    return rn.includes(target) || target.includes(rn);
  });
  if (partial.length === 1) return { ok: true, row: partial[0] };
  if (partial.length > 1) {
    return {
      ok: false,
      error: `Request name "${name}" is ambiguous — matches: ${partial.map((r) => r.name).join(", ")}`,
    };
  }
  return { ok: false, error: `No request named "${name}" in your collections — build it in API Explorer first.` };
}

// ---- validation + planning ---------------------------------------------------

export interface PlannedStep {
  action: AssistantAction;
  summary: string;
  note?: string;
  error?: string;
}

export interface ValidatedPlan {
  ok: boolean; // false if any step (or global check) has an error — apply nothing
  steps: PlannedStep[];
  globalErrors: string[];
  createFlowName?: string;
  result?: { nodes: FlowNode[]; edges: FlowEdge[] }; // full post-apply canvas
}

const asInt = (value: any, fallback: number, min: number): number => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= min ? n : fallback;
};

const normalizeMappings = (raw: any): FlowInputMapping[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((m) => m && typeof m.inputName === "string" && m.inputName)
    .map((m) => ({
      inputName: m.inputName,
      source: m.source === "reference" ? "reference" : "static",
      value: typeof m.value === "string" ? m.value : String(m.value ?? ""),
    }));

const normalizeComparisons = (raw: any): VerifierComparison[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((c) => c && typeof c.field === "string" && c.field)
    .map((c) => ({
      field: c.field,
      operator: c.operator,
      expectedSource: c.expectedSource === "reference" ? "reference" : "static",
      expected: typeof c.expected === "string" ? c.expected : String(c.expected ?? ""),
    }));

// Simulate the proposed actions against a working copy of the canvas. Never
// mutates the inputs. Any error anywhere makes the plan unappliable (atomic).
export function validateAndPlan(
  actions: AssistantAction[],
  current: { nodes: FlowNode[]; edges: FlowEdge[] },
  catalog: CatalogRow[]
): ValidatedPlan {
  const steps: PlannedStep[] = [];
  const globalErrors: string[] = [];
  let createFlowName: string | undefined;
  let nodes: FlowNode[] = current.nodes.map((n) => ({ ...n }));
  let edges: FlowEdge[] = current.edges.map((e) => ({ ...e }));
  const newIds = new Set<string>();
  // Requested-name → actual-name remaps (auto-suffixed duplicates, newName
  // renames) applied to every later action and reference.
  const renames = new Map<string, string>();

  const actualName = (name: string): string => renames.get(name) || name;
  const nodeByName = (name: string): FlowNode | undefined => nodes.find((n) => n.name === name);

  // Resolve a wire request config ({requestName, mappings}) to the internal
  // shape; returns a per-step error string on unknown/ambiguous names.
  const resolveRequestCfg = (
    wire: any
  ): { cfg?: RequestNodeConfig; row?: CatalogRow; error?: string; notes: string[] } => {
    const notes: string[] = [];
    const resolved = resolveRequestName(catalog, wire?.requestName || "");
    if (!resolved.ok) return { error: resolved.error, notes };
    const mappings = normalizeMappings(wire?.mappings);
    for (const m of mappings) {
      if (resolved.row.inputs.length && !resolved.row.inputs.includes(m.inputName)) {
        notes.push(`input "${m.inputName}" is not declared by "${resolved.row.name}"`);
      }
    }
    return { cfg: { requestId: resolved.row.requestId, mappings }, row: resolved.row, notes };
  };

  const claimNodeName = (requested: string): { name: string; note?: string } => {
    let name = (requested || "").trim();
    const taken = new Set(nodes.map((n) => n.name));
    if (!NODE_NAME_RE.test(name) || RESERVED_NODE_NAMES.has(name)) {
      name = autoNodeName(name || "node", nodes);
    } else if (taken.has(name)) {
      name = uniqueCopyName(name, taken);
    }
    if (name !== requested) {
      renames.set(requested, name);
      return { name, note: `renamed to "${name}" (requested name was invalid or taken)` };
    }
    return { name };
  };

  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];

    if (action.type === "create_flow") {
      const summary = `Create new flow "${action.name}"`;
      if (index !== 0) {
        steps.push({ action, summary, error: "create_flow is only allowed as the first action" });
        continue;
      }
      createFlowName = action.name.trim() || "New flow";
      nodes = [];
      edges = [];
      renames.clear();
      newIds.clear();
      steps.push({ action, summary });
      continue;
    }

    if (action.type === "add_node") {
      const notes: string[] = [];
      let error: string | undefined;
      let summary = `Add ${action.nodeType} node "${action.name}"`;
      const claimed = claimNodeName(action.name);
      if (claimed.note) notes.push(claimed.note);

      let config: FlowNode["config"] | null = null;
      const wire = action.config || {};
      if (action.nodeType === "delay") {
        config = { ms: asInt(wire.ms, 1000, 0) } as DelayNodeConfig;
        summary += ` (${(config as DelayNodeConfig).ms} ms)`;
      } else if (action.nodeType === "request") {
        const r = resolveRequestCfg(wire);
        notes.push(...r.notes);
        if (r.error) error = r.error;
        else {
          config = r.cfg!;
          summary += ` → ${r.row!.method} ${r.row!.name}`;
        }
      } else if (action.nodeType === "looper") {
        const r = resolveRequestCfg(wire.request);
        notes.push(...r.notes);
        if (r.error) error = r.error;
        else {
          config = {
            itemsSource: wire.itemsSource === "reference" ? "reference" : "static",
            itemsValue: typeof wire.itemsValue === "string" ? wire.itemsValue : "[]",
            request: r.cfg!,
          } as LooperNodeConfig;
          summary += ` → ${r.row!.method} ${r.row!.name} per item`;
        }
      } else if (action.nodeType === "verifier") {
        const r = resolveRequestCfg(wire.request);
        notes.push(...r.notes);
        if (r.error) error = r.error;
        else {
          const comparisons = normalizeComparisons(wire.comparisons);
          if (!comparisons.length) notes.push("no comparisons configured — the verifier will never pass");
          config = {
            request: r.cfg!,
            comparisons,
            maxAttempts: asInt(wire.maxAttempts, 3, 1),
            intervalMs: asInt(wire.intervalMs, 1000, 0),
          } as VerifierNodeConfig;
          summary += ` → ${r.row!.method} ${r.row!.name}`;
        }
      } else {
        error = `Unknown node type "${(action as any).nodeType}"`;
      }

      if (!error && config) {
        const node: FlowNode = {
          id: crypto.randomUUID(),
          name: claimed.name,
          type: action.nodeType,
          position: { x: 0, y: 0 }, // placeholder — layoutNewNodes assigns real positions
          config,
        };
        node.config = renameNodeConfig(node, renames);
        nodes.push(node);
        newIds.add(node.id);
      }
      steps.push({ action, summary, note: notes.join("; ") || undefined, error });
      continue;
    }

    if (action.type === "update_node") {
      const targetName = actualName(action.name);
      const summary = `Update node "${targetName}"`;
      const target = nodeByName(targetName);
      if (!target) {
        steps.push({ action, summary, error: `No node named "${action.name}" on the canvas` });
        continue;
      }
      const notes: string[] = [];
      let error: string | undefined;
      const wire = action.config || {};
      let config: FlowNode["config"] = { ...target.config };

      if (typeof wire.newName === "string" && wire.newName.trim() && wire.newName !== target.name) {
        const taken = new Set(nodes.filter((n) => n.id !== target.id).map((n) => n.name));
        let newName = wire.newName.trim();
        if (!NODE_NAME_RE.test(newName) || RESERVED_NODE_NAMES.has(newName)) {
          error = `New name "${newName}" is not a valid identifier`;
        } else {
          if (taken.has(newName)) {
            newName = uniqueCopyName(newName, taken);
            notes.push(`renamed to "${newName}" (requested name was taken)`);
          }
          const renameMap = new Map([[target.name, newName]]);
          renames.set(action.name, newName);
          // Rewrite references in every other node that pointed at the old name.
          nodes = nodes.map((n) =>
            n.id === target.id ? n : { ...n, config: renameNodeConfig(n, renameMap) }
          );
          target.name = newName;
        }
      }

      if (!error) {
        if (target.type === "request") {
          const cfg = config as RequestNodeConfig;
          if (wire.requestName !== undefined) {
            const r = resolveRequestCfg({ requestName: wire.requestName, mappings: wire.mappings ?? cfg.mappings });
            notes.push(...r.notes);
            if (r.error) error = r.error;
            else config = r.cfg!;
          } else if (wire.mappings !== undefined) {
            config = { ...cfg, mappings: normalizeMappings(wire.mappings) };
          }
        } else if (target.type === "delay") {
          if (wire.ms !== undefined) config = { ms: asInt(wire.ms, (config as DelayNodeConfig).ms, 0) };
        } else if (target.type === "looper") {
          const cfg = config as LooperNodeConfig;
          const next: LooperNodeConfig = { ...cfg };
          if (wire.itemsSource !== undefined) next.itemsSource = wire.itemsSource === "reference" ? "reference" : "static";
          if (wire.itemsValue !== undefined) next.itemsValue = String(wire.itemsValue);
          if (wire.request !== undefined) {
            const r = resolveRequestCfg(wire.request);
            notes.push(...r.notes);
            if (r.error) error = r.error;
            else next.request = r.cfg!;
          }
          config = next;
        } else if (target.type === "verifier") {
          const cfg = config as VerifierNodeConfig;
          const next: VerifierNodeConfig = { ...cfg };
          if (wire.request !== undefined) {
            const r = resolveRequestCfg(wire.request);
            notes.push(...r.notes);
            if (r.error) error = r.error;
            else next.request = r.cfg!;
          }
          if (wire.comparisons !== undefined) next.comparisons = normalizeComparisons(wire.comparisons);
          if (wire.maxAttempts !== undefined) next.maxAttempts = asInt(wire.maxAttempts, cfg.maxAttempts, 1);
          if (wire.intervalMs !== undefined) next.intervalMs = asInt(wire.intervalMs, cfg.intervalMs, 0);
          config = next;
        }
      }

      if (!error) {
        target.config = renameNodeConfig({ ...target, config }, renames);
      }
      steps.push({ action, summary, note: notes.join("; ") || undefined, error });
      continue;
    }

    if (action.type === "connect") {
      const fromName = actualName(action.from);
      const toName = actualName(action.to);
      const summary = `Connect ${fromName} → ${toName}`;
      const from = nodeByName(fromName);
      const to = nodeByName(toName);
      let error: string | undefined;
      let note: string | undefined;
      if (!from || !to) {
        error = `No node named "${!from ? action.from : action.to}" on the canvas`;
      } else if (from.id === to.id) {
        error = "Cannot connect a node to itself";
      } else if (edges.some((e) => e.source === from.id && e.target === to.id)) {
        note = "connection already exists — skipped";
      } else if (ancestorNodeIds(from.id, edges).has(to.id)) {
        error = `Connecting ${fromName} → ${toName} would create a cycle`;
      } else {
        edges.push({ id: crypto.randomUUID(), source: from.id, target: to.id });
      }
      steps.push({ action, summary, note, error });
      continue;
    }

    steps.push({
      action,
      summary: `Unknown action "${(action as any).type}"`,
      error: `Unknown action type "${(action as any).type}"`,
    });
  }

  // Final pass — reference integrity over the planned canvas (mirrors the
  // page's validationError memo): every reference head must name an edge
  // ancestor; "item" only inside a looper's inner mappings.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const attachError = (node: FlowNode, message: string) => {
    const step = [...steps]
      .reverse()
      .find(
        (s) =>
          !s.error &&
          ((s.action.type === "add_node" && nodeById.get(node.id) === node && actualName(s.action.name) === node.name) ||
            (s.action.type === "update_node" && actualName(s.action.name) === node.name))
      );
    if (step) step.error = step.error || message;
    else globalErrors.push(message);
  };
  for (const n of nodes) {
    const upstreamNames = new Set(
      Array.from(ancestorNodeIds(n.id, edges))
        .map((id) => nodeById.get(id)?.name)
        .filter(Boolean)
    );
    const checkRef = (ref: string, allowItem: boolean, what: string) => {
      const head = ref.split(".")[0]?.trim();
      if (!head) attachError(n, `Node "${n.name}": empty reference for ${what}`);
      else if (head === "item") {
        if (!allowItem) attachError(n, `Node "${n.name}": "item" is only available inside a looper`);
      } else if (!upstreamNames.has(head)) {
        attachError(n, `Node "${n.name}": reference "${ref}" does not match any upstream node`);
      }
    };
    const cfg =
      n.type === "request"
        ? (n.config as RequestNodeConfig)
        : n.type === "looper"
          ? (n.config as LooperNodeConfig).request
          : n.type === "verifier"
            ? (n.config as VerifierNodeConfig).request
            : null;
    if (cfg) {
      const allowItem = n.type === "looper";
      for (const m of cfg.mappings || []) {
        if (m.source === "reference") checkRef(m.value, allowItem, `input "${m.inputName}"`);
      }
    }
    if (n.type === "looper") {
      const lc = n.config as LooperNodeConfig;
      if (lc.itemsSource === "reference") checkRef(lc.itemsValue, false, "looper items");
    }
    if (n.type === "verifier") {
      const vc = n.config as VerifierNodeConfig;
      for (const c of vc.comparisons || []) {
        if (c.expectedSource === "reference") checkRef(c.expected, false, `comparison on "${c.field}"`);
      }
    }
  }

  const ok = steps.every((s) => !s.error) && globalErrors.length === 0;
  if (!ok) return { ok, steps, globalErrors, createFlowName };
  return {
    ok,
    steps,
    globalErrors,
    createFlowName,
    result: { nodes: layoutNewNodes(newIds, nodes, edges), edges },
  };
}

// ---- auto-layout -------------------------------------------------------------

// Deterministic positions for new nodes: column = topological depth (longest
// path from roots), row = insertion order within the column, placed below any
// existing nodes so AI additions never overlap the user's layout.
export function layoutNewNodes(newIds: Set<string>, nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  if (!newIds.size) return nodes;
  const sorted = topoSort(nodes, edges);
  const order = "order" in sorted ? sorted.order : nodes.map((n) => n.id);
  const parents = new Map<string, string[]>();
  for (const e of edges) {
    if (!parents.has(e.target)) parents.set(e.target, []);
    parents.get(e.target)!.push(e.source);
  }
  const depth = new Map<string, number>();
  for (const id of order) {
    const ps = parents.get(id) || [];
    depth.set(id, ps.length ? Math.max(...ps.map((p) => depth.get(p) ?? 0)) + 1 : 0);
  }
  const existing = nodes.filter((n) => !newIds.has(n.id));
  const baseY = existing.length ? Math.max(...existing.map((n) => n.position.y)) + 160 : 120;
  const rowsByColumn = new Map<number, number>();
  return nodes.map((n) => {
    if (!newIds.has(n.id)) return n;
    const column = depth.get(n.id) ?? 0;
    const row = rowsByColumn.get(column) ?? 0;
    rowsByColumn.set(column, row + 1);
    return { ...n, position: { x: 120 + column * 260, y: baseY + row * 120 } };
  });
}

// ---- transcript persistence (localStorage, flowReport.ts pattern) ------------

const CHAT_PREFIX = "studioChat:";
// Transcript key while chatting with no flow selected (a create_flow proposal
// migrates it onto the created flow's id).
export const NEW_FLOW_CHAT_KEY = "__new__";
const MAX_CHAT_ENTRIES = 40;

export interface ChatEntry {
  role: "user" | "assistant";
  // What gets sent back to the backend as transcript. For assistant turns this
  // is the raw {message, actions} JSON string, so the model sees its own
  // prior proposals verbatim.
  content: string;
  proposal?: Proposal;
  proposalState?: "pending" | "applied" | "dismissed";
  synthetic?: boolean; // system-style lines like "[Applied N actions]"
}

export function loadChat(flowKey: string): ChatEntry[] {
  try {
    const raw = localStorage.getItem(CHAT_PREFIX + flowKey);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistChat(flowKey: string, entries: ChatEntry[]): void {
  try {
    localStorage.setItem(CHAT_PREFIX + flowKey, JSON.stringify(entries.slice(-MAX_CHAT_ENTRIES)));
  } catch {
    // storage full/unavailable — the transcript stays in memory only
  }
}

export function clearChat(flowKey: string): void {
  try {
    localStorage.removeItem(CHAT_PREFIX + flowKey);
  } catch {
    // ignore
  }
}

export function migrateChat(fromKey: string, toFlowId: string): void {
  try {
    const raw = localStorage.getItem(CHAT_PREFIX + fromKey);
    if (raw) {
      localStorage.setItem(CHAT_PREFIX + toFlowId, raw);
      localStorage.removeItem(CHAT_PREFIX + fromKey);
    }
  } catch {
    // ignore
  }
}
