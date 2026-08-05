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
    assert [p["id"] for p in node_ports(_req_node("n", "R"), collections)] == [
        "after", "done", "in:x", "out:v",
    ]
    demux = _node("d", "demux", {"rows": [{"id": "r1", "path": "$.a"}, {"id": "r2", "path": "$.b"}]})
    assert [p["id"] for p in node_ports(demux, []) if p["direction"] == "out" and p["kind"] == "data"] == [
        "out:o:r1", "out:o:r2",
    ]
    dup = _node("dup", "duplicator", {"count": 3})
    assert [p["id"] for p in node_ports(dup, []) if p["direction"] == "out" and p["kind"] == "data"] == [
        "out:o:0", "out:o:1", "out:o:2",
    ]


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

    fan_out = _flow(
        [_req_node("a", "R"), _req_node("b", "R"), _req_node("c", "R")],
        [_edge("a", "out:v", "b", "in:x"), _edge("a", "out:v", "c", "in:x")],
    )
    assert any("add a Duplicator" in m for m in errors(fan_out))

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
