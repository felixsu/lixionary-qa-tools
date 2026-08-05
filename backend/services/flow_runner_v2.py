"""Headless API Studio V2 streaming flow runner.

Python twin of frontend/src/app/utils/flowRunnerV2.ts (+ streamV2.ts,
jsonPathV2.ts, and the schema in flowTypesV2.ts) — keep them in sync; the
shared fixtures in backend/tests/fixtures/v2_flows are the guard. Serves
headless callers (MCP run_flow) for flows with schemaVersion == 2.

V2 semantics: a data connection carries an ordered stream of items terminated
by an end-of-stream marker, so a loop is just composition
(arrayEmit -> request -> accumulator). Every node runs its own asyncio task
pulling tuples from a joiner that pairs its connected inputs positionally and
latches any input that turns out to be a single value. Items are pipelined; a
failed item becomes a hole that keeps its position so forked branches stay
aligned when they rejoin.
"""

import asyncio
import json
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from services.flow_runner import (
    ExecutorFn,
    FlowCancelledError,
    FlowRunError,
    _RunState,
    _cancellable_delay,
    _execution_result,
    _iso_now,
    _js_number,
    _js_str,
    _make_record,
    _now_ms,
    execute_resolved_request,
    find_request,
    stringify_value,
)

EMIT_MAX_ITEMS = 100
DUPLICATOR_MIN_OUTPUTS = 2
DUPLICATOR_MAX_OUTPUTS = 8

TRIGGER_IN = "after"
TRIGGER_OUT = "done"

FLOW_NODE_TYPES_V2 = ("request", "delay", "arrayEmit", "accumulator", "demux", "mux", "duplicator")

_TOKEN_RE = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")


# ---- JSONPath ----------------------------------------------------------------
# JSONPath yields a LIST of matches; collapsing it to one value is the most
# divergence-prone rule between the two engines, so it lives in one place and
# mirrors frontend/src/app/utils/jsonPathV2.ts exactly:
#   0 matches -> miss, 1 match -> that value, 2+ -> the list of matches.

def eval_json_path(path: str, data: Any) -> Tuple[bool, Any, Optional[str]]:
    expr = (path or "").strip()
    if not expr:
        return False, None, "empty path"
    try:
        from jsonpath_ng.ext import parse as _parse
        matches = [m.value for m in _parse(expr).find(data)]
    except Exception as e:
        return False, None, f"invalid path ({e})"
    if not matches:
        return False, None, None
    if len(matches) == 1:
        return True, matches[0], None
    return True, matches, None


def verify_target(exec_result: Dict[str, Any]) -> Dict[str, Any]:
    """Shape a verify check reads against: $.status, $.body…, $.headers…, $.outputs…"""
    response = exec_result.get("response") or {}
    return {
        "status": response.get("status"),
        "statusText": response.get("statusText"),
        "headers": response.get("headers") or {},
        "body": response.get("body"),
        "outputs": exec_result.get("outputs") or {},
    }


def compare_values(operator: str, actual: Any, expected: Any) -> bool:
    """Comparison over already-extracted values (JSONPath did the walking)."""
    both_numeric = (
        actual is not None
        and actual != ""
        and _js_number(actual) is not None
        and _js_number(expected) is not None
    )
    if operator == "exists":
        return actual is not None
    if operator == "equals":
        return _js_number(actual) == _js_number(expected) if both_numeric else _js_str(actual) == _js_str(expected)
    if operator == "not_equals":
        return _js_number(actual) != _js_number(expected) if both_numeric else _js_str(actual) != _js_str(expected)
    if operator == "contains":
        if isinstance(actual, list):
            return any(_js_str(v) == _js_str(expected) for v in actual)
        return _js_str(expected if expected is not None else "") in _js_str(actual if actual is not None else "")
    if operator == "greater_than":
        return both_numeric and _js_number(actual) > _js_number(expected)
    if operator == "less_than":
        return both_numeric and _js_number(actual) < _js_number(expected)
    return False


# ---- Handles -----------------------------------------------------------------

def data_in_handle(name: str) -> str:
    return f"in:{name}"


def data_out_handle(name: str) -> str:
    return f"out:{name}"


def demux_out_name(row_id: str) -> str:
    return f"o:{row_id}"


def mux_in_name(row_id: str) -> str:
    return f"i:{row_id}"


def duplicator_out_name(index: int) -> str:
    return f"o:{index}"


def verify_check_port_name(check_id: str) -> str:
    return f"cmp:{check_id}"


def parse_handle(handle: Optional[str]) -> Optional[Dict[str, Any]]:
    if not handle:
        return None
    if handle == TRIGGER_IN:
        return {"kind": "trigger", "direction": "in", "name": None}
    if handle == TRIGGER_OUT:
        return {"kind": "trigger", "direction": "out", "name": None}
    if handle.startswith("in:"):
        return {"kind": "data", "direction": "in", "name": handle[3:]}
    if handle.startswith("out:"):
        return {"kind": "data", "direction": "out", "name": handle[4:]}
    return None


def edge_kind(edge: Dict[str, Any]) -> str:
    if edge.get("sourceHandle") == TRIGGER_OUT or edge.get("targetHandle") == TRIGGER_IN:
        return "trigger"
    return "data"


# ---- Hardcoded inputs --------------------------------------------------------

def parse_static_input(static_input: Optional[Dict[str, Any]]) -> Tuple[bool, Any, Optional[str]]:
    """Parses a hardcoded value per its declared type. Tokens pass through —
    only the executor can resolve {{env.X}} / {{$...}}."""
    if not static_input:
        return False, None, None
    raw = static_input.get("value") or ""
    kind = static_input.get("type") or "string"
    if "{{" in raw:
        return True, raw, None
    if kind == "number":
        try:
            text = raw.strip()
            if text == "":
                raise ValueError()
            value = float(text)
            return True, int(value) if value.is_integer() else value, None
        except Exception:
            return False, None, f'"{raw}" is not a number'
    if kind == "boolean":
        text = raw.strip().lower()
        if text == "true":
            return True, True, None
        if text == "false":
            return True, False, None
        return False, None, f'"{raw}" is not true or false'
    if kind == "json":
        try:
            return True, json.loads(raw or "null"), None
        except Exception as e:
            return False, None, f"invalid JSON ({e})"
    return True, raw, None


# ---- Ports -------------------------------------------------------------------

def scan_input_names(request: Dict[str, Any]) -> List[str]:
    """Bare {{name}} tokens across interpolated request fields, deduped in
    first-seen order — twin of requestTokens.ts scanInputNames."""
    names: List[str] = []
    seen: set = set()

    def collect(text: Optional[str]) -> None:
        if not text:
            return
        for match in _TOKEN_RE.finditer(text):
            name = match.group(1).strip()
            if not name or name.startswith("$") or name.startswith("env."):
                continue
            if name in seen:
                continue
            seen.add(name)
            names.append(name)

    collect(request.get("url"))
    for h in request.get("headers") or []:
        collect(h.get("value"))
    for p in request.get("queryParams") or []:
        collect(p.get("value"))
    collect(request.get("body"))

    auth_type = (request.get("authType") or "").upper()
    auth_config = request.get("authConfig") or {}
    if auth_type == "BEARER":
        collect(auth_config.get("token"))
    elif auth_type == "API_KEY":
        collect(auth_config.get("key"))
        collect(auth_config.get("value"))

    for b in request.get("inputs") or []:
        name = b.get("name")
        if name and name not in seen:
            seen.add(name)
            names.append(name)
    return names


def _trigger_ports() -> List[Dict[str, Any]]:
    return [
        {"id": TRIGGER_IN, "name": "after", "kind": "trigger", "direction": "in", "dataType": "any"},
        {"id": TRIGGER_OUT, "name": "done", "kind": "trigger", "direction": "out", "dataType": "any"},
    ]


def _port(pid: str, name: str, kind: str, direction: str, data_type: str = "any", label: Optional[str] = None) -> Dict[str, Any]:
    port = {"id": pid, "name": name, "kind": kind, "direction": direction, "dataType": data_type}
    if label is not None:
        port["label"] = label
    return port


def node_ports(node: Dict[str, Any], collections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Derived port list per node — twin of nodePorts in flowTypesV2.ts."""
    node_type = node.get("type")
    cfg = node.get("config") or {}

    if node_type == "request":
        request = find_request(collections, cfg.get("requestId") or "")
        inputs, outputs = [], []
        if request:
            inputs = [_port(data_in_handle(n), n, "data", "in") for n in scan_input_names(request)]
            outputs = [_port(data_out_handle(o), o, "data", "out") for o in request.get("outputs") or []]
        verify = cfg.get("verify") or {}
        checks = []
        passed = []
        if verify.get("enabled"):
            checks = [
                _port(
                    data_in_handle(verify_check_port_name(c.get("id") or "")),
                    verify_check_port_name(c.get("id") or ""),
                    "data",
                    "in",
                    label=f'expected: {c.get("path") or "?"}',
                )
                for c in verify.get("checks") or []
                if c.get("expectedSource") == "port"
            ]
            passed = [_port(data_out_handle("passed"), "passed", "data", "out", "boolean")]
        return _trigger_ports() + inputs + checks + outputs + passed

    if node_type == "delay":
        return _trigger_ports() + [
            _port(data_in_handle("value"), "value", "data", "in"),
            _port(data_out_handle("value"), "value", "data", "out"),
        ]

    if node_type == "arrayEmit":
        return _trigger_ports() + [
            _port(data_in_handle("array"), "array", "data", "in", "array"),
            _port(data_out_handle("item"), "item", "data", "out"),
            _port(data_out_handle("index"), "index", "data", "out", "number"),
        ]

    if node_type == "accumulator":
        return _trigger_ports() + [
            _port(data_in_handle("item"), "item", "data", "in"),
            _port(data_out_handle("array"), "array", "data", "out", "array"),
            _port(data_out_handle("count"), "count", "data", "out", "number"),
        ]

    if node_type == "demux":
        rows = cfg.get("rows") or []
        return _trigger_ports() + [
            _port(data_in_handle("object"), "object", "data", "in", "json"),
        ] + [
            _port(
                data_out_handle(demux_out_name(r.get("id") or "")),
                demux_out_name(r.get("id") or ""),
                "data",
                "out",
                label=r.get("path") or "(unset)",
            )
            for r in rows
        ]

    if node_type == "mux":
        rows = cfg.get("rows") or []
        return _trigger_ports() + [
            _port(
                data_in_handle(mux_in_name(r.get("id") or "")),
                mux_in_name(r.get("id") or ""),
                "data",
                "in",
                label=r.get("field") or "(unset)",
            )
            for r in rows
        ] + [_port(data_out_handle("object"), "object", "data", "out", "json")]

    if node_type == "duplicator":
        count = max(0, int(cfg.get("count") or 0))
        return _trigger_ports() + [
            _port(data_in_handle("value"), "value", "data", "in"),
        ] + [
            _port(data_out_handle(duplicator_out_name(i)), duplicator_out_name(i), "data", "out", label=f"out {i + 1}")
            for i in range(count)
        ]

    raise FlowRunError(f"Unknown node type: {node_type}")


def port_label(port: Dict[str, Any]) -> str:
    return port.get("label") or port.get("name") or ""


# ---- Validation --------------------------------------------------------------

def _topo_cycle(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> Optional[List[str]]:
    in_degree = {n["id"]: 0 for n in nodes}
    adjacency: Dict[str, List[str]] = {n["id"]: [] for n in nodes}
    for e in edges:
        if e.get("source") not in in_degree or e.get("target") not in in_degree:
            continue
        in_degree[e["target"]] += 1
        adjacency[e["source"]].append(e["target"])
    queue = [n["id"] for n in nodes if in_degree[n["id"]] == 0]
    seen: List[str] = []
    while queue:
        node_id = queue.pop(0)
        seen.append(node_id)
        for nxt in adjacency[node_id]:
            in_degree[nxt] -= 1
            if in_degree[nxt] == 0:
                queue.append(nxt)
    if len(seen) != len(nodes):
        seen_set = set(seen)
        return [n["name"] for n in nodes if n["id"] not in seen_set]
    return None


def validate_flow_v2(flow: Dict[str, Any], collections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Structural validation — twin of validateFlowV2. Returns issues as
    {level, message, nodeId?, edgeId?}; the runner refuses to start on any
    error-level issue."""
    issues: List[Dict[str, Any]] = []
    nodes: List[Dict[str, Any]] = flow.get("nodes") or []
    edges: List[Dict[str, Any]] = flow.get("edges") or []
    node_by_id = {n["id"]: n for n in nodes}

    def error(message: str, **where) -> None:
        issues.append({"level": "error", "message": message, **where})

    def warn(message: str, **where) -> None:
        issues.append({"level": "warning", "message": message, **where})

    unknown = [n for n in nodes if n.get("type") not in FLOW_NODE_TYPES_V2]
    for n in unknown:
        error(f'"{n.get("name")}" has an unsupported type "{n.get("type")}"', nodeId=n["id"])
    if unknown:
        return issues  # ports can't be derived; further checks would be noise

    ports_by_node = {n["id"]: node_ports(n, collections) for n in nodes}

    seen_names: set = set()
    for node in nodes:
        name = node.get("name")
        cfg = node.get("config") or {}
        if not name:
            error("A node has no name", nodeId=node["id"])
        elif name in seen_names:
            warn(f'Duplicate node name "{name}" — records will be ambiguous', nodeId=node["id"])
        else:
            seen_names.add(name)

        def connected_in(port_name: str) -> bool:
            return any(
                e.get("target") == node["id"] and e.get("targetHandle") == data_in_handle(port_name)
                for e in edges
            )

        node_type = node.get("type")
        if node_type == "request":
            request_id = cfg.get("requestId")
            if not request_id:
                error(f'"{name}" has no request selected', nodeId=node["id"])
            elif not find_request(collections, request_id):
                error(f'"{name}": linked request not found', nodeId=node["id"])
            verify = cfg.get("verify") or {}
            if verify.get("enabled"):
                if not (verify.get("checks") or []):
                    error(f'"{name}": verification is on but has no checks', nodeId=node["id"])
                if (verify.get("maxAttempts") or 0) < 1:
                    error(f'"{name}": max attempts must be at least 1', nodeId=node["id"])
                for c in verify.get("checks") or []:
                    if not (c.get("path") or "").strip():
                        error(f'"{name}": a check has no path', nodeId=node["id"])
                    if c.get("expectedSource") == "port" and not connected_in(
                        verify_check_port_name(c.get("id") or "")
                    ):
                        error(
                            f'"{name}": the expected-value port for "{c.get("path")}" is not connected',
                            nodeId=node["id"],
                        )
        elif node_type == "arrayEmit":
            if not connected_in("array"):
                ok, value, _ = parse_static_input(cfg.get("staticItems") or {"type": "json", "value": ""})
                if not ok or not isinstance(value, list):
                    error(f'"{name}": connect the array input or provide a static JSON array', nodeId=node["id"])
                elif len(value) > EMIT_MAX_ITEMS:
                    error(
                        f'"{name}" emits {len(value)} items, over the maximum of {EMIT_MAX_ITEMS}',
                        nodeId=node["id"],
                    )
        elif node_type == "demux":
            rows = cfg.get("rows") or []
            if not rows:
                error(f'"{name}" has no outputs configured', nodeId=node["id"])
            paths: set = set()
            for r in rows:
                path = (r.get("path") or "").strip()
                if not path:
                    error(f'"{name}" has an output with no path', nodeId=node["id"])
                elif path in paths:
                    warn(f'"{name}" extracts "{path}" more than once', nodeId=node["id"])
                paths.add(path)
        elif node_type == "mux":
            rows = cfg.get("rows") or []
            if len(rows) < 2:
                error(f'"{name}" needs at least two inputs', nodeId=node["id"])
            fields: set = set()
            for r in rows:
                field = (r.get("field") or "").strip()
                if not field:
                    error(f'"{name}" has an input with no field name', nodeId=node["id"])
                elif field in fields:
                    error(f'"{name}" uses the field name "{field}" twice', nodeId=node["id"])
                fields.add(field)
        elif node_type == "duplicator":
            count = cfg.get("count")
            if not isinstance(count, int) or count < DUPLICATOR_MIN_OUTPUTS or count > DUPLICATOR_MAX_OUTPUTS:
                error(
                    f'"{name}": outputs must be between {DUPLICATOR_MIN_OUTPUTS} and {DUPLICATOR_MAX_OUTPUTS}',
                    nodeId=node["id"],
                )

        for input_name, static_input in (cfg.get("staticInputs") or {}).items():
            if not (static_input or {}).get("value"):
                continue
            ok, _, err = parse_static_input(static_input)
            if not ok:
                error(f'"{name}": input "{input_name}" — {err}', nodeId=node["id"])

    per_target: Dict[str, int] = {}
    per_source: Dict[str, int] = {}
    for edge in edges:
        source = node_by_id.get(edge.get("source"))
        target = node_by_id.get(edge.get("target"))
        if not source or not target:
            error("A connection references a missing node", edgeId=edge.get("id"))
            continue

        src_parsed = parse_handle(edge.get("sourceHandle"))
        tgt_parsed = parse_handle(edge.get("targetHandle"))
        if not src_parsed or src_parsed["direction"] != "out" or not tgt_parsed or tgt_parsed["direction"] != "in":
            error(
                f'Connection "{source["name"]}" → "{target["name"]}" has malformed ports',
                edgeId=edge.get("id"),
            )
            continue
        if src_parsed["kind"] != tgt_parsed["kind"]:
            error(
                f'Connection "{source["name"]}" → "{target["name"]}" joins a {src_parsed["kind"]} port '
                f'to a {tgt_parsed["kind"]} port',
                edgeId=edge.get("id"),
            )
            continue

        src_port = next((p for p in ports_by_node[source["id"]] if p["id"] == edge.get("sourceHandle")), None)
        tgt_port = next((p for p in ports_by_node[target["id"]] if p["id"] == edge.get("targetHandle")), None)
        if not src_port:
            error(
                f'"{source["name"]}" has a connection from a missing port "{edge.get("sourceHandle")}" '
                "— the saved request may have changed",
                edgeId=edge.get("id"),
            )
        if not tgt_port:
            error(
                f'"{target["name"]}" has a connection into a missing port "{edge.get("targetHandle")}" '
                "— the saved request may have changed",
                edgeId=edge.get("id"),
            )
        if not src_port or not tgt_port:
            continue

        if src_parsed["kind"] == "data":
            tgt_key = f'{edge.get("target")} {edge.get("targetHandle")}'
            per_target[tgt_key] = per_target.get(tgt_key, 0) + 1
            if per_target[tgt_key] == 2:
                error(
                    f'Input "{port_label(tgt_port)}" of "{target["name"]}" has more than one connection',
                    edgeId=edge.get("id"),
                )
            src_key = f'{edge.get("source")} {edge.get("sourceHandle")}'
            per_source[src_key] = per_source.get(src_key, 0) + 1
            if per_source[src_key] == 2:
                error(
                    f'Output "{port_label(src_port)}" of "{source["name"]}" feeds more than one input '
                    "— add a Duplicator to fan out",
                    edgeId=edge.get("id"),
                )

    cycle = _topo_cycle(nodes, edges)
    if cycle:
        error(f"Flow contains a cycle involving: {', '.join(cycle)}")

    return issues


def flow_errors_v2(issues: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [i for i in issues if i.get("level") == "error"]


# ---- Stream primitives -------------------------------------------------------

class _Channel:
    """Unbounded FIFO for one data connection. Unbounded is deliberate: a
    done→after barrier alongside a data edge needs the whole upstream stream
    buffered, so a bounded queue could deadlock."""

    def __init__(self):
        self.queue: asyncio.Queue = asyncio.Queue()

    def push(self, msg: Dict[str, Any]) -> None:
        self.queue.put_nowait(msg)

    async def next(self, state: _RunState) -> Dict[str, Any]:
        if state.cancelled:
            raise FlowCancelledError()
        getter = asyncio.ensure_future(self.queue.get())
        waiter = asyncio.ensure_future(state.cancel_event.wait())
        done, pending = await asyncio.wait({getter, waiter}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        if getter in done:
            return getter.result()
        raise FlowCancelledError()


def _item(index: int, value: Any) -> Dict[str, Any]:
    return {"kind": "item", "index": index, "value": value}


def _hole(index: int, node: Dict[str, Any], error: str) -> Dict[str, Any]:
    return {
        "kind": "hole",
        "index": index,
        "originNodeId": node["id"],
        "originNodeName": node["name"],
        "error": error,
    }


def _is_value(msg: Dict[str, Any]) -> bool:
    return msg.get("kind") in ("item", "hole")


class _Joiner:
    """Pairs a node's connected inputs positionally, latching any input whose
    stream turns out to be a single value — twin of Joiner in streamV2.ts."""

    def __init__(self, channels: Dict[str, _Channel]):
        self.inputs = [
            {"name": name, "channel": channels[name], "first": None, "latched": None, "ended_at": None}
            for name in sorted(channels)
        ]
        self.index = 0

    @property
    def input_count(self) -> int:
        return len(self.inputs)

    async def next(self, state: _RunState) -> Dict[str, Any]:
        i = self.index
        values: Dict[str, Dict[str, Any]] = {}
        fresh_drivers = 0
        exhausted = 0

        for src in self.inputs:
            if src["latched"] is not None:
                values[src["name"]] = src["latched"]
                continue
            if src["ended_at"] is not None:
                exhausted += 1
                continue

            msg = await src["channel"].next(state)
            if msg.get("kind") == "abort":
                src["ended_at"] = i
                return {"kind": "abort", "reason": msg.get("reason")}
            if _is_value(msg):
                if src["first"] is None:
                    src["first"] = msg
                values[src["name"]] = msg
                fresh_drivers += 1
                continue
            src["ended_at"] = msg.get("count", 0)
            if msg.get("count") == 1 and src["first"] is not None:
                src["latched"] = src["first"]
                values[src["name"]] = src["latched"]
            else:
                exhausted += 1

        if exhausted > 0 and fresh_drivers > 0:
            ended = next(s for s in self.inputs if s["ended_at"] is not None and s["latched"] is None)
            producing = next(s for s in self.inputs if s["name"] in values and s["latched"] is None)
            plural = "" if ended["ended_at"] == 1 else "s"
            return {
                "kind": "mismatch",
                "message": (
                    f'Input "{ended["name"]}" ended after {ended["ended_at"]} item{plural} '
                    f'but "{producing["name"]}" is still producing (position {i})'
                ),
            }
        if fresh_drivers == 0:
            return {"kind": "end", "count": i}

        self.index += 1
        return {"kind": "tuple", "index": i, "values": values}


def _first_hole(values: Dict[str, Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for name in sorted(values):
        if values[name].get("kind") == "hole":
            return values[name]
    return None


# ---- Run ---------------------------------------------------------------------

async def run_flow(
    flow: Dict[str, Any],
    *,
    environment_id: Optional[str],
    collections: List[Dict[str, Any]],
    executor: Optional[ExecutorFn] = None,
    get_pref: Optional[Callable[[str], Optional[str]]] = None,
    timeout_seconds: float = 600,
    on_record: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """Run a V2 streaming flow; same signature and summary shape as the V1
    run_flow so MCP dispatches by schemaVersion. Raises FlowRunError on an
    invalid graph. Retry/resume is a V1-only feature."""
    if executor is None:
        from services.executor import execute_request as executor  # noqa: F811
    if get_pref is None:
        from db.local_store import LocalStore
        get_pref = LocalStore.get_pref

    errors = flow_errors_v2(validate_flow_v2(flow, collections))
    if errors:
        raise FlowRunError("; ".join(i["message"] for i in errors))

    nodes: List[Dict[str, Any]] = flow.get("nodes") or []
    edges: List[Dict[str, Any]] = flow.get("edges") or []

    state = _RunState()
    started_at = _iso_now()
    run_start = _now_ms()
    records: List[Dict[str, Any]] = []
    node_statuses: Dict[str, str] = {}
    node_item_counts: Dict[str, Dict[str, int]] = {}

    def emit(record: Dict[str, Any]) -> None:
        records.append(record)
        if on_record:
            on_record(record)

    def set_status(node_id: str, status: str) -> None:
        if status in ("success", "failed", "skipped", "partial"):
            node_statuses[node_id] = status

    data_edges = [e for e in edges if edge_kind(e) == "data"]
    trigger_edges = [e for e in edges if edge_kind(e) == "trigger"]
    channels: Dict[str, _Channel] = {e["id"]: _Channel() for e in data_edges}

    # Trigger gates: a node starts once every incoming `after` connection fires;
    # a failed or skipped upstream releases the gate as "skip" so nothing hangs.
    gates: Dict[str, Dict[str, Any]] = {}
    for node in nodes:
        remaining = len([e for e in trigger_edges if e.get("target") == node["id"]])
        gates[node["id"]] = {
            "remaining": remaining,
            "skip_reason": None,
            "event": asyncio.Event(),
        }
        if remaining == 0:
            gates[node["id"]]["event"].set()

    def fire_done(node_id: str) -> None:
        for e in trigger_edges:
            if e.get("source") != node_id:
                continue
            gate = gates.get(e.get("target"))
            if not gate or gate["event"].is_set():
                continue
            gate["remaining"] -= 1
            if gate["remaining"] <= 0:
                gate["event"].set()

    def fail_done(node_id: str, reason: str) -> None:
        for e in trigger_edges:
            if e.get("source") != node_id:
                continue
            gate = gates.get(e.get("target"))
            if not gate or gate["event"].is_set():
                continue
            gate["skip_reason"] = reason
            gate["event"].set()

    def input_channels_of(node_id: str) -> Dict[str, _Channel]:
        result: Dict[str, _Channel] = {}
        for e in data_edges:
            if e.get("target") != node_id:
                continue
            parsed = parse_handle(e.get("targetHandle"))
            if parsed and parsed["kind"] == "data":
                result[parsed["name"]] = channels[e["id"]]
        return result

    def output_edges_of(node_id: str) -> Dict[str, Dict[str, Any]]:
        result: Dict[str, Dict[str, Any]] = {}
        for e in data_edges:
            if e.get("source") != node_id:
                continue
            parsed = parse_handle(e.get("sourceHandle"))
            if parsed and parsed["kind"] == "data":
                result[parsed["name"]] = e  # one edge per output (validated)
        return result

    async def run_node(node: Dict[str, Any]) -> None:
        counts = {"ok": 0, "failed": 0, "skipped": 0}
        node_item_counts[node["id"]] = counts
        node_started_at = _iso_now()
        node_start = _now_ms()
        cfg = node.get("config") or {}
        node_type = node["type"]

        out_edges = output_edges_of(node["id"])
        out_counters: Dict[str, int] = {}

        def push_msg(port_name: str, build) -> None:
            edge = out_edges.get(port_name)
            if edge is None:
                return
            index = out_counters.get(port_name, 0)
            out_counters[port_name] = index + 1
            msg = build(index)
            if msg.get("kind") == "item" and edge.get("path"):
                found, value, _ = eval_json_path(edge["path"], msg["value"])
                channels[edge["id"]].push(
                    _item(index, value)
                    if found
                    else _hole(index, node, f'Connection path "{edge["path"]}" matched nothing')
                )
                return
            channels[edge["id"]].push(msg)

        def push_item(port_name: str, value: Any) -> None:
            push_msg(port_name, lambda i: _item(i, value))

        def push_hole(port_name: str, error: str, origin: Optional[Dict[str, Any]] = None) -> None:
            push_msg(port_name, lambda i: {**origin, "index": i} if origin else _hole(i, node, error))

        def close_all() -> None:
            for port_name, edge in out_edges.items():
                channels[edge["id"]].push({"kind": "eos", "count": out_counters.get(port_name, 0)})

        def abort_all(reason: str) -> None:
            for edge in out_edges.values():
                channels[edge["id"]].push({"kind": "abort", "reason": reason})

        gate = gates[node["id"]]
        await gate["event"].wait()
        if gate["skip_reason"] or state.cancelled:
            reason = gate["skip_reason"] or "Skipped: run cancelled"
            set_status(node["id"], "skipped")
            emit(_make_record(node, None, "skipped", node_started_at, 0, error=reason))
            abort_all(reason)
            fail_done(node["id"], reason)
            return

        joiner = _Joiner(input_channels_of(node["id"]))

        def finish_ok(summary_extra: Optional[Dict[str, Any]] = None) -> None:
            close_all()
            set_status(node["id"], "partial" if counts["failed"] else "success")
            if summary_extra is not None:
                emit(_make_record(
                    node, None,
                    "failed" if counts["failed"] else "success",
                    node_started_at, _now_ms() - node_start, **summary_extra,
                ))
            fire_done(node["id"])

        def finish_hard(message: str) -> None:
            set_status(node["id"], "failed")
            emit(_make_record(node, None, "failed", node_started_at, _now_ms() - node_start, error=message))
            abort_all(message)
            fail_done(node["id"], f'Skipped: upstream "{node["name"]}" failed')

        def finish_skipped(reason: str) -> None:
            set_status(node["id"], "skipped")
            emit(_make_record(node, None, "skipped", node_started_at, 0, error=reason))
            abort_all(reason)
            fail_done(node["id"], reason)

        def static_value(name: str) -> Tuple[bool, Any]:
            entry = (cfg.get("staticInputs") or {}).get(name)
            if not entry or entry.get("value") == "":
                return False, None
            ok, value, _ = parse_static_input(entry)
            return ok, value

        def expected_for(check: Dict[str, Any], values: Dict[str, Dict[str, Any]]) -> Any:
            if check.get("expectedSource") != "port":
                return check.get("expected")
            msg = values.get(verify_check_port_name(check.get("id") or ""))
            return msg["value"] if msg and msg.get("kind") == "item" else None

        async def run_request_item(index: int, values: Dict[str, Dict[str, Any]]) -> Tuple[bool, Dict[str, Any]]:
            request = find_request(collections, cfg.get("requestId") or "")
            bindings: Dict[str, Dict[str, Any]] = {}
            for b in request.get("inputs") or []:
                bindings[b.get("name")] = b
            resolved_inputs: Dict[str, str] = {}

            for name in (cfg.get("staticInputs") or {}):
                present, value = static_value(name)
                if not present:
                    continue
                text = stringify_value(value)
                bindings[name] = {"name": name, "source": "literal", "value": text}
                resolved_inputs[name] = text
            for name, msg in values.items():
                if name.startswith("cmp:") or msg.get("kind") != "item":
                    continue
                text = stringify_value(msg["value"])
                bindings[name] = {"name": name, "source": "literal", "value": text}
                resolved_inputs[name] = text

            verify = cfg.get("verify") if (cfg.get("verify") or {}).get("enabled") else None
            max_attempts = max(1, (verify or {}).get("maxAttempts") or 1) if verify else 1
            last_exec: Optional[Dict[str, Any]] = None

            for attempt in range(1, max_attempts + 1):
                attempt_started_at = _iso_now()
                attempt_start = _now_ms()
                exec_result = await execute_resolved_request(
                    request, bindings, resolved_inputs, environment_id, executor, get_pref, state
                )
                last_exec = exec_result

                error = exec_result.get("error")
                passed = True
                if verify and exec_result.get("response"):
                    target = verify_target(exec_result)
                    details = []
                    for check in verify.get("checks") or []:
                        found, actual, _ = eval_json_path(check.get("path") or "", target)
                        expected = expected_for(check, values)
                        operator = check.get("operator")
                        ok = compare_values(operator, actual, expected) if found else operator == "not_equals"
                        if not ok:
                            passed = False
                        expected_part = "" if operator == "exists" else f" {json.dumps(_js_str(expected))}"
                        actual_part = stringify_value(actual) if found else "<missing>"
                        details.append(
                            f'{check.get("path")} {operator}{expected_part} — actual: {actual_part} '
                            f'{"✓" if ok else "✗"}'
                        )
                    error = None if passed else f"Verification failed: {'; '.join(details)}"
                elif verify and not exec_result.get("response"):
                    passed = False

                attempt_ok = bool(exec_result.get("ok")) and passed
                extra = {"iteration": index}
                if verify:
                    extra["attempt"] = attempt
                emit(_make_record(
                    node, {**exec_result, "error": error},
                    "success" if attempt_ok else "failed",
                    attempt_started_at, _now_ms() - attempt_start, **extra,
                ))
                if attempt_ok:
                    return True, exec_result.get("outputs") or {}
                if attempt < max_attempts:
                    await _cancellable_delay(max(0, (verify or {}).get("intervalMs") or 0), state)
            return False, (last_exec or {}).get("outputs") or {}

        try:
            unit_only = joiner.input_count == 0
            index = 0
            accumulated: List[Any] = []
            dropped = 0
            emitted = 0

            while True:
                if state.cancelled:
                    raise FlowCancelledError()

                values: Dict[str, Dict[str, Any]] = {}
                if unit_only:
                    if index > 0:
                        break
                else:
                    res = await joiner.next(state)
                    if res["kind"] == "end":
                        break
                    if res["kind"] == "mismatch":
                        return finish_hard(res["message"])
                    if res["kind"] == "abort":
                        return finish_skipped(f'Skipped: {res["reason"]}')
                    values = res["values"]

                incoming_hole = _first_hole(values)

                if node_type == "request":
                    if incoming_hole:
                        counts["skipped"] += 1
                        emit(_make_record(
                            node, None, "skipped", _iso_now(), 0,
                            iteration=index,
                            error=f'Skipped: item failed upstream in "{incoming_hole["originNodeName"]}"',
                        ))
                        for port in out_edges:
                            push_hole(port, "", incoming_hole)
                    else:
                        ok, outputs = await run_request_item(index, values)
                        if ok:
                            counts["ok"] += 1
                            for port in out_edges:
                                push_item(port, True if port == "passed" else outputs.get(port))
                        else:
                            counts["failed"] += 1
                            for port in out_edges:
                                push_hole(port, f'Item {index} failed in "{node["name"]}"')

                elif node_type == "delay":
                    if incoming_hole:
                        counts["skipped"] += 1
                        push_hole("value", "", incoming_hole)
                    else:
                        await _cancellable_delay(max(0, cfg.get("ms") or 0), state)
                        counts["ok"] += 1
                        value = values.get("value")
                        if value and value.get("kind") == "item":
                            push_item("value", value["value"])

                elif node_type == "arrayEmit":
                    if incoming_hole:
                        counts["skipped"] += 1
                        push_hole("item", "", incoming_hole)
                        push_hole("index", "", incoming_hole)
                    else:
                        src = values.get("array")
                        if src and src.get("kind") == "item":
                            raw = src["value"]
                        else:
                            ok, raw, _ = parse_static_input(cfg.get("staticItems") or {"type": "json", "value": "[]"})
                            raw = raw if ok else None
                        if isinstance(raw, str):
                            try:
                                raw = json.loads(raw)
                            except Exception:
                                pass
                        if not isinstance(raw, list):
                            counts["failed"] += 1
                            emit(_make_record(
                                node, None, "failed", _iso_now(), 0,
                                iteration=index, error="Input is not an array",
                            ))
                            push_hole("item", "Input is not an array")
                            push_hole("index", "Input is not an array")
                        elif emitted + len(raw) > EMIT_MAX_ITEMS:
                            return finish_hard(
                                f"Emitting {emitted + len(raw)} items exceeds the maximum of {EMIT_MAX_ITEMS}"
                            )
                        else:
                            for k, element in enumerate(raw):
                                push_item("item", element)
                                push_item("index", emitted + k)
                            emitted += len(raw)
                            counts["ok"] += 1

                elif node_type == "accumulator":
                    value = values.get("item")
                    if incoming_hole:
                        dropped += 1
                        counts["skipped"] += 1
                    elif value and value.get("kind") == "item":
                        accumulated.append(value["value"])
                        counts["ok"] += 1

                elif node_type == "demux":
                    rows = cfg.get("rows") or []
                    if incoming_hole:
                        counts["skipped"] += 1
                        for r in rows:
                            push_hole(demux_out_name(r.get("id") or ""), "", incoming_hole)
                    else:
                        value = values.get("object")
                        source = value["value"] if value and value.get("kind") == "item" else static_value("object")[1]
                        any_miss = False
                        for r in rows:
                            found, extracted, _ = eval_json_path(r.get("path") or "", source)
                            if found:
                                push_item(demux_out_name(r.get("id") or ""), extracted)
                            else:
                                any_miss = True
                                message = f'Path "{r.get("path")}" matched nothing'
                                push_hole(demux_out_name(r.get("id") or ""), message)
                                emit(_make_record(
                                    node, None, "failed", _iso_now(), 0, iteration=index, error=message,
                                ))
                        counts["failed" if any_miss else "ok"] += 1

                elif node_type == "mux":
                    rows = cfg.get("rows") or []
                    if incoming_hole:
                        counts["skipped"] += 1
                        push_hole("object", "", incoming_hole)
                    else:
                        obj: Dict[str, Any] = {}
                        for r in rows:
                            msg = values.get(mux_in_name(r.get("id") or ""))
                            if msg and msg.get("kind") == "item":
                                obj[r.get("field")] = msg["value"]
                            else:
                                present, value = static_value(mux_in_name(r.get("id") or ""))
                                if present:
                                    obj[r.get("field")] = value
                        counts["ok"] += 1
                        push_item("object", obj)

                elif node_type == "duplicator":
                    count = cfg.get("count") or 0
                    value = values.get("value")
                    for k in range(count):
                        if incoming_hole:
                            push_hole(duplicator_out_name(k), "", incoming_hole)
                        elif value and value.get("kind") == "item":
                            push_item(duplicator_out_name(k), value["value"])
                    counts["skipped" if incoming_hole else "ok"] += 1

                index += 1

            if node_type == "accumulator":
                push_item("array", accumulated)
                push_item("count", len(accumulated))
                finish_ok({"outputs": {"items": accumulated, "count": len(accumulated), "dropped": dropped}})
            elif node_type == "request":
                finish_ok(None)  # per-item records already emitted
            elif node_type == "arrayEmit":
                finish_ok({"outputs": {"emitted": emitted}})
            else:
                finish_ok({"outputs": {"items": counts["ok"] + counts["failed"] + counts["skipped"]}})

        except FlowCancelledError:
            set_status(node["id"], "failed")
            emit(_make_record(node, None, "failed", node_started_at, _now_ms() - node_start, error="Run cancelled"))
            abort_all("Run cancelled")
            fail_done(node["id"], "Skipped: run cancelled")
        except Exception as e:  # noqa: BLE001 — a node failure must not kill the run
            finish_hard(str(e) or repr(e))

    watchdog = None
    if timeout_seconds and timeout_seconds > 0:
        async def timeout_watchdog():
            await asyncio.sleep(timeout_seconds)
            state.cancel(timeout=True)

        watchdog = asyncio.create_task(timeout_watchdog())

    try:
        await asyncio.gather(*(run_node(node) for node in nodes))
    finally:
        if watchdog:
            watchdog.cancel()

    failed = any(s in ("failed", "partial") for s in node_statuses.values())
    summary = {
        "status": "cancelled" if state.cancelled else ("failed" if failed else "success"),
        "records": records,
        "startedAt": started_at,
        "durationMs": int(_now_ms() - run_start),
        "nodeStatuses": node_statuses,
        "nodeItemCounts": node_item_counts,
    }
    if state.timeout_hit:
        summary["timeoutHit"] = True
    return summary
