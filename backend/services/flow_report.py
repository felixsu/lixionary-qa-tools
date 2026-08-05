"""CSV + condensed-report shaping for headless API Studio flow runs.

Python port of frontend/src/app/utils/flowReport.ts (buildRunCsv and the
shrink/truncate helpers) — keep the column set and escaping in sync so an
agent-fetched CSV matches the one the UI's Report button downloads.
"""

import json
from typing import Any, Dict, List, Optional

CSV_COLUMNS = [
    "node_name",
    "node_type",
    "iteration",
    "attempt",
    "scope",  # V2 loop-body rows: "loopName[iteration]"; empty for V1 runs
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
]

MAX_FIELD_CHARS = 20_000  # persistence cap, mirrors flowReport.ts


def _escape_cell(value: str) -> str:
    if any(c in value for c in ',"\n\r'):
        return '"' + value.replace('"', '""') + '"'
    return value


def _format_test_cell(record: Dict[str, Any]) -> str:
    """Combined human-readable test outcome, e.g. "order_id matched: PASS"."""
    test_results = record.get("testResults")
    test_error = record.get("testError")
    if not test_results and not test_error:
        return ""
    parts = []
    if test_error:
        # sandbox errors already carry an "ERROR: " prefix; only add one when absent
        parts.append(test_error if test_error.startswith("ERROR") else f"ERROR: {test_error}")
    for t in test_results or []:
        parts.append(f"{t.get('name')}: {'PASS' if t.get('passed') else 'FAIL'}")
    return "; ".join(parts)


def _json_cell(value: Any) -> str:
    if value is None:
        return ""
    try:
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    except Exception:
        return str(value)


def build_run_csv(records: List[Dict[str, Any]]) -> str:
    # Parallel branches emit interleaved records; sort by start time (ISO
    # strings compare lexicographically) with the emission index as a stable
    # tiebreak for same-millisecond rows.
    sorted_records = [r for _, _, r in sorted(
        ((r.get("startedAt") or "", i, r) for i, r in enumerate(records)),
        key=lambda t: (t[0], t[1]),
    )]
    lines = [",".join(CSV_COLUMNS)]
    for r in sorted_records:
        response = r.get("response")
        cells = [
            r.get("nodeName") or "",
            r.get("nodeType") or "",
            str(r["iteration"]) if r.get("iteration") is not None else "",
            str(r["attempt"]) if r.get("attempt") is not None else "",
            r.get("scope") or "",
            r.get("status") or "",
            r.get("startedAt") or "",
            str(r.get("durationMs", "")),
            _json_cell(r.get("resolvedInputs")),
            _json_cell(r.get("outputs")),
            _json_cell(r.get("requestPayload")),
            str(response["status"]) if response else "",
            _json_cell(response),
            r.get("error") or "",
            _format_test_cell(r),
        ]
        lines.append(",".join(_escape_cell(c) for c in cells))
    return "\n".join(lines)


# ---- Size shaping -------------------------------------------------------------

def _truncate_string(s: str, limit: int) -> str:
    return s[:limit] + "…(truncated)" if len(s) > limit else s


def _truncate_json_value(value: Any, limit: int) -> Any:
    """Return `value` unchanged when its JSON form fits, else a marker object
    holding a preview — same shape as flowReport.ts truncateJson."""
    try:
        s = json.dumps(value, ensure_ascii=False)
    except Exception:
        return {"_truncated": True, "preview": _truncate_string(str(value), limit)}
    if len(s) <= limit:
        return value
    return {"_truncated": True, "preview": _truncate_string(s, limit)}


def _shrink_value(value: Any, limit: int) -> Any:
    s = value if isinstance(value, str) else json.dumps(value if value is not None else None, ensure_ascii=False)
    if len(s) <= limit:
        return value
    return _truncate_string(s if isinstance(value, str) else s, limit)


def shrink_record(record: Dict[str, Any], limit: int = MAX_FIELD_CHARS) -> Dict[str, Any]:
    shrunk = dict(record)
    if record.get("requestPayload") is not None:
        shrunk["requestPayload"] = _truncate_json_value(record["requestPayload"], limit)
    if record.get("response") is not None:
        shrunk["response"] = {**record["response"], "body": _shrink_value(record["response"].get("body"), limit)}
    if record.get("outputs") is not None:
        shrunk["outputs"] = _truncate_json_value(record["outputs"], limit)
    if record.get("testError"):
        shrunk["testError"] = _truncate_string(record["testError"], limit)
    return shrunk


def shrink_summary(summary: Dict[str, Any], limit: int = MAX_FIELD_CHARS) -> Dict[str, Any]:
    """Field-capped copy of a run summary for persistence (context dropped —
    it exists to seed UI retries, which headless runs don't do)."""
    slim = dict(summary)
    slim["records"] = [shrink_record(r, limit) for r in summary.get("records") or []]
    slim.pop("context", None)
    return slim


def condense_summary(
    summary: Dict[str, Any],
    *,
    flow_name: str,
    environment_name: Optional[str],
    max_field_chars: int = 4000,
    max_records: int = 300,
    warnings: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Compact MCP-response form of a run: a digest an agent can read without
    parsing every record, plus size-capped records (all failures/skips kept;
    successes dropped first when over max_records)."""
    records = summary.get("records") or []
    counts = {"success": 0, "failed": 0, "skipped": 0}
    failures = []
    for r in records:
        status = r.get("status")
        if status in counts:
            counts[status] += 1
        if status == "failed":
            failures.append({
                "nodeName": r.get("nodeName"),
                **({"iteration": r["iteration"]} if r.get("iteration") is not None else {}),
                **({"attempt": r["attempt"]} if r.get("attempt") is not None else {}),
                **({"scope": r["scope"]} if r.get("scope") else {}),
                "error": r.get("error"),
            })

    kept = records
    omitted = 0
    if len(records) > max_records:
        keep_always = [r for r in records if r.get("status") != "success"]
        budget = max(0, max_records - len(keep_always))
        successes = [r for r in records if r.get("status") == "success"]
        # keep the head and tail of the successes — the interesting ends
        head = successes[: budget // 2]
        tail = successes[len(successes) - (budget - len(head)):] if budget - len(head) > 0 else []
        kept_set = {id(r) for r in keep_always + head + tail}
        kept = [r for r in records if id(r) in kept_set]
        omitted = len(records) - len(kept)

    report = {
        "status": summary.get("status"),
        "flowName": flow_name,
        "environmentName": environment_name,
        "startedAt": summary.get("startedAt"),
        "durationMs": summary.get("durationMs"),
        "counts": counts,
        "failures": failures,
        "records": [shrink_record(r, max_field_chars) for r in kept],
    }
    # V2 streaming runs: per-node item tallies, so an agent can see "8 of 10
    # items succeeded here" without counting records itself.
    if summary.get("nodeItemCounts"):
        report["nodeItemCounts"] = summary["nodeItemCounts"]
    if summary.get("timeoutHit"):
        report["timeoutHit"] = True
    if omitted:
        report["recordsOmitted"] = omitted
    if warnings:
        report["warnings"] = warnings
    return report
