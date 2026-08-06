// Live connection validation for the V2 canvas — the interactive twin of
// validateFlowV2's edge rules (flowTypesV2.ts). Rejects invalid drags before
// they become connections; the full validator still runs on the serialized
// flow for the toolbar warning and the pre-run gate.

import type { Connection, Edge } from "@xyflow/react";
import { parseHandle, portById } from "../../../utils/flowTypesV2";
import type { StudioNodeV2 } from "./serialize";

export type RejectionReason = "invalid" | "input-taken" | "cycle";

export const connectionRejection = (
  conn: Connection | Edge,
  nodes: StudioNodeV2[],
  edges: Edge[]
): RejectionReason | null => {
  if (!conn.source || !conn.target || conn.source === conn.target) return "invalid";

  const src = parseHandle(conn.sourceHandle);
  const tgt = parseHandle(conn.targetHandle);
  if (!src || src.direction !== "out" || !tgt || tgt.direction !== "in") return "invalid";
  if (src.kind !== tgt.kind) return "invalid"; // data↔data, trigger↔trigger only

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const source = nodeById.get(conn.source);
  const target = nodeById.get(conn.target);
  if (!source || !target) return "invalid";
  if (!portById(source.data.ports, conn.sourceHandle)) return "invalid";
  if (!portById(target.data.ports, conn.targetHandle)) return "invalid";

  // An input takes exactly one connection, so a value is never ambiguously
  // merged; an output may feed as many inputs as it likes.
  if (src.kind === "data") {
    if (edges.some((e) => e.target === conn.target && e.targetHandle === conn.targetHandle))
      return "input-taken";
  } else if (
    edges.some(
      (e) =>
        e.source === conn.source &&
        e.target === conn.target &&
        e.sourceHandle === conn.sourceHandle &&
        e.targetHandle === conn.targetHandle
    )
  ) {
    return "invalid"; // exact duplicate trigger wire
  }

  // Adding source→target closes a cycle iff target already reaches source.
  const parents = new Map<string, string[]>();
  for (const e of edges) {
    if (!parents.has(e.target)) parents.set(e.target, []);
    parents.get(e.target)!.push(e.source);
  }
  const seen = new Set<string>();
  const stack = [...(parents.get(conn.source) || [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === conn.target) return "cycle";
    stack.push(...(parents.get(id) || []));
  }

  return null;
};

export const isValidConnectionV2 = (
  conn: Connection | Edge,
  nodes: StudioNodeV2[],
  edges: Edge[]
): boolean => connectionRejection(conn, nodes, edges) === null;
