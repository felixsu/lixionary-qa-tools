// JSONPath evaluation for V2 flows (demux rows, request verify checks, and the
// per-connection projection).
//
// JSONPath always yields a LIST of matches, so the list has to be collapsed to
// one value before it can travel down a connection. That normalization is the
// single most divergence-prone rule between the two engines, so it lives here
// in one place and is mirrored exactly by backend/services/flow_runner_v2.py:
//
//   0 matches  → miss (the caller turns this into a hole)
//   1 match    → that value
//   2+ matches → the array of matches (what `$.items[*].id` should mean)
//
// Script evaluation is disabled: these expressions come from user input and
// must never reach a JS evaluator.

import { JSONPath } from "jsonpath-plus";

export interface PathResult {
  found: boolean;
  value: unknown;
  error?: string;
}

const asMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const MISS: PathResult = { found: false, value: undefined };

// What jsonpath-plus accepts as the document to query.
type JsonDocument = string | number | boolean | object | unknown[] | null;

export const evalJsonPath = (path: string, json: unknown): PathResult => {
  const expr = (path || "").trim();
  if (!expr) return { found: false, value: undefined, error: "empty path" };
  let matches: unknown[];
  try {
    matches = JSONPath({ path: expr, json: json as JsonDocument, wrap: true, eval: false });
  } catch (e) {
    return { found: false, value: undefined, error: `invalid path (${asMessage(e)})` };
  }
  if (!Array.isArray(matches) || matches.length === 0) return MISS;
  if (matches.length === 1) return { found: true, value: matches[0] };
  return { found: true, value: matches };
};

/** Response shape a verify check reads against: `$.status`, `$.body…`,
 * `$.headers…`, `$.outputs…`. Built once per attempt. */
export const verifyTarget = (exec: {
  response: { status: number; statusText: string; headers: Record<string, string>; body: unknown } | null;
  outputs: Record<string, unknown>;
}): Record<string, unknown> => ({
  status: exec.response?.status ?? null,
  statusText: exec.response?.statusText ?? null,
  headers: exec.response?.headers ?? {},
  body: exec.response?.body ?? null,
  outputs: exec.outputs ?? {},
});
