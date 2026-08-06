"""Tests for the headless V2 streaming runner — replays the shared golden
fixtures (tests/fixtures/v2_flows/*.json, also replayed by
frontend/src/app/utils/flowRunnerV2.golden.test.ts against the TS engine) plus
Python-specific cases (validation abort, cancellation, watchdog, joiner edge
cases). The executor is a fake injected through run_flow's `executor`
parameter; no HTTP or SQLite involved.

Records are compared PER NODE: under pipelining the interleaving of records
across nodes is nondeterministic, but each node's own sequence is not.
"""

import asyncio
import json
import re
from pathlib import Path

from services.flow_runner import FlowRunError
from services.flow_runner_v2 import (
    EMIT_MAX_ITEMS,
    compare_values,
    eval_json_path,
    node_ports,
    parse_handle,
    parse_static_input,
    run_flow,
    validate_flow_v2,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "v2_flows"


def no_pref(key):
    return None


async def run(flow, collections, executor, **kwargs):
    kwargs.setdefault("environment_id", None)
    kwargs.setdefault("get_pref", no_pref)
    return await run_flow(flow, collections=collections, executor=executor, **kwargs)


def scripted_executor(script):
    """script: requestId -> list of executor results returned per call, in
    order. Also records every call's input bindings per requestId."""
    calls = {}
    bindings_seen = {}

    async def executor(payload, environment_id):
        rid = payload["requestId"]
        call = calls.get(rid, 0)
        calls[rid] = call + 1
        bindings_seen.setdefault(rid, []).append(
            {b["name"]: b["value"] for b in payload.get("inputs") or []}
        )
        responses = script.get(rid) or []
        if call >= len(responses):
            raise AssertionError(f"unscripted call #{call + 1} to {rid}")
        return responses[call]

    return executor, calls, bindings_seen


async def _replay_fixture(fixture):
    executor, calls, bindings_seen = scripted_executor(fixture["executorScript"])
    summary = await run(fixture["flow"], fixture["collections"], executor)
    name = fixture["name"]
    expected = fixture["expected"]

    assert summary["status"] == expected["status"], (
        f'{name}: status {summary["status"]} != {expected["status"]}'
    )

    for node_name, expected_records in (expected.get("recordsByNode") or {}).items():
        actual = [r for r in summary["records"] if r["nodeName"] == node_name]
        assert len(actual) == len(expected_records), (
            f'{name}: {node_name} produced {len(actual)} records, expected {len(expected_records)}: '
            f'{[(r["status"], r.get("iteration"), r.get("attempt")) for r in actual]}'
        )
        for i, expected_record in enumerate(expected_records):
            for key, value in expected_record.items():
                assert actual[i].get(key) == value, (
                    f'{name}: {node_name} record[{i}].{key} = {actual[i].get(key)!r}, expected {value!r}'
                )

    for rid, expected_calls in (expected.get("bindings") or {}).items():
        seen = bindings_seen.get(rid) or []
        assert len(seen) == len(expected_calls), (
            f'{name}: {rid} called {len(seen)} times, expected {len(expected_calls)}'
        )
        for call, expected_bindings in enumerate(expected_calls):
            for key, value in expected_bindings.items():
                assert seen[call].get(key) == value, (
                    f'{name}: {rid} call {call} input {key} = {seen[call].get(key)!r}, expected {value!r}'
                )

    for node_name, expected_outputs in (expected.get("nodeOutputs") or {}).items():
        last = next(r for r in reversed(summary["records"]) if r["nodeName"] == node_name)
        assert last["outputs"] == expected_outputs, (
            f'{name}: outputs of {node_name} = {last["outputs"]!r}, expected {expected_outputs!r}'
        )

    # Generated values are nondeterministic, so fixtures assert their shape.
    # Patterns stay to constructs `re` and JS RegExp read identically.
    for rid, expected_calls in (expected.get("bindingPatterns") or {}).items():
        seen = bindings_seen.get(rid) or []
        assert len(seen) == len(expected_calls), (
            f'{name}: {rid} called {len(seen)} times, expected {len(expected_calls)}'
        )
        for call, expected_bindings in enumerate(expected_calls):
            for key, pattern in expected_bindings.items():
                actual = seen[call].get(key)
                assert actual is not None and re.match(pattern, str(actual)), (
                    f'{name}: {rid} call {call} input {key} = {actual!r}, expected to match {pattern!r}'
                )

    # One generated value shared by several requests — the point of the block.
    for rule in expected.get("sameBindingAcross") or []:
        call, key = rule.get("call", 0), rule["input"]
        values = [(bindings_seen.get(rid) or [])[call].get(key) for rid in rule["requests"]]
        assert len(set(values)) == 1, (
            f'{name}: {rule["requests"]} received different {key} values: {values!r}'
        )

    # A fresh value per item — every call must differ.
    for rule in expected.get("distinctBindings") or []:
        key = rule["input"]
        values = [call.get(key) for call in (bindings_seen.get(rule["request"]) or [])]
        assert len(set(values)) == len(values), (
            f'{name}: {rule["request"]} repeated a {key} value across items: {values!r}'
        )

    for node_name, expected_latched in (expected.get("nodeLatchedInputs") or {}).items():
        node_id = next(n["id"] for n in fixture["flow"]["nodes"] if n["name"] == node_name)
        actual_latched = (summary.get("nodeLatchedInputs") or {}).get(node_id) or []
        assert sorted(actual_latched) == sorted(expected_latched), (
            f'{name}: latched inputs of {node_name} = {actual_latched!r}, expected {expected_latched!r}'
        )

    for node_name, expected_counts in (expected.get("nodeItemCounts") or {}).items():
        node_id = next(n["id"] for n in fixture["flow"]["nodes"] if n["name"] == node_name)
        assert summary["nodeItemCounts"].get(node_id) == expected_counts, (
            f'{name}: item counts of {node_name} = {summary["nodeItemCounts"].get(node_id)!r}, '
            f'expected {expected_counts!r}'
        )


async def test_golden_fixtures():
    fixture_files = sorted(FIXTURES_DIR.glob("*.json"))
    assert fixture_files, f"no fixtures found in {FIXTURES_DIR}"
    for path in fixture_files:
        await _replay_fixture(json.loads(path.read_text()))


# ---- helpers for the Python-specific cases ----------------------------------

def _request(rid, url=None, outputs=None):
    return {
        "id": rid,
        "method": "GET",
        "url": url or f"http://test/{rid}",
        "headers": [],
        "queryParams": [],
        "bodyType": "none",
        "body": "",
        "authType": "none",
        "authConfig": {},
        "inputs": [],
        "outputs": outputs or [],
    }


def _ok(outputs=None, body=None):
    return {
        "status": 200,
        "statusText": "OK",
        "headers": {},
        "body": body,
        "outputs": outputs or {},
        "missingOutputs": [],
    }


def _node(node_id, node_type, config):
    return {"id": node_id, "name": node_id, "type": node_type, "position": {"x": 0, "y": 0}, "config": config}


def _req_node(node_id, request_id=None, **extra):
    return _node(node_id, "request", {"requestId": request_id or node_id, "staticInputs": {}, **extra})


def _emit_node(node_id, items):
    return _node(node_id, "arrayEmit", {"staticItems": {"type": "json", "value": json.dumps(items)}})


def _edge(source, source_handle, target, target_handle, path=None):
    e = {
        "id": f"{source}:{source_handle}->{target}:{target_handle}",
        "source": source,
        "target": target,
        "sourceHandle": source_handle,
        "targetHandle": target_handle,
    }
    if path:
        e["path"] = path
    return e


def _flow(nodes, edges):
    return {"id": "flow", "name": "flow", "schemaVersion": 2, "nodes": nodes, "edges": edges}


# ---- unit-level parity checks ------------------------------------------------

def test_json_path_normalization():
    data = {"name": "apple", "items": [{"id": "a"}, {"id": "b"}], "n": 1}
    assert eval_json_path("$.name", data) == (True, "apple", None)
    assert eval_json_path("$.items[*].id", data)[:2] == (True, ["a", "b"])
    assert eval_json_path("$.items[0].id", data)[:2] == (True, "a")
    assert eval_json_path("$..id", data)[:2] == (True, ["a", "b"])
    found, _, _ = eval_json_path("$.missing", data)
    assert found is False
    found, _, err = eval_json_path("", data)
    assert found is False and err == "empty path"


def test_generator_token_grammar():
    """Parity with frontend/src/app/utils/generatorsV2.test.ts — the two engines
    must read the same token the same way. Date cases pin an exact instant by
    comparing against the same arithmetic, since the backend has no clock hook."""
    from datetime import datetime, timedelta, timezone

    from services.executor import _resolve_dynamic_token, is_known_dynamic_token

    now = datetime.now(timezone.utc)
    # Default format and offsets, computed the same way the caller would.
    assert _resolve_dynamic_token("$date") == now.strftime("%Y-%m-%d")
    assert _resolve_dynamic_token("$date:+1d") == (now + timedelta(days=1)).strftime("%Y-%m-%d")
    assert _resolve_dynamic_token("$date:-7d") == (now - timedelta(days=7)).strftime("%Y-%m-%d")
    assert _resolve_dynamic_token("$date:DD/MM/YY") == now.strftime("%d/%m/%y")
    # An offset chain applies before the format.
    shifted = now + timedelta(days=1, hours=-2)
    assert _resolve_dynamic_token("$date:+1d-2h:YYYY-MM-DD HH:mm") == shifted.strftime("%Y-%m-%d %H:%M")
    # Epoch output, seconds and milliseconds.
    assert abs(int(_resolve_dynamic_token("$date:epoch")) - int(now.timestamp())) <= 1
    assert len(_resolve_dynamic_token("$date:epochms")) == 13
    # Every token substituted exactly once.
    assert re.match(r"^\d{14}$", _resolve_dynamic_token("$date:YYYYMMDDHHmmss"))
    assert _resolve_dynamic_token("$date:[on] YYYY") == f"[on] {now.strftime('%Y')}"

    for _ in range(40):
        assert re.match(r"^[1-9]\d{3}$", _resolve_dynamic_token("$randomInt:4"))
        assert re.match(r"^\d$", _resolve_dynamic_token("$randomInt:1"))
        assert 5 <= int(_resolve_dynamic_token("$randomInt:5:7")) <= 7
    assert 0 <= int(_resolve_dynamic_token("$randomInt")) <= 999
    assert _resolve_dynamic_token("$randomInt:-3:-3") == "-3"
    for bad in ("$randomInt:abc", "$randomInt:0", "$randomInt:9:2", "$randomInt:1:2:3"):
        assert _resolve_dynamic_token(bad) is None, bad

    assert re.match(r"^[a-z]+\.[a-z]+\d{1,3}@example\.com$", _resolve_dynamic_token("$randomEmail"))
    assert re.match(
        r"^[a-z]+\.[a-z]+\d{1,3}@lixionary\.test$", _resolve_dynamic_token("$randomEmail:lixionary.test")
    )
    assert re.match(r"^[A-Z][a-z]+$", _resolve_dynamic_token("$randomFirstName"))
    assert re.match(r"^[A-Z][a-z]+ [A-Z][a-z]+$", _resolve_dynamic_token("$randomFullName"))

    assert _resolve_dynamic_token("$nope") is None
    # Generator names are case-insensitive in both engines.
    assert re.match(r"^[A-Z][a-z]+$", _resolve_dynamic_token("$RANDOMfirstNAME"))

    # Known-token checks look at the NAME only, so a bad argument is a run-time
    # failure rather than an edit-time rejection — matching isKnownGeneratorToken.
    for good in ("$date", "$date:+1d:YYYY", "$randomInt:4", "$randomEmail", "$latitude", "$randomInt:abc"):
        assert is_known_dynamic_token(good) is True, good
    for bad in ("$teleport", "randomInt:4", ""):
        assert is_known_dynamic_token(bad) is False, bad


def test_compare_values_operators():
    assert compare_values("equals", 200, "200") is True      # numeric coercion
    assert compare_values("not_equals", "a", "b") is True
    assert compare_values("greater_than", 5, "4") is True
    assert compare_values("less_than", 5, "4") is False
    assert compare_values("contains", ["a", "b"], "a") is True
    assert compare_values("contains", "hello", "ell") is True
    assert compare_values("exists", None, "") is False
    assert compare_values("exists", 0, "") is True


def test_parse_handle_and_ports():
    assert parse_handle("in:orderId") == {"kind": "data", "direction": "in", "name": "orderId"}
    assert parse_handle("out:o:row1") == {"kind": "data", "direction": "out", "name": "o:row1"}
    assert parse_handle("after") == {"kind": "trigger", "direction": "in", "name": None}
    assert parse_handle("bogus") is None

    collections = [{"id": "col", "requests": [_request("R", url="http://test/{{x}}", outputs=["v"])]}]
    # `each` is opt-in, so a plain request exposes only its own inputs
    assert [p["id"] for p in node_ports(_req_node("n", "R"), collections)] == [
        "after", "done", "in:x", "out:v",
    ]
    assert [p["id"] for p in node_ports(_req_node("n", "R", useEach=True), collections)] == [
        "after", "done", "in:ctl:each", "in:x", "out:v",
    ]
    mapper = _node("d", "mapper", {"rows": [{"id": "r1", "path": "$.a"}, {"id": "r2", "path": "$.b"}]})
    assert [p["id"] for p in node_ports(mapper, []) if p["direction"] == "out" and p["kind"] == "data"] == [
        "out:o:r1", "out:o:r2",
    ]


def test_verify_adds_no_passed_output():
    collections = [{"id": "col", "requests": [_request("R", outputs=["v"])]}]
    verify = {
        "enabled": True,
        "checks": [{"id": "c1", "path": "$.status", "operator": "equals",
                    "expectedSource": "static", "expected": "200"}],
        "maxAttempts": 2, "intervalMs": 0,
    }
    ids = [p["id"] for p in node_ports(_req_node("r", "R", verify=verify), collections)]
    assert "out:v" in ids
    assert "out:passed" not in ids


def test_parse_static_input_types():
    assert parse_static_input({"type": "number", "value": " 42 "})[:2] == (True, 42)
    assert parse_static_input({"type": "boolean", "value": "true"})[:2] == (True, True)
    assert parse_static_input({"type": "json", "value": '{"a":1}'})[:2] == (True, {"a": 1})
    assert parse_static_input({"type": "number", "value": "abc"})[0] is False
    # tokens ride through untouched for the executor
    assert parse_static_input({"type": "number", "value": "{{env.PORT}}"})[:2] == (True, "{{env.PORT}}")


def test_validate_flow_v2_rules():
    collections = [{"id": "col", "requests": [_request("R", url="http://test/{{x}}", outputs=["v"])]}]

    def errors(flow):
        return [i["message"] for i in validate_flow_v2(flow, collections) if i["level"] == "error"]

    # one output may feed several inputs
    fan_out = _flow(
        [_req_node("a", "R"), _req_node("b", "R"), _req_node("c", "R")],
        [_edge("a", "out:v", "b", "in:x"), _edge("a", "out:v", "c", "in:x")],
    )
    assert errors(fan_out) == []

    fan_in = _flow(
        [_req_node("a", "R"), _req_node("b", "R"), _req_node("c", "R")],
        [_edge("a", "out:v", "c", "in:x"), _edge("b", "out:v", "c", "in:x")],
    )
    assert any("more than one connection" in m for m in errors(fan_in))

    # triggers may fan in and out freely
    triggers = _flow(
        [_req_node("a", "R"), _req_node("b", "R"), _req_node("c", "R")],
        [_edge("a", "done", "b", "after"), _edge("a", "done", "c", "after")],
    )
    assert errors(triggers) == []

    drift = _flow([_req_node("a", "R"), _req_node("b", "R")], [_edge("a", "out:gone", "b", "in:x")])
    assert any("missing port" in m for m in errors(drift))

    cycle = _flow(
        [_req_node("a", "R"), _req_node("b", "R")],
        [_edge("a", "done", "b", "after"), _edge("b", "done", "a", "after")],
    )
    assert any("cycle" in m for m in errors(cycle))

    bad_count = _flow([_node("e", "arrayEmit", {"staticItems": {"type": "number", "value": "0"}})], [])
    assert any("whole number of at least 1" in m for m in errors(bad_count))

    over_count = _flow(
        [_node("e", "arrayEmit", {"staticItems": {"type": "number", "value": str(EMIT_MAX_ITEMS + 1)}})], []
    )
    assert any(f"over the maximum of {EMIT_MAX_ITEMS}" in m for m in errors(over_count))

    big = json.dumps(list(range(EMIT_MAX_ITEMS + 1)))
    over_cap = _flow([_node("e", "arrayEmit", {"staticItems": {"type": "json", "value": big}})], [])
    assert any(f"maximum of {EMIT_MAX_ITEMS}" in m for m in errors(over_cap))

    legacy = _flow([_node("old", "loop", {})], [])
    assert any("unsupported type" in m for m in errors(legacy))


async def test_invalid_flow_aborts_before_running():
    collections = [{"id": "col", "requests": [_request("R", url="http://test/{{x}}", outputs=["v"])]}]
    executor, calls, _ = scripted_executor({"R": [_ok()]})
    flow = _flow([_req_node("a", "R"), _req_node("b", "R")], [_edge("a", "out:gone", "b", "in:x")])
    try:
        await run(flow, collections, executor)
        raise AssertionError("expected FlowRunError")
    except FlowRunError as e:
        assert "missing port" in str(e)
    assert not calls


async def test_each_repeats_an_input_less_request():
    """A request with no {{tokens}} runs once per item arriving on `each`, and
    the driving value never becomes a request parameter."""
    collections = [{"id": "col", "requests": [_request("PING", outputs=["seq"])]}]
    executor, calls, bindings_seen = scripted_executor({"PING": [_ok({"seq": "s"})] * 3})
    flow = _flow(
        [
            _node("emit", "arrayEmit", {"staticItems": {"type": "number", "value": "3"}}),
            _req_node("ping", "PING", useEach=True),
        ],
        [_edge("emit", "out:index", "ping", "in:ctl:each")],
    )
    summary = await run(flow, collections, executor)
    assert summary["status"] == "success"
    assert calls["PING"] == 3
    assert bindings_seen["PING"] == [{}, {}, {}]
    assert summary["nodeItemCounts"]["ping"] == {"ok": 3, "failed": 0, "skipped": 0}


async def test_count_mode_emits_zero_to_n_minus_one():
    collections = [{"id": "col", "requests": [_request("SEE", url="http://test/{{n}}")]}]
    executor, _, bindings_seen = scripted_executor({"SEE": [_ok(), _ok(), _ok()]})
    flow = _flow(
        [
            _node("emit", "arrayEmit", {"staticItems": {"type": "number", "value": "3"}}),
            _req_node("see", "SEE"),
        ],
        [_edge("emit", "out:item", "see", "in:n")],
    )
    summary = await run(flow, collections, executor)
    assert summary["status"] == "success"
    assert [b["n"] for b in bindings_seen["SEE"]] == ["0", "1", "2"]


async def test_done_after_barrier_waits_for_whole_stream():
    order = []
    collections = [{
        "id": "col",
        "requests": [_request("R", url="http://test/{{x}}"), _request("AFTER")],
    }]

    async def executor(payload, environment_id):
        order.append(payload["requestId"])
        return _ok()

    flow = _flow(
        [_emit_node("emit", ["a", "b", "c"]), _req_node("r", "R"), _req_node("after", "AFTER")],
        [_edge("emit", "out:item", "r", "in:x"), _edge("r", "done", "after", "after")],
    )
    summary = await run(flow, collections, executor)
    assert summary["status"] == "success"
    assert order == ["R", "R", "R", "AFTER"]


async def test_cancellation_mid_stream():
    collections = [{"id": "col", "requests": [_request("SLOW", url="http://test/{{x}}")]}]

    async def slow_executor(payload, environment_id):
        await asyncio.sleep(0.5)
        return _ok()

    flow = _flow([_emit_node("emit", ["a", "b", "c"]), _req_node("r", "SLOW")],
                 [_edge("emit", "out:item", "r", "in:x")])
    summary = await run(flow, collections, slow_executor, timeout_seconds=0.05)
    assert summary["status"] == "cancelled"
    assert summary.get("timeoutHit") is True


async def test_partial_failure_reports_item_counts():
    collections = [{"id": "col", "requests": [_request("R", url="http://test/{{x}}", outputs=["v"])]}]
    call = {"n": 0}

    async def executor(payload, environment_id):
        n = call["n"]
        call["n"] += 1
        if n == 1:
            return {"status": 500, "statusText": "Server Error", "headers": {}, "body": None,
                    "outputs": {}, "missingOutputs": []}
        return _ok({"v": f"v{n}"})

    flow = _flow(
        [_emit_node("emit", ["a", "b", "c"]), _req_node("r", "R"), _node("acc", "accumulator", {})],
        [_edge("emit", "out:item", "r", "in:x"), _edge("r", "out:v", "acc", "in:item")],
    )
    summary = await run(flow, collections, executor)
    assert summary["status"] == "failed"
    assert summary["nodeStatuses"]["r"] == "partial"
    assert summary["nodeItemCounts"]["r"] == {"ok": 2, "failed": 1, "skipped": 0}
    acc = next(r for r in reversed(summary["records"]) if r["nodeName"] == "acc")
    assert acc["outputs"] == {"items": ["v0", "v2"], "count": 2, "dropped": 1}
