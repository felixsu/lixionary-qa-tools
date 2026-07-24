// CSV report for API Studio flow runs: one row per executed module,
// including each looper iteration and each verifier attempt.

import type { RunRecord, FlowRunSummary } from "./flowRunner";

const CSV_COLUMNS = [
  "node_name",
  "node_type",
  "iteration",
  "attempt",
  "status",
  "started_at",
  "duration_ms",
  "resolved_inputs",
  "outputs",
  "request_json",
  "response_status",
  "response_json",
  "error",
  "test_results",
] as const;

const escapeCell = (value: string): string => {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

// Combined human-readable test outcome, e.g. "order_id matched: PASS; status ok: FAIL".
// Empty when the record has no test data (pre-feature runs, scriptless requests).
const formatTestCell = (r: RunRecord): string => {
  if (!r.testResults && !r.testError) return "";
  return [
    // sandbox errors already carry an "ERROR: " prefix; only add one when absent
    r.testError ? (r.testError.startsWith("ERROR") ? r.testError : `ERROR: ${r.testError}`) : null,
    ...(r.testResults || []).map((t) => `${t.name}: ${t.passed ? "PASS" : "FAIL"}`),
  ]
    .filter(Boolean)
    .join("; ");
};

const jsonCell = (value: any): string => {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export function buildRunCsv(records: RunRecord[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of records) {
    const cells = [
      r.nodeName,
      r.nodeType,
      r.iteration !== undefined ? String(r.iteration) : "",
      r.attempt !== undefined ? String(r.attempt) : "",
      r.status,
      r.startedAt,
      String(r.durationMs),
      jsonCell(r.resolvedInputs),
      jsonCell(r.outputs),
      jsonCell(r.requestPayload),
      r.response ? String(r.response.status) : "",
      jsonCell(r.response),
      r.error || "",
      formatTestCell(r),
    ];
    lines.push(cells.map(escapeCell).join(","));
  }
  return lines.join("\n");
}

// Blob-anchor download (same pattern as web-explorer's code export); works
// in the Tauri webview as well as the browser.
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const runCsvFilename = (flowName: string): string => {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  const safe = flowName.replace(/[^A-Za-z0-9_-]+/g, "_") || "flow";
  return `${safe}-run-${stamp}.csv`;
};

// ---- Last-run persistence (localStorage) -----------------------------------

const STORAGE_PREFIX = "studioLastRun:";
const MAX_FIELD_CHARS = 20_000; // keep well under the ~5MB quota

const truncateString = (s: string): string =>
  s.length > MAX_FIELD_CHARS ? s.slice(0, MAX_FIELD_CHARS) + "…(truncated)" : s;

const shrinkRecord = (r: RunRecord): RunRecord => ({
  ...r,
  requestPayload: r.requestPayload
    ? JSON.parse(truncateJson(r.requestPayload))
    : null,
  response: r.response
    ? { ...r.response, body: shrinkValue(r.response.body) }
    : null,
  outputs: r.outputs ? JSON.parse(truncateJson(r.outputs)) : null,
  testError: r.testError ? truncateString(r.testError) : r.testError,
});

const truncateJson = (value: any): string => {
  const s = JSON.stringify(value);
  if (s.length <= MAX_FIELD_CHARS) return s;
  // Too large to keep whole — store a marker object instead of invalid JSON.
  return JSON.stringify({ _truncated: true, preview: truncateString(s) });
};

const shrinkValue = (value: any): any => {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (s === undefined || s === null) return value;
  if (s.length <= MAX_FIELD_CHARS) return value;
  return truncateString(typeof value === "string" ? value : s);
};

export function persistLastRun(flowId: string, summary: FlowRunSummary): void {
  try {
    const slim: FlowRunSummary = { ...summary, records: summary.records.map(shrinkRecord) };
    localStorage.setItem(STORAGE_PREFIX + flowId, JSON.stringify(slim));
  } catch {
    // storage full/unavailable — the run stays available in memory only
  }
}

export function loadLastRun(flowId: string): FlowRunSummary | null {
  try {
    const s = localStorage.getItem(STORAGE_PREFIX + flowId);
    return s ? (JSON.parse(s) as FlowRunSummary) : null;
  } catch {
    return null;
  }
}
