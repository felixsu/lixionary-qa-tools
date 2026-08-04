"""Flow-run history endpoints for the local sidecar.

Backs the Home page's "Flow executions" table and its per-run CSV report
download. Rows are written by two producers: the MCP server (agent runs,
inserted as 'running' then finalized) and POST here (UI runs, which execute
client-side and register only once complete — a mid-run window close must
not leave orphaned 'running' rows).
"""

import json
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from db.local_store import LocalStore
from services.flow_report import shrink_summary

router = APIRouter(prefix="/api/flow-runs", tags=["flow-runs"])

RETAINED_RUNS = 100

_COMPLETED_STATUSES = {"success", "failed", "cancelled"}


def _present(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "runId": row["run_id"],
        "flowLocalId": row["flow_local_id"],
        "flowName": row["flow_name"],
        "environmentLocalId": row["environment_local_id"],
        "environmentName": row["environment_name"],
        "source": row["source"],
        "status": row["status"],
        "nodeCount": row["node_count"],
        "startedAt": row["started_at"],
        "durationMs": row["duration_ms"],
        # SQLite booleans arrive as 0/1; summary presence doubles as "report
        # downloadable" for both list (has_report) and detail (summary_json).
        "hasReport": bool(row.get("has_report", row.get("summary_json") is not None)),
        "avgDurationMs": row.get("avg_duration_ms"),
    }


class RegisterRunPayload(BaseModel):
    flowLocalId: str
    flowName: str
    environmentLocalId: Optional[str] = None
    environmentName: Optional[str] = None
    nodeCount: int
    summary: Dict[str, Any]


@router.get("")
async def list_runs(limit: int = Query(20, ge=1, le=100)):
    return [_present(r) for r in LocalStore.list_flow_runs(limit)]


@router.get("/{run_id}")
async def get_run(run_id: str):
    row = LocalStore.get_flow_run(run_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    out = _present(row)
    out["summary"] = json.loads(row["summary_json"]) if row["summary_json"] else None
    return out


@router.post("")
async def register_run(body: RegisterRunPayload):
    """Registers a completed UI-triggered run."""
    status = (body.summary or {}).get("status")
    if status not in _COMPLETED_STATUSES:
        raise HTTPException(status_code=400, detail=f"summary.status must be one of {sorted(_COMPLETED_STATUSES)}")
    run_id = uuid.uuid4().hex[:12]
    duration_ms = body.summary.get("durationMs")
    LocalStore.insert_flow_run(
        run_id,
        flow_local_id=body.flowLocalId,
        flow_name=body.flowName,
        environment_local_id=body.environmentLocalId,
        environment_name=body.environmentName,
        source="user",
        status=status,
        node_count=body.nodeCount,
        started_at=body.summary.get("startedAt") or LocalStore._now(),
        duration_ms=int(duration_ms) if duration_ms is not None else None,
        summary_json=json.dumps(shrink_summary(body.summary)),
    )
    LocalStore.prune_flow_runs(RETAINED_RUNS)
    row = LocalStore.get_flow_run(run_id)
    return _present(row)
