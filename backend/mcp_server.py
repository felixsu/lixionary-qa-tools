"""MCP server exposing API Studio flows to AI agents.

Mounted by local_sidecar.py at /mcp (streamable HTTP), so any MCP client on
this machine — e.g. `claude mcp add --transport http api-studio
http://127.0.0.1:8484/mcp` — can list environments/flows and run a flow
headlessly via services.flow_runner (the Python port of the UI's TS runner).

Same trust model as the rest of the sidecar: no auth, 127.0.0.1 only. Tools
never expose environment variable values (they may hold secrets) — only keys.

The tool bodies live in plain *_data/_impl helpers so backend/tests can
exercise them without speaking the MCP protocol.
"""

import json
import uuid
from typing import Any, Dict, List, Optional, Tuple

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError

from db.local_store import LocalStore
from services.flow_report import build_run_csv, condense_summary, shrink_summary
from services.flow_runner import FlowRunError
from services import flow_runner

# streamable_http_path="/" because the app is mounted at /mcp — the default
# "/mcp" would double up to /mcp/mcp.
mcp = FastMCP(
    "Lixionary API Studio",
    instructions=(
        "Runs the user's saved API Studio flows on their machine. Typical use: "
        "list_flows and list_environments to discover what exists, run_flow to "
        "execute one, get_run_report for the full report of a past run."
    ),
    stateless_http=True,
    json_response=True,
    streamable_http_path="/",
)

_RUN_PREF = "flow_run:"
_LATEST_PREF = "flow_run_latest:"

_ENTITY_LABEL = {"flow": "Flow", "environment": "Environment"}


def _entities(entity_type: str) -> List[Tuple[Dict[str, Any], Dict[str, Any]]]:
    """(record, parsed payload) pairs for all live entities of a type."""
    out = []
    for record in LocalStore.list(entity_type):
        try:
            payload = json.loads(record["payload"])
        except Exception:
            continue
        out.append((record, payload))
    return out


def resolve_entity(entity_type: str, ref: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Resolve a flow/environment by case-insensitive name first, then by
    local/cloud id. Raises ToolError with actionable candidates on ambiguity
    or a not-found."""
    label = _ENTITY_LABEL.get(entity_type, entity_type)
    ref = (ref or "").strip()
    if not ref:
        raise ToolError(f"{label} reference is empty")

    entities = _entities(entity_type)
    matches = [(r, p) for r, p in entities if (p.get("name") or "").strip().lower() == ref.lower()]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        candidates = ", ".join(f'"{p.get("name")}" (id: {r["localId"]})' for r, p in matches)
        raise ToolError(
            f'{label} name "{ref}" is ambiguous — {len(matches)} entries share it. '
            f"Retry with one of the ids instead: {candidates}"
        )

    record = LocalStore.get_by_local_or_cloud_id(entity_type, ref)
    if record:
        try:
            return record, json.loads(record["payload"])
        except Exception:
            raise ToolError(f"{label} {ref} has an unreadable payload")

    names = sorted((p.get("name") or "(unnamed)") for _, p in entities)
    available = ", ".join(f'"{n}"' for n in names) if names else "none"
    raise ToolError(f'{label} "{ref}" not found. Available: {available}')


def list_environments_data() -> List[Dict[str, Any]]:
    return [
        {
            "id": record["localId"],
            "cloudId": record["cloudId"],
            "name": payload.get("name"),
            "variableKeys": [v.get("key") for v in payload.get("variables") or [] if v.get("key")],
        }
        for record, payload in _entities("environment")
    ]


def list_flows_data() -> List[Dict[str, Any]]:
    return [
        {
            "id": record["localId"],
            "cloudId": record["cloudId"],
            "name": payload.get("name"),
            "description": payload.get("description") or "",
            "nodeCount": len(payload.get("nodes") or []),
            "nodeNames": [n.get("name") for n in payload.get("nodes") or []],
        }
        for record, payload in _entities("flow")
    ]


def _persist_run(run_id: str, flow_record: Dict[str, Any], flow_name: str,
                 environment_id: Optional[str], environment_name: Optional[str],
                 summary: Dict[str, Any]) -> None:
    """Keep exactly the latest run per flow in local_prefs — enough for
    get_run_report after a client-side timeout, without unbounded growth."""
    flow_local_id = flow_record["localId"]
    previous = LocalStore.get_pref(_LATEST_PREF + flow_local_id)
    if previous and previous != run_id:
        LocalStore.delete_pref(_RUN_PREF + previous)
    LocalStore.set_pref(_RUN_PREF + run_id, json.dumps({
        "runId": run_id,
        "flowLocalId": flow_local_id,
        "flowName": flow_name,
        "environmentLocalId": environment_id,
        "environmentName": environment_name,
        "summary": shrink_summary(summary),
    }))
    LocalStore.set_pref(_LATEST_PREF + flow_local_id, run_id)


async def run_flow_impl(flow: str, environment: Optional[str], timeout_seconds: int,
                        executor=None) -> Dict[str, Any]:
    # `executor` is a test seam — None means the real execute_request.
    flow_record, flow_payload = resolve_entity("flow", flow)
    flow_name = flow_payload.get("name") or flow

    environment_id = None
    environment_name = None
    warnings: List[str] = []
    if environment:
        env_record, env_payload = resolve_entity("environment", environment)
        environment_id = env_record["localId"]
        environment_name = env_payload.get("name")
    else:
        warnings.append(
            "No environment specified — the flow ran without environment "
            "variables; {{env.*}} tokens were left unresolved."
        )

    collections = [payload for _, payload in _entities("collection")]
    timeout = min(1800, max(10, int(timeout_seconds or 600)))

    try:
        summary = await flow_runner.run_flow(
            flow_payload,
            environment_id=environment_id,
            collections=collections,
            executor=executor,
            get_pref=LocalStore.get_pref,
            timeout_seconds=timeout,
        )
    except FlowRunError as e:
        raise ToolError(str(e))

    run_id = uuid.uuid4().hex[:12]
    try:
        _persist_run(run_id, flow_record, flow_name, environment_id, environment_name, summary)
    except Exception as e:
        warnings.append(f"Run report could not be persisted for get_run_report: {e}")

    return {
        "runId": run_id,
        "report": condense_summary(
            summary,
            flow_name=flow_name,
            environment_name=environment_name,
            warnings=warnings or None,
        ),
    }


def get_run_report_data(run_id: str, format: str) -> Any:
    raw = LocalStore.get_pref(_RUN_PREF + (run_id or "").strip())
    if not raw:
        raise ToolError(
            f'Run "{run_id}" not found — only the latest run per flow is kept. '
            "Re-run the flow to produce a fresh report."
        )
    stored = json.loads(raw)
    if format == "csv":
        return build_run_csv(stored.get("summary", {}).get("records") or [])
    return stored


@mcp.tool()
def list_environments() -> List[Dict[str, Any]]:
    """List the saved environments on this machine. Returns id, name, and the
    variable KEYS defined in each (values are never exposed)."""
    return list_environments_data()


@mcp.tool()
def list_flows() -> List[Dict[str, Any]]:
    """List the saved API Studio flows on this machine, with their node names
    and counts. Use a flow's name (or id if names collide) with run_flow."""
    return list_flows_data()


@mcp.tool()
async def run_flow(flow: str, environment: Optional[str] = None, timeout_seconds: int = 600) -> Dict[str, Any]:
    """Execute a saved API Studio flow headlessly and return its run report.

    `flow` and `environment` are matched by name (case-insensitive) first,
    then by id. Omitting `environment` runs without environment variables.
    Returns {runId, report}: the report holds the run status, per-node
    records (large fields truncated), and a failure digest. Use
    get_run_report(runId) for the full or CSV version. Note: like a UI run,
    parser env.set() writes persist to the environment."""
    return await run_flow_impl(flow, environment, timeout_seconds)


@mcp.tool()
def get_run_report(run_id: str, format: str = "json") -> Any:
    """Fetch the stored report of a past run_flow call by its runId.
    format="json" returns the full record set; format="csv" returns the same
    CSV text the API Studio UI's Report button downloads. Only the latest run
    per flow is retained."""
    if format not in ("json", "csv"):
        raise ToolError('format must be "json" or "csv"')
    return get_run_report_data(run_id, format)
