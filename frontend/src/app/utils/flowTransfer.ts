// Export/import of API Studio V2 flows — sibling of collectionTransfer.ts.
//
// A flow references saved requests by requestId, and the importing workspace
// may not have them. The export therefore carries an *interface snapshot* per
// referenced request (name, method, URL, port names — never headers, body, or
// scripts, so no secret can travel in a shared file). On import each request
// node is resolved in order: exact requestId → unique name+method match
// (rewriting the node's requestId) → unresolved, in which case the snapshot is
// injected into the node's config as `expected` so the editor can render the
// full interface and tell the user exactly what to recreate.
//
// Files are YAML by default (friendlier to read and diff) with JSON as an
// option; import auto-detects. The envelope is this module's own format — the
// top-level `requests` section never touches the stored flow document, whose
// top-level fields are enumerated by the cloud API.

import YAML from "yaml";
import type { Collection, RequestItem } from "../context/AppContext";
import { lookupRequest } from "./flowRunner";
import {
  isFlowV2,
  migrateFlowV2,
  type FlowEdgeV2,
  type FlowNodeV2,
  type FlowV2,
  type RequestNodeConfigV2,
  type RequestSnapshotV2,
} from "./flowTypesV2";
import { scanInputNames } from "./requestTokens";
import { generateDuplicateName } from "./uniqueName";

export const FLOW_EXPORT_FORMAT = "lixionary-flow-export";
export const FLOW_EXPORT_VERSION = 1;

export type FlowExportFileFormat = "yaml" | "json";

interface FlowExportEnvelope {
  format: typeof FLOW_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  flow: {
    name: string;
    description: string;
    schemaVersion: 2;
    nodes: FlowNodeV2[];
    edges: FlowEdgeV2[];
  };
  requests: Record<string, RequestSnapshotV2>;
}

export interface FlowImportSummary {
  matched: number; // nodes whose requestId resolved as-is
  autoLinked: { nodeName: string; requestName: string; method: string }[];
  missing: { nodeName: string; snapshot: RequestSnapshotV2 | null }[];
}

export interface PreparedFlowImport {
  name: string;
  description: string;
  nodes: FlowNodeV2[];
  edges: FlowEdgeV2[];
  summary: FlowImportSummary;
}

// ---- export ------------------------------------------------------------------

/** The same input-name derivation the port list uses: scanned {{tokens}} plus
 * declared binding names. Keeps the snapshot's dots identical to the live ones. */
const snapshotOf = (req: RequestItem): RequestSnapshotV2 => {
  const names = scanInputNames({
    url: req.url,
    headers: req.headers || [],
    queryParams: req.queryParams || [],
    body: req.body || "",
    authType: req.authType,
    authConfig: req.authConfig || {},
  });
  for (const b of req.inputs || []) if (!names.includes(b.name)) names.push(b.name);
  return {
    name: req.name,
    method: req.method,
    url: req.url,
    inputs: names,
    outputs: (req.outputs || []).filter(Boolean),
  };
};

export function serializeFlowForExport(
  flow: FlowV2,
  collections: Collection[],
  format: FlowExportFileFormat
): string {
  const requests: Record<string, RequestSnapshotV2> = {};
  const nodes = flow.nodes.map((n) => {
    if (n.type !== "request") return n;
    const cfg = n.config as RequestNodeConfigV2;
    if (!cfg.requestId) return n;
    const req = lookupRequest(collections, cfg.requestId);
    if (req) {
      requests[cfg.requestId] = snapshotOf(req);
      // A resolvable request makes any imported-era snapshot stale — drop it.
      if (cfg.expected) {
        const { expected, ...rest } = cfg;
        return { ...n, config: rest };
      }
      return n;
    }
    // Already missing here: the node's own snapshot (if any) is the best
    // description we have, so it travels both in place and in the index.
    if (cfg.expected) requests[cfg.requestId] = cfg.expected;
    return n;
  });

  const envelope: FlowExportEnvelope = {
    format: FLOW_EXPORT_FORMAT,
    version: FLOW_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    flow: {
      name: flow.name,
      description: flow.description || "",
      schemaVersion: 2,
      nodes,
      edges: flow.edges,
    },
    requests,
  };
  return format === "json" ? JSON.stringify(envelope, null, 2) : YAML.stringify(envelope);
}

export function flowExportFilename(name: string, format: FlowExportFileFormat): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "flow";
  return `${slug}.flow.${format === "json" ? "json" : "yaml"}`;
}

/** Blob-anchor download (same pattern as downloadJson / downloadCsv); works in
 * the Tauri webview as well as the browser. */
export function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---- import ------------------------------------------------------------------

export function parseFlowImport(text: string): FlowExportEnvelope {
  let raw: unknown;
  try {
    // JSON first for its sharper error messages; YAML.parse accepts JSON too,
    // so this only decides which parser reports a genuinely broken file.
    raw = text.trimStart().startsWith("{") ? JSON.parse(text) : YAML.parse(text);
  } catch (e) {
    throw new Error(`Not a readable YAML or JSON file (${e instanceof Error ? e.message : String(e)}).`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid file: expected a flow export document.");
  }
  const doc = raw as Partial<FlowExportEnvelope>;
  if (doc.format !== FLOW_EXPORT_FORMAT) {
    throw new Error("This file is not an API Studio flow export.");
  }
  if (doc.version !== FLOW_EXPORT_VERSION) {
    throw new Error(`Unsupported flow export version ${String(doc.version)} — this app reads version ${FLOW_EXPORT_VERSION}.`);
  }
  const flow = doc.flow;
  if (!flow || typeof flow !== "object" || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) {
    throw new Error("Invalid flow export: missing the flow's nodes and edges.");
  }
  if (!isFlowV2({ schemaVersion: flow.schemaVersion })) {
    throw new Error("Only V2 flows can be imported — this file holds a legacy flow.");
  }
  if (typeof flow.name !== "string" || !flow.name.trim()) {
    throw new Error("Invalid flow export: the flow has no name.");
  }
  return {
    format: FLOW_EXPORT_FORMAT,
    version: FLOW_EXPORT_VERSION,
    exportedAt: typeof doc.exportedAt === "string" ? doc.exportedAt : "",
    flow: {
      name: flow.name,
      description: typeof flow.description === "string" ? flow.description : "",
      schemaVersion: 2,
      nodes: flow.nodes,
      edges: flow.edges,
    },
    requests: doc.requests && typeof doc.requests === "object" ? doc.requests : {},
  };
}

const walkRequests = (collections: Collection[]): RequestItem[] => {
  const out: RequestItem[] = [];
  const visit = (col: Collection) => {
    out.push(...(col.requests || []));
    for (const child of col.children || []) visit(child);
  };
  for (const col of collections) visit(col);
  return out;
};

/** Resolves every request node of a parsed export against this workspace and
 * uniquifies the flow name. Matching order per node: exact requestId → a
 * UNIQUE name+method match anywhere in the collections (the id is rewritten) →
 * unresolved, with the snapshot injected as `config.expected` so the editor
 * shows what to recreate. Two same-name+method candidates are treated as
 * unresolved rather than guessed between. */
export function prepareImportedFlow(
  parsed: FlowExportEnvelope,
  existingFlowNames: Iterable<string>,
  collections: Collection[]
): PreparedFlowImport {
  // Hand-edited or old files may carry retired node type names.
  const migrated = migrateFlowV2(parsed.flow.nodes, parsed.flow.edges);

  const all = walkRequests(collections);
  const byNameMethod = new Map<string, RequestItem[]>();
  for (const req of all) {
    const key = `${req.method} ${req.name.trim()}`;
    byNameMethod.set(key, [...(byNameMethod.get(key) || []), req]);
  }

  const summary: FlowImportSummary = { matched: 0, autoLinked: [], missing: [] };
  const nodes = migrated.nodes.map((n) => {
    if (n.type !== "request") return n;
    const cfg = n.config as RequestNodeConfigV2;
    if (!cfg.requestId) return n;

    if (lookupRequest(collections, cfg.requestId)) {
      summary.matched += 1;
      if (!cfg.expected) return n;
      const { expected, ...rest } = cfg;
      return { ...n, config: rest };
    }

    const snapshot = parsed.requests[cfg.requestId] || cfg.expected || null;
    const candidates = snapshot
      ? byNameMethod.get(`${snapshot.method} ${snapshot.name.trim()}`) || []
      : [];
    if (candidates.length === 1) {
      summary.autoLinked.push({ nodeName: n.name, requestName: snapshot!.name, method: snapshot!.method });
      const { expected, ...rest } = cfg;
      return { ...n, config: { ...rest, requestId: candidates[0].id } };
    }

    summary.missing.push({ nodeName: n.name, snapshot });
    return snapshot ? { ...n, config: { ...cfg, expected: snapshot } } : n;
  });

  const taken = new Set(existingFlowNames);
  const name = taken.has(parsed.flow.name)
    ? generateDuplicateName(parsed.flow.name, taken)
    : parsed.flow.name;

  return { name, description: parsed.flow.description, nodes, edges: migrated.edges, summary };
}
