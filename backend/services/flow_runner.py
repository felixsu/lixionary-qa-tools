"""Headless API Studio flow runner.

Python port of the client-side orchestrator in
frontend/src/app/utils/flowRunner.ts — keep the two in sync. The frontend
copy remains the runner for interactive UI runs; this one serves headless
callers (the MCP tools in backend/mcp_server.py), executing requests
in-process via services.executor.execute_request instead of HTTP calls to
/api/executor/run.

Semantics mirror the TS runner: the graph is scheduled as a parallel
wavefront — every root (in-degree 0) node starts immediately, all outgoing
edges fan out concurrently, and a node with multiple incoming edges waits
until every predecessor has succeeded (implicit merge). A failure skips only
the failed node's descendants; independent branches run to completion.
Resume/retry (ResumeState, mergeRetrySummary, structuralSignature) is
deliberately not ported — headless runs always start fresh.
"""

import asyncio
import json
import math
import re
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple


class FlowRunError(Exception):
    """Invalid flow shape (e.g. the graph contains a cycle)."""


class FlowCancelledError(Exception):
    def __init__(self):
        super().__init__("Run cancelled")


# JS `undefined` stand-in: distinct from None, which is a legitimate JSON
# null value that references and comparisons must be able to observe.
class _MissingType:
    def __repr__(self):
        return "<missing>"

    def __bool__(self):
        return False


MISSING = _MissingType()

_TOKEN_RE = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")

# execute_request-compatible callable: (request_payload, environment_id) -> result dict
ExecutorFn = Callable[[Dict[str, Any], Optional[str]], Awaitable[Dict[str, Any]]]


def _iso_now() -> str:
    # JS Date.toISOString() shape (millisecond precision, Z suffix) so records
    # sort and render identically to UI-produced ones.
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _now_ms() -> float:
    return asyncio.get_event_loop().time() * 1000


# ---- JS coercion shims -------------------------------------------------------
# The TS runner leans on String()/Number() semantics in comparisons and value
# stringification; these approximate them for the value shapes that actually
# occur here (JSON-derived data).

def _js_str(value: Any) -> str:
    if value is MISSING:
        return "undefined"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return str(int(value)) if math.isfinite(value) and value.is_integer() else str(value)
    if isinstance(value, list):
        # JS Array.prototype.toString: elements joined by ",", null/undefined empty
        return ",".join("" if el is None or el is MISSING else _js_str(el) for el in value)
    if isinstance(value, dict):
        return "[object Object]"
    return str(value)


def _js_number(value: Any) -> Optional[float]:
    """Number(value); None result stands for NaN."""
    if value is MISSING:
        return None
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None
    if isinstance(value, str):
        s = value.strip()
        if s == "":
            return 0.0
        try:
            return float(s)
        except ValueError:
            return None
    return None


def stringify_value(value: Any) -> str:
    if value is None or value is MISSING:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, separators=(",", ":"))
    return _js_str(value)


# ---- Graph + reference utilities ---------------------------------------------

def topo_cycle(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> Optional[List[str]]:
    """Kahn's algorithm; returns the names of nodes on a cycle, or None."""
    in_degree = {n["id"]: 0 for n in nodes}
    adjacency: Dict[str, List[str]] = {n["id"]: [] for n in nodes}
    for e in edges:
        if e.get("source") not in in_degree or e.get("target") not in in_degree:
            continue  # dangling edge
        in_degree[e["target"]] += 1
        adjacency[e["source"]].append(e["target"])
    queue = [n["id"] for n in nodes if in_degree[n["id"]] == 0]
    order: List[str] = []
    while queue:
        node_id = queue.pop(0)
        order.append(node_id)
        for nxt in adjacency[node_id]:
            in_degree[nxt] -= 1
            if in_degree[nxt] == 0:
                queue.append(nxt)
    if len(order) != len(nodes):
        ordered = set(order)
        return [n["name"] for n in nodes if n["id"] not in ordered]
    return None


def walk_path(root: Any, segments: List[str]) -> Any:
    """Dot-path walk; "*" projects over an array (unresolved elements dropped,
    JSONPath-style, wildcards nest). JSON-string leaves are transparently
    parsed so paths can continue into them. Returns MISSING when unresolved."""
    cur = root
    for i, seg in enumerate(segments):
        if cur is None or cur is MISSING:
            return MISSING
        if isinstance(cur, str):
            try:
                cur = json.loads(cur)
            except Exception:
                return MISSING
        if seg == "*":
            if not isinstance(cur, list):
                return MISSING
            rest = segments[i + 1:]
            projected = [walk_path(el, rest) if rest else el for el in cur]
            return [v for v in projected if v is not MISSING]
        if isinstance(cur, dict):
            cur = cur.get(seg, MISSING)
        elif isinstance(cur, list):
            try:
                idx = int(seg)
                cur = cur[idx] if 0 <= idx < len(cur) else MISSING
            except ValueError:
                return MISSING
        else:
            return MISSING
    return cur


def resolve_reference(reference: str, ctx: Dict[str, Any], iteration_item: Any = MISSING) -> Tuple[bool, Any]:
    segments = [s.strip() for s in reference.split(".") if s.strip()]
    if not segments:
        return False, MISSING
    head, rest = segments[0], segments[1:]
    if head == "item":
        if iteration_item is MISSING:
            return False, MISSING
        root = iteration_item
    elif head in ctx:
        root = ctx[head]
    else:
        return False, MISSING
    value = walk_path(root, rest) if rest else root
    return value is not MISSING, value


def interpolate_studio_tokens(text: str, ctx: Dict[str, Any], iteration_item: Any = MISSING) -> str:
    """Replace {{node.path}} / {{item.path}} tokens in static values. Tokens
    whose first segment is not a known node name (or "item") — e.g. {{env.X}},
    {{$date}}, plain request inputs — are left for the executor."""
    if not text:
        return text

    def repl(match: "re.Match[str]") -> str:
        key = match.group(1)
        if key.startswith("$") or key.startswith("env."):
            return match.group(0)
        head = key.split(".")[0].strip()
        if head != "item" and head not in ctx:
            return match.group(0)
        found, value = resolve_reference(key, ctx, iteration_item)
        return stringify_value(value) if found else match.group(0)

    return _TOKEN_RE.sub(repl, text)


def find_request(collections: List[Dict[str, Any]], request_id: str) -> Optional[Dict[str, Any]]:
    """Locate a RequestItem by id across collection payload trees (requests +
    nested children) — Python twin of findRequestInTree in AppContext.tsx."""
    if not request_id:
        return None

    def search(col: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        for req in col.get("requests") or []:
            if req.get("id") == request_id:
                return req
        for child in col.get("children") or []:
            found = search(child)
            if found:
                return found
        return None

    for collection in collections:
        found = search(collection)
        if found:
            return found
    return None


# ---- Execution ----------------------------------------------------------------

class _RunState:
    def __init__(self):
        self.cancelled = False
        self.timeout_hit = False
        self.cancel_event = asyncio.Event()

    def cancel(self, *, timeout: bool = False):
        if self.cancelled:
            return
        self.cancelled = True
        self.timeout_hit = self.timeout_hit or timeout
        self.cancel_event.set()


async def _cancellable_delay(ms: float, state: _RunState) -> None:
    if state.cancelled:
        raise FlowCancelledError()
    try:
        await asyncio.wait_for(state.cancel_event.wait(), timeout=max(0.0, ms) / 1000)
    except asyncio.TimeoutError:
        return  # slept the full duration
    raise FlowCancelledError()


def _execution_result(**overrides) -> Dict[str, Any]:
    base = {
        "ok": False,
        "error": None,
        "resolvedInputs": {},
        "requestPayload": None,
        "response": None,
        "outputs": {},
        "raw": None,
    }
    base.update(overrides)
    return base


async def execute_resolved_request(
    request: Dict[str, Any],
    bindings: Dict[str, Dict[str, Any]],
    resolved_inputs: Dict[str, str],
    environment_id: Optional[str],
    executor: ExecutorFn,
    get_pref: Callable[[str], Optional[str]],
    state: _RunState,
) -> Dict[str, Any]:
    """Run a saved request once via the executor with fully-resolved input
    bindings. Shared by the V1 mapping resolver below and the V2 port-based
    engine (flow_runner_v2.py) — TS twin: executeResolvedRequest."""
    # Auth parity with the API Explorer: HOOK auth bindings are device-local
    # prefs, same override the TS runner applies (flowRunner.ts).
    auth_type = request.get("authType")
    auth_config = request.get("authConfig") or {}
    try:
        raw_override = get_pref(f"auth_override:{request['id']}")
        if raw_override:
            parsed = json.loads(raw_override)
            auth_type = parsed.get("authType", auth_type)
            auth_config = parsed.get("authConfig", auth_config)
    except Exception:
        pass  # pref unavailable / malformed override — fall back to saved values

    auth_config = auth_config or {}
    payload = {
        "requestId": request.get("id"),
        "method": request.get("method"),
        "url": request.get("url"),
        "headers": [h for h in (request.get("headers") or []) if h.get("key") != ""],
        "queryParams": [p for p in (request.get("queryParams") or []) if p.get("key") != ""],
        "bodyType": request.get("bodyType"),
        "body": request.get("body"),
        "authType": auth_type,
        "authConfig": {
            "token": auth_config.get("token"),
            "key": auth_config.get("key"),
            "value": auth_config.get("value"),
            "authFunctionId": auth_config.get("authFunctionId"),
            "tokenField": auth_config.get("tokenField"),
        },
        "responseParserScript": request.get("responseParserScript") or "",
        "requestInterceptorScript": request.get("requestInterceptorScript") or "",
        "testScript": request.get("testScript") or "",
        "inputs": list(bindings.values()),
        "outputs": request.get("outputs") or [],
        "environmentId": environment_id,
    }

    try:
        result = await executor(payload, environment_id)
    except Exception as e:  # auth-hook/interceptor failures raise from execute_request
        if state.cancelled:
            raise FlowCancelledError()
        return _execution_result(
            resolvedInputs=resolved_inputs,
            requestPayload=payload,
            error=str(e) or "Request failed",
        )
    if state.cancelled:
        raise FlowCancelledError()

    response = {
        "status": result.get("status"),
        "statusText": result.get("statusText"),
        "headers": result.get("headers") or {},
        "body": result.get("body"),
    }
    outputs = result.get("outputs") or {}
    missing = result.get("missingOutputs") or []

    error = None
    if (result.get("status") or 0) >= 400:
        error = f"HTTP {result['status']} {result.get('statusText') or ''}".strip()
    elif result.get("parserError"):
        error = f"Parser error: {result['parserError']}"
    elif missing:
        error = f"Missing declared outputs: {', '.join(missing)}"

    return _execution_result(
        ok=not error,
        error=error,
        resolvedInputs=resolved_inputs,
        requestPayload=payload,
        response=response,
        outputs=outputs,
        raw=result,
    )


async def _execute_request_config(
    cfg: Dict[str, Any],
    ctx: Dict[str, Any],
    collections: List[Dict[str, Any]],
    environment_id: Optional[str],
    executor: ExecutorFn,
    get_pref: Callable[[str], Optional[str]],
    state: _RunState,
    iteration_item: Any = MISSING,
) -> Dict[str, Any]:
    """Resolve mappings + run the linked request once via the executor."""
    request = find_request(collections, cfg.get("requestId"))
    if not request:
        return _execution_result(
            error="Linked request not found" if cfg.get("requestId") else "No request selected"
        )

    # Start from the request's own stored bindings; flow mappings override.
    bindings: Dict[str, Dict[str, Any]] = {}
    for b in request.get("inputs") or []:
        bindings[b.get("name")] = b

    resolved_inputs: Dict[str, str] = {}
    for mapping in cfg.get("mappings") or []:
        input_name = mapping.get("inputName")
        if not input_name:
            continue
        if mapping.get("source") == "reference":
            found, ref_value = resolve_reference(mapping.get("value", ""), ctx, iteration_item)
            if not found:
                return _execution_result(
                    error=f'Reference "{mapping.get("value")}" not found for input "{input_name}"'
                )
            value = stringify_value(ref_value)
        else:
            value = interpolate_studio_tokens(mapping.get("value", ""), ctx, iteration_item)
        bindings[input_name] = {"name": input_name, "source": "literal", "value": value}
        resolved_inputs[input_name] = value

    return await execute_resolved_request(
        request, bindings, resolved_inputs, environment_id, executor, get_pref, state
    )


def _make_record(
    node: Dict[str, Any],
    exec_result: Optional[Dict[str, Any]],
    status: str,
    started_at: str,
    duration_ms: float,
    **extra,
) -> Dict[str, Any]:
    raw = (exec_result or {}).get("raw") or {}
    record = {
        "nodeId": node["id"],
        "nodeName": node["name"],
        "nodeType": node["type"],
        "status": status,
        "resolvedInputs": (exec_result or {}).get("resolvedInputs") or {},
        "outputs": exec_result.get("outputs") if exec_result else None,
        "requestPayload": (exec_result or {}).get("requestPayload"),
        "response": (exec_result or {}).get("response"),
        "testResults": raw.get("testResults"),
        "testError": raw.get("testError"),
        "error": (exec_result or {}).get("error"),
        "startedAt": started_at,
        "durationMs": int(duration_ms),
    }
    record.update(extra)
    return record


def evaluate_comparison(
    comparison: Dict[str, Any],
    exec_result: Dict[str, Any],
    ctx: Dict[str, Any],
) -> Tuple[bool, Any, str]:
    segments = [s.strip() for s in (comparison.get("field") or "").split(".") if s.strip()]
    response = exec_result.get("response") or {}
    if segments and segments[0] == "status":
        actual = response.get("status", MISSING)
    elif segments and segments[0] == "body":
        actual = walk_path(response.get("body", MISSING), segments[1:])
    elif segments and segments[0] == "outputs":
        actual = walk_path(exec_result.get("outputs"), segments[1:])
    else:
        actual = walk_path(exec_result.get("outputs"), segments)

    expected = comparison.get("expected")
    if comparison.get("expectedSource") == "reference":
        found, resolved = resolve_reference(comparison.get("expected") or "", ctx)
        expected = resolved if found else MISSING

    both_numeric = (
        actual is not None
        and actual is not MISSING
        and actual != ""
        and _js_number(actual) is not None
        and _js_number(expected) is not None
    )

    operator = comparison.get("operator")
    if operator == "exists":
        passed = actual is not MISSING and actual is not None
    elif operator == "equals":
        passed = _js_number(actual) == _js_number(expected) if both_numeric else _js_str(actual) == _js_str(expected)
    elif operator == "not_equals":
        passed = _js_number(actual) != _js_number(expected) if both_numeric else _js_str(actual) != _js_str(expected)
    elif operator == "contains":
        if isinstance(actual, list):
            passed = any(_js_str(v) == _js_str(expected) for v in actual)
        else:
            haystack = "" if actual is None or actual is MISSING else _js_str(actual)
            needle = "" if expected is None or expected is MISSING else _js_str(expected)
            passed = needle in haystack
    elif operator == "greater_than":
        passed = both_numeric and _js_number(actual) > _js_number(expected)
    elif operator == "less_than":
        passed = both_numeric and _js_number(actual) < _js_number(expected)
    else:
        passed = False

    expected_part = "" if operator == "exists" else json.dumps(_js_str(expected))
    detail = (
        f"{comparison.get('field')} {operator} {expected_part} — "
        f"actual: {stringify_value(actual) or '<missing>'} {'✓' if passed else '✗'}"
    )
    return passed, actual, detail


async def _execute_node(
    node: Dict[str, Any],
    ctx: Dict[str, Any],
    collections: List[Dict[str, Any]],
    environment_id: Optional[str],
    executor: ExecutorFn,
    get_pref: Callable[[str], Optional[str]],
    state: _RunState,
    emit: Callable[[Dict[str, Any]], None],
    set_status: Callable[[str, str], None],
) -> Tuple[bool, Optional[Dict[str, Any]]]:
    """Execute one node to completion; returns (ok, outputs-to-publish)."""
    node_started_at = _iso_now()
    node_start = _now_ms()
    cfg = node.get("config") or {}

    async def run_request_cfg(request_cfg, iteration_item=MISSING):
        return await _execute_request_config(
            request_cfg, ctx, collections, environment_id, executor, get_pref, state, iteration_item
        )

    if node["type"] == "delay":
        await _cancellable_delay(max(0, cfg.get("ms") or 0), state)
        set_status(node["id"], "success")
        emit(_make_record(node, None, "success", node_started_at, _now_ms() - node_start))
        return True, None

    if node["type"] == "request":
        exec_result = await run_request_cfg(cfg)
        status = "success" if exec_result["ok"] else "failed"
        set_status(node["id"], status)
        emit(_make_record(node, exec_result, status, node_started_at, _now_ms() - node_start))
        return exec_result["ok"], exec_result["outputs"] if exec_result["ok"] else None

    if node["type"] == "looper":
        try:
            if cfg.get("itemsSource") == "reference":
                found, value = resolve_reference(cfg.get("itemsValue") or "", ctx)
                if not found:
                    raise ValueError(f'Items reference "{cfg.get("itemsValue")}" not found')
                resolved = json.loads(value) if isinstance(value, str) else value
                if not isinstance(resolved, list):
                    raise ValueError(f'Items reference "{cfg.get("itemsValue")}" is not an array')
                items = resolved
            else:
                parsed = json.loads(cfg.get("itemsValue") or "[]")
                if not isinstance(parsed, list):
                    raise ValueError("Static items must be a JSON array")
                items = parsed
        except Exception as e:
            set_status(node["id"], "failed")
            emit(_make_record(node, None, "failed", node_started_at, _now_ms() - node_start, error=str(e)))
            return False, None

        results: List[Dict[str, Any]] = []
        for iteration, item in enumerate(items):
            iter_started_at = _iso_now()
            iter_start = _now_ms()
            exec_result = await run_request_cfg(cfg.get("request") or {}, item)
            status = "success" if exec_result["ok"] else "failed"
            emit(_make_record(node, exec_result, status, iter_started_at, _now_ms() - iter_start, iteration=iteration))
            if not exec_result["ok"]:
                set_status(node["id"], "failed")
                return False, None
            results.append(exec_result["outputs"])
        set_status(node["id"], "success")
        return True, {"results": results, "count": len(results)}

    if node["type"] == "verifier":
        max_attempts = max(1, cfg.get("maxAttempts") or 1)
        comparisons = cfg.get("comparisons") or []
        last_exec = None
        passed = False

        for attempt in range(1, max_attempts + 1):
            attempt_started_at = _iso_now()
            attempt_start = _now_ms()
            exec_result = await run_request_cfg(cfg.get("request") or {})
            last_exec = exec_result

            attempt_error = exec_result["error"]
            attempt_passed = False
            # Comparisons run even when the request "failed" (e.g. asserting
            # on an expected error status) as long as we got a response.
            if exec_result["response"]:
                evaluations = [evaluate_comparison(c, exec_result, ctx) for c in comparisons]
                attempt_passed = bool(evaluations) and all(passed_ for passed_, _, _ in evaluations)
                detail = "; ".join(d for _, _, d in evaluations)
                if not attempt_passed:
                    attempt_error = (
                        f"Verification failed: {detail}" if comparisons
                        else "Verifier has no comparisons configured"
                    )
                else:
                    attempt_error = None

            emit(_make_record(
                node,
                {**exec_result, "error": attempt_error},
                "success" if attempt_passed else "failed",
                attempt_started_at,
                _now_ms() - attempt_start,
                attempt=attempt,
            ))

            if attempt_passed:
                passed = True
                break
            if attempt < max_attempts:
                await _cancellable_delay(max(0, cfg.get("intervalMs") or 0), state)

        if not passed:
            set_status(node["id"], "failed")
            return False, None
        set_status(node["id"], "success")
        return True, {**((last_exec or {}).get("outputs") or {}), "passed": True}

    raise FlowRunError(f"Unknown node type: {node['type']}")


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
    """Run a flow to completion and return a FlowRunSummary-shaped dict:
    {status: success|failed|cancelled, records, startedAt, durationMs,
     context, nodeStatuses, timeoutHit?}.

    `executor` and `get_pref` default to the real execute_request/LocalStore
    and are injectable for tests. Raises FlowRunError on an invalid graph.
    """
    if executor is None:
        from services.executor import execute_request as executor  # noqa: F811
    if get_pref is None:
        from db.local_store import LocalStore
        get_pref = LocalStore.get_pref

    nodes: List[Dict[str, Any]] = flow.get("nodes") or []
    edges: List[Dict[str, Any]] = flow.get("edges") or []

    cycle = topo_cycle(nodes, edges)
    if cycle is not None:
        raise FlowRunError(f"Flow contains a cycle involving: {', '.join(cycle)}")

    state = _RunState()
    started_at = _iso_now()
    run_start = _now_ms()
    records: List[Dict[str, Any]] = []
    node_statuses: Dict[str, str] = {}
    node_by_id = {n["id"]: n for n in nodes}

    def emit(record: Dict[str, Any]) -> None:
        records.append(record)
        if on_record:
            on_record(record)

    def set_status(node_id: str, status: str) -> None:
        if status in ("success", "failed", "skipped"):
            node_statuses[node_id] = status

    # Adjacency + runtime in-degree (dangling edges skipped, as in topo_cycle).
    succ: Dict[str, List[str]] = {n["id"]: [] for n in nodes}
    remaining: Dict[str, int] = {n["id"]: 0 for n in nodes}
    for e in edges:
        if e.get("source") not in succ or e.get("target") not in succ:
            continue
        remaining[e["target"]] += 1
        succ[e["source"]].append(e["target"])

    # Each node writes exactly one unique ctx key (names are validated unique)
    # and only reads keys of its edge-ancestors, which are always written
    # before it launches — concurrent branches can't conflict.
    ctx: Dict[str, Any] = {}
    terminal: set = set()
    failed = False
    active = 0
    all_settled = asyncio.Event()

    def skip_node(node: Dict[str, Any], reason: str) -> None:
        terminal.add(node["id"])
        set_status(node["id"], "skipped")
        emit(_make_record(node, None, "skipped", _iso_now(), 0, error=reason))

    def skip_descendants(from_id: str, reason_name: str) -> None:
        # Descendants of a failed node can never already be running — they
        # transitively required it. The terminal guard gives shared
        # descendants exactly one skip record even when multiple upstream
        # branches fail.
        reason = f'Skipped: upstream "{reason_name}" {"was cancelled" if state.cancelled else "failed"}'
        stack = list(succ.get(from_id) or [])
        while stack:
            node_id = stack.pop()
            if node_id in terminal:
                continue
            skip_node(node_by_id[node_id], reason)
            stack.extend(succ.get(node_id) or [])

    async def run_one(node: Dict[str, Any]) -> None:
        nonlocal failed
        node_started_at = _iso_now()
        node_start = _now_ms()
        try:
            ok, publish = await _execute_node(
                node, ctx, collections, environment_id, executor, get_pref, state, emit, set_status
            )
            terminal.add(node["id"])
            if not ok:
                failed = True
                skip_descendants(node["id"], node["name"])
                return
            if publish is not None:
                ctx[node["name"]] = publish
            for succ_id in succ.get(node["id"]) or []:
                remaining[succ_id] -= 1
                # The terminal guard blocks launching a merge that was already
                # skipped because another of its incoming branches failed.
                if remaining[succ_id] == 0 and succ_id not in terminal:
                    launch(node_by_id[succ_id])
        except FlowCancelledError:
            terminal.add(node["id"])
            set_status(node["id"], "failed")
            emit(_make_record(node, None, "failed", node_started_at, _now_ms() - node_start, error="Run cancelled"))
            skip_descendants(node["id"], node["name"])
        except Exception as e:
            terminal.add(node["id"])
            set_status(node["id"], "failed")
            failed = True
            emit(_make_record(node, None, "failed", node_started_at, _now_ms() - node_start, error=str(e) or repr(e)))
            skip_descendants(node["id"], node["name"])

    def launch(node: Dict[str, Any]) -> None:
        nonlocal active
        if state.cancelled:
            return  # never start new work after cancellation
        active += 1

        async def wrapped():
            nonlocal active
            try:
                await run_one(node)
            finally:
                active -= 1
                if active == 0:
                    all_settled.set()

        asyncio.create_task(wrapped())

    watchdog = None
    if timeout_seconds and timeout_seconds > 0:
        async def timeout_watchdog():
            await asyncio.sleep(timeout_seconds)
            state.cancel(timeout=True)

        watchdog = asyncio.create_task(timeout_watchdog())

    try:
        roots = [n for n in nodes if remaining[n["id"]] == 0]
        if not roots:
            all_settled.set()  # empty flow
        for node in roots:
            launch(node)
        await all_settled.wait()
    finally:
        if watchdog:
            watchdog.cancel()

    # Anything still non-terminal was stranded by cancellation (its ancestors
    # were aborted before it became ready).
    for node in nodes:
        if node["id"] not in terminal:
            skip_node(node, "Skipped: run cancelled")

    summary = {
        "status": "cancelled" if state.cancelled else ("failed" if failed else "success"),
        "records": records,
        "startedAt": started_at,
        "durationMs": int(_now_ms() - run_start),
        "context": ctx,
        "nodeStatuses": node_statuses,
    }
    if state.timeout_hit:
        summary["timeoutHit"] = True
    return summary
