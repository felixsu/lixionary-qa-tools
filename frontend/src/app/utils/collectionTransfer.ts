import type { Collection, RequestItem, AuthFunction } from "../context/AppContext";

export const COLLECTION_EXPORT_FORMAT = "nv-collection-export";
export const COLLECTION_EXPORT_VERSION = 1;

// Mirrors the depth limit enforced by handleCreateSubCollection and the
// cloud's process_collection_tree.
const MAX_COLLECTION_DEPTH = 5;

// Tree payload without identity/sync fields — what travels in an export file
// and what the local store accepts as a new root's payload.
export interface CollectionTransferPayload {
  name: string;
  description: string;
  requests: RequestItem[];
  children: CollectionTransferPayload[];
}

interface ExportEnvelope {
  format: typeof COLLECTION_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  collection: CollectionTransferPayload & { id?: string };
}

// Whitelist-copy a request, dropping transient response data. Static auth
// values (token/key/value) are kept on purpose — a portable export is the
// point — and authFunctionId is kept raw so import can try to re-match it.
const exportRequest = (req: RequestItem): RequestItem => {
  const { lastResponse, ...rest } = req;
  return { ...rest, authConfig: { ...(rest.authConfig || {}) } };
};

// Whitelist-copy a collection node: keeps name/description/requests/children,
// drops cloudId/ownerId/collaboratorIds and any local-store meta. Node ids are
// kept only as a debugging aid; import discards them.
const exportNode = (node: Collection): ExportEnvelope["collection"] => ({
  id: node.id,
  name: node.name,
  description: node.description || "",
  requests: (node.requests || []).map(exportRequest),
  children: (node.children || []).map(exportNode),
});

export function serializeCollectionForExport(root: Collection): string {
  const envelope: ExportEnvelope = {
    format: COLLECTION_EXPORT_FORMAT,
    version: COLLECTION_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    collection: exportNode(root),
  };
  return JSON.stringify(envelope, null, 2);
}

export function collectionExportFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "collection";
  return `${slug}.collection.json`;
}

// Blob-anchor download (same pattern as flowReport's downloadCsv); works in
// the Tauri webview as well as the browser.
export function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const validateNode = (node: any, depth: number): void => {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new Error("Invalid export file: collection entry is not an object.");
  }
  if (typeof node.name !== "string" || !node.name.trim()) {
    throw new Error("Invalid export file: a collection is missing its name.");
  }
  if (depth > MAX_COLLECTION_DEPTH) {
    throw new Error(`Collection nesting exceeds the maximum depth of ${MAX_COLLECTION_DEPTH} levels.`);
  }
  if (node.requests !== undefined && !Array.isArray(node.requests)) {
    throw new Error(`Invalid export file: "requests" of "${node.name}" is not a list.`);
  }
  for (const req of node.requests || []) {
    if (!req || typeof req !== "object" ||
        typeof req.name !== "string" || typeof req.method !== "string" || typeof req.url !== "string") {
      throw new Error(`Invalid export file: a request in "${node.name}" is malformed.`);
    }
  }
  if (node.children !== undefined && !Array.isArray(node.children)) {
    throw new Error(`Invalid export file: "children" of "${node.name}" is not a list.`);
  }
  for (const child of node.children || []) validateNode(child, depth + 1);
};

// Parses and validates an export file's text. Throws a descriptive Error on
// anything unusable; on success the returned tree is shape-checked but still
// carries the file's original ids.
export function parseCollectionImport(text: string): { collection: CollectionTransferPayload } {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }
  if (!data || typeof data !== "object" || data.format !== COLLECTION_EXPORT_FORMAT) {
    throw new Error("Not a recognized collection export file.");
  }
  if (data.version !== COLLECTION_EXPORT_VERSION) {
    throw new Error(`Unsupported export file version (${data.version}).`);
  }
  validateNode(data.collection, 1);
  return { collection: data.collection };
}

// Rebuilds an imported tree for this installation: every child collection and
// request gets a fresh id (the root's id is assigned by the local store on
// create), meta/transient fields are dropped again defensively, and any
// authFunctionId that doesn't match a local auth function (by localId or
// cloudId — refs may hold either form) is cleared for the user to reassign.
export function prepareImportedCollection(
  collection: CollectionTransferPayload,
  authFunctions: AuthFunction[]
): CollectionTransferPayload {
  const authFunctionExists = (ref: string): boolean =>
    authFunctions.some((af) => af.id === ref || af.cloudId === ref);

  const prepareRequest = (req: any): RequestItem => {
    const { lastResponse, ...rest } = req;
    const authConfig = { ...(rest.authConfig || {}) };
    if (authConfig.authFunctionId && !authFunctionExists(authConfig.authFunctionId)) {
      authConfig.authFunctionId = null;
    }
    return { ...rest, id: `req_${Math.random().toString(36).substring(2, 9)}`, authConfig };
  };

  const prepareNode = (node: any, isRoot: boolean): CollectionTransferPayload & { id?: string } => ({
    ...(isRoot ? {} : { id: `col_${Math.random().toString(36).substring(2, 9)}` }),
    name: node.name,
    description: typeof node.description === "string" ? node.description : "",
    requests: (node.requests || []).map(prepareRequest),
    children: (node.children || []).map((c: any) => prepareNode(c, false)),
  });

  return prepareNode(collection, true);
}
