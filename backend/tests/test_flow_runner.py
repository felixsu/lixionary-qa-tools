"""Tests for the headless flow runner — ports the behavioral spec of
frontend/src/app/utils/flowRunner.test.ts (scheduling, merge, skip-on-failure,
looper/verifier semantics) plus runner-specific cases. The executor is a fake
injected through run_flow's `executor` parameter; no HTTP or SQLite involved.
"""

import asyncio
import json

from services.flow_runner import (
    MISSING,
    FlowRunError,
    evaluate_comparison,
    interpolate_studio_tokens,
    resolve_reference,
    run_flow,
    walk_path,
)
from services.flow_report import build_run_csv, condense_summary


def ok(outputs=None):
    return {
        "status": 200,
        "statusText": "OK",
        "headers": {},
        "body": None,
        "outputs": outputs or {},
        "missingOutputs": [],
    }


def http_error(status=500, text="Internal Server Error"):
    return {
        "status": status,
        "statusText": text,
        "headers": {},
        "body": None,
        "outputs": {},
        "missingOutputs": [],
    }


def make_harness(handlers):
    """handlers: requestId -> sync/async callable returning an executor result.
    Returns (collections, executor, payloads) where payloads records every
    executor call payload per requestId."""
    collections = [{
        "id": "col",
        "requests": [
            {
                "id": rid,
                "method": "GET",
                "url": f"http://test/{rid}",
                "headers": [],
                "queryParams": [],
                "bodyType": "none",
                "body": "",
                "authType": "none",
                "authConfig": {},
                "inputs": [],
                "outputs": [],
            }
            for rid in handlers
        ],
    }]
    payloads = {}

    async def executor(payload, environment_id):
        payloads.setdefault(payload["requestId"], []).append(payload)
        result = handlers[payload["requestId"]]()
        if asyncio.iscoroutine(result):
            result = await result
        return result

    return collections, executor, payloads


def no_pref(key):
    return None


def req_node(node_id, mappings=None):
    return {
        "id": node_id,
        "name": node_id,
        "type": "request",
        "position": {"x": 0, "y": 0},
        "config": {"requestId": node_id, "mappings": mappings or []},
    }


def edge(source, target):
    return {"id": f"{source}-{target}", "source": source, "target": target}


def make_flow(nodes, edges):
    return {"id": "flow", "name": "flow", "nodes": nodes, "edges": edges}


async def run(flow, collections, executor, **kwargs):
    kwargs.setdefault("environment_id", None)
    kwargs.setdefault("get_pref", no_pref)
    return await run_flow(flow, collections=collections, executor=executor, **kwargs)


async def test_linear_chain_pipes_outputs():
    collections, executor, payloads = make_harness({
        "a": lambda: ok({"uuid": "u-1"}),
        "b": lambda: ok(),
    })
    flow = make_flow(
        [req_node("a"), req_node("b", [{"inputName": "myId", "source": "reference", "value": "a.uuid"}])],
        [edge("a", "b")],
    )
    summary = await run(flow, collections, executor)
    assert summary["status"] == "success"
    assert summary["nodeStatuses"] == {"a": "success", "b": "success"}
    # b's flow mapping became a literal binding carrying a's output
    b_inputs = {i["name"]: i for i in payloads["b"][0]["inputs"]}
    assert b_inputs["myId"] == {"name": "myId", "source": "literal", "value": "u-1"}
    assert summary["context"]["a"] == {"uuid": "u-1"}


async def test_fanout_runs_branches_concurrently():
    b_started = asyncio.Event()
    c_started = asyncio.Event()

    async def slow_b():
        b_started.set()
        # deadlocks (and times out the test) if branches were serialized
        await asyncio.wait_for(c_started.wait(), timeout=2)
        return ok()

    async def slow_c():
        c_started.set()
        await asyncio.wait_for(b_started.wait(), timeout=2)
        return ok()

    collections, executor, _ = make_harness({"a": lambda: ok(), "b": slow_b, "c": slow_c})
    flow = make_flow(
        [req_node("a"), req_node("b"), req_node("c")],
        [edge("a", "b"), edge("a", "c")],
    )
    summary = await asyncio.wait_for(run(flow, collections, executor), timeout=5)
    assert summary["status"] == "success"


async def test_merge_waits_for_all_branches_and_sees_both_outputs():
    collections, executor, payloads = make_harness({
        "b": lambda: ok({"left": "L"}),
        "c": lambda: ok({"right": "R"}),
        "m": lambda: ok(),
    })
    flow = make_flow(
        [
            req_node("b"), req_node("c"),
            req_node("m", [
                {"inputName": "x", "source": "reference", "value": "b.left"},
                {"inputName": "y", "source": "reference", "value": "c.right"},
            ]),
        ],
        [edge("b", "m"), edge("c", "m")],
    )
    summary = await run(flow, collections, executor)
    assert summary["status"] == "success"
    m_inputs = {i["name"]: i["value"] for i in payloads["m"][0]["inputs"]}
    assert m_inputs == {"x": "L", "y": "R"}


async def test_failure_skips_only_descendants():
    collections, executor, payloads = make_harness({
        "a": lambda: http_error(),
        "b": lambda: ok(),
        "d": lambda: ok(),
        "c": lambda: ok(),
    })
    # a -> b -> d fails at the root; c is an independent chain that must finish
    flow = make_flow(
        [req_node("a"), req_node("b"), req_node("d"), req_node("c")],
        [edge("a", "b"), edge("b", "d")],
    )
    summary = await run(flow, collections, executor)
    assert summary["status"] == "failed"
    assert summary["nodeStatuses"] == {"a": "failed", "b": "skipped", "d": "skipped", "c": "success"}
    assert "b" not in payloads and "d" not in payloads

    by_node = {r["nodeName"]: r for r in summary["records"]}
    assert by_node["a"]["error"] == "HTTP 500 Internal Server Error"
    assert by_node["b"]["error"] == 'Skipped: upstream "a" failed'


async def test_shared_merge_skipped_exactly_once():
    collections, executor, _ = make_harness({
        "a": lambda: http_error(),
        "c": lambda: ok(),
        "m": lambda: ok(),
    })
    flow = make_flow(
        [req_node("a"), req_node("c"), req_node("m")],
        [edge("a", "m"), edge("c", "m")],
    )
    summary = await run(flow, collections, executor)
    m_records = [r for r in summary["records"] if r["nodeName"] == "m"]
    assert len(m_records) == 1
    assert m_records[0]["status"] == "skipped"


async def test_looper_iterates_and_publishes_results():
    calls = []

    def echo():
        calls.append(len(calls))
        return ok({"uuid": f"u-{len(calls)}"})

    collections, executor, payloads = make_harness({"inner": echo, "after": lambda: ok()})
    flow = make_flow(
        [
            {
                "id": "loop", "name": "loop", "type": "looper", "position": {"x": 0, "y": 0},
                "config": {
                    "itemsSource": "static",
                    "itemsValue": json.dumps([{"ref": "r1"}, {"ref": "r2"}]),
                    "request": {"requestId": "inner", "mappings": [
                        {"inputName": "ref", "source": "reference", "value": "item.ref"},
                    ]},
                },
            },
            req_node("after", [{"inputName": "ids", "source": "reference", "value": "loop.results.*.uuid"}]),
        ],
        [edge("loop", "after")],
    )
    summary = await run(flow, collections, executor)
    assert summary["status"] == "success"
    loop_records = [r for r in summary["records"] if r["nodeName"] == "loop"]
    assert [r["iteration"] for r in loop_records] == [0, 1]
    inner_values = [
        {i["name"]: i["value"] for i in p["inputs"]}["ref"] for p in payloads["inner"]
    ]
    assert inner_values == ["r1", "r2"]
    assert summary["context"]["loop"] == {"results": [{"uuid": "u-1"}, {"uuid": "u-2"}], "count": 2}
    # wildcard projection reaches the downstream node as a JSON array string
    after_inputs = {i["name"]: i["value"] for i in payloads["after"][0]["inputs"]}
    assert after_inputs["ids"] == '["u-1","u-2"]'


async def test_looper_stops_on_first_failing_iteration():
    attempts = []

    def flaky():
        attempts.append(1)
        return http_error() if len(attempts) == 2 else ok()

    collections, executor, _ = make_harness({"inner": flaky})
    flow = make_flow(
        [{
            "id": "loop", "name": "loop", "type": "looper", "position": {"x": 0, "y": 0},
            "config": {
                "itemsSource": "static",
                "itemsValue": json.dumps([1, 2, 3]),
                "request": {"requestId": "inner", "mappings": []},
            },
        }],
        [],
    )
    summary = await run(flow, collections, executor)
    assert summary["status"] == "failed"
    assert len(attempts) == 2  # third item never ran
    loop_records = [r for r in summary["records"] if r["nodeName"] == "loop"]
    assert [r["status"] for r in loop_records] == ["success", "failed"]


async def test_verifier_retries_until_comparisons_pass():
    calls = []

    def eventually_ok():
        calls.append(1)
        return ok({"state": "done"}) if len(calls) >= 3 else http_error(404, "Not Found")

    collections, executor, _ = make_harness({"check": eventually_ok})
    flow = make_flow(
        [{
            "id": "v", "name": "v", "type": "verifier", "position": {"x": 0, "y": 0},
            "config": {
                "request": {"requestId": "check", "mappings": []},
                "comparisons": [
                    {"field": "status", "operator": "equals", "expected": "200"},
                    {"field": "outputs.state", "operator": "equals", "expected": "done"},
                ],
                "maxAttempts": 5,
                "intervalMs": 1,
            },
        }],
        [],
    )
    summary = await run(flow, collections, executor)
    assert summary["status"] == "success"
    v_records = [r for r in summary["records"] if r["nodeName"] == "v"]
    assert [r["attempt"] for r in v_records] == [1, 2, 3]
    assert [r["status"] for r in v_records] == ["failed", "failed", "success"]
    assert "Verification failed" in v_records[0]["error"]
    assert summary["context"]["v"] == {"state": "done", "passed": True}


async def test_verifier_exhausts_attempts_and_fails():
    collections, executor, _ = make_harness({"check": lambda: ok({"n": 1})})
    flow = make_flow(
        [{
            "id": "v", "name": "v", "type": "verifier", "position": {"x": 0, "y": 0},
            "config": {
                "request": {"requestId": "check", "mappings": []},
                "comparisons": [{"field": "outputs.n", "operator": "greater_than", "expected": "5"}],
                "maxAttempts": 2,
                "intervalMs": 1,
            },
        }],
        [],
    )
    summary = await run(flow, collections, executor)
    assert summary["status"] == "failed"
    assert summary["nodeStatuses"]["v"] == "failed"
    assert len([r for r in summary["records"] if r["nodeName"] == "v"]) == 2


async def test_unresolved_reference_fails_node():
    collections, executor, payloads = make_harness({"a": lambda: ok()})
    flow = make_flow(
        [req_node("a", [{"inputName": "x", "source": "reference", "value": "ghost.value"}])],
        [],
    )
    summary = await run(flow, collections, executor)
    assert summary["status"] == "failed"
    record = summary["records"][0]
    assert record["error"] == 'Reference "ghost.value" not found for input "x"'
    assert "a" not in payloads  # executor never called


async def test_executor_exception_becomes_failed_record():
    def boom():
        raise ValueError("Auth Hook Execution Failed: ERROR: bad creds")

    collections, executor, _ = make_harness({"a": boom})
    flow = make_flow([req_node("a")], [])
    summary = await run(flow, collections, executor)
    assert summary["status"] == "failed"
    assert "Auth Hook Execution Failed" in summary["records"][0]["error"]


def test_cycle_rejected():
    collections, executor, _ = make_harness({"a": ok, "b": ok})
    flow = make_flow([req_node("a"), req_node("b")], [edge("a", "b"), edge("b", "a")])
    try:
        asyncio.run(run(flow, collections, executor))
        raise AssertionError("expected FlowRunError")
    except FlowRunError as e:
        assert "cycle" in str(e)


async def test_timeout_cancels_run():
    async def hang():
        await asyncio.sleep(30)
        return ok()

    collections, executor, _ = make_harness({"a": hang, "b": lambda: ok()})
    flow = make_flow([req_node("a"), req_node("b")], [edge("a", "b")])
    summary = await run(flow, collections, executor, timeout_seconds=0.2)
    assert summary["status"] == "cancelled"
    assert summary["timeoutHit"] is True
    by_node = {r["nodeName"]: r for r in summary["records"]}
    assert by_node["b"]["status"] == "skipped"


async def test_delay_node_waits_and_succeeds():
    collections, executor, _ = make_harness({"a": lambda: ok()})
    flow = make_flow(
        [
            {"id": "d", "name": "d", "type": "delay", "position": {"x": 0, "y": 0}, "config": {"ms": 5}},
            req_node("a"),
        ],
        [edge("d", "a")],
    )
    summary = await run(flow, collections, executor)
    assert summary["status"] == "success"
    assert summary["nodeStatuses"] == {"d": "success", "a": "success"}


async def test_auth_override_pref_applied():
    collections, executor, payloads = make_harness({"a": lambda: ok()})

    def get_pref(key):
        assert key == "auth_override:a"
        return json.dumps({"authType": "HOOK", "authConfig": {"authFunctionId": "af-1", "tokenField": "token"}})

    flow = make_flow([req_node("a")], [])
    summary = await run_flow(flow, environment_id=None, collections=collections, executor=executor, get_pref=get_pref)
    assert summary["status"] == "success"
    payload = payloads["a"][0]
    assert payload["authType"] == "HOOK"
    assert payload["authConfig"]["authFunctionId"] == "af-1"
    assert payload["authConfig"]["tokenField"] == "token"


def test_walk_path_and_references():
    ctx = {"node": {"out": {"a": [{"b": "1"}, {"b": "2"}, {}]}, "raw": '{"inner": 7}'}}

    assert walk_path(ctx["node"], ["out", "a", "0", "b"]) == "1"
    # wildcard projection drops unresolved elements
    assert walk_path(ctx["node"], ["out", "a", "*", "b"]) == ["1", "2"]
    # JSON-string leaves are transparently parsed
    assert walk_path(ctx["node"], ["raw", "inner"]) == 7
    assert walk_path(ctx["node"], ["nope"]) is MISSING

    found, value = resolve_reference("node.out.a.*.b", ctx)
    assert found and value == ["1", "2"]
    found, _ = resolve_reference("missing.x", ctx)
    assert not found
    # null is a legitimate resolved value, distinct from missing
    found, value = resolve_reference("node.out", {"node": {"out": None}})
    assert found and value is None


def test_interpolate_studio_tokens_leaves_backend_tokens():
    ctx = {"getUuid": {"uuid": "u-9"}}
    text = "id={{getUuid.uuid}} env={{env.BASE}} date={{$date}} input={{plain}}"
    assert interpolate_studio_tokens(text, ctx) == "id=u-9 env={{env.BASE}} date={{$date}} input={{plain}}"
    # item tokens resolve against the current looper element
    assert interpolate_studio_tokens("v={{item.k}}", {}, {"k": 3}) == "v=3"
    # objects are JSON-stringified when injected
    assert interpolate_studio_tokens("{{getUuid}}", ctx) == '{"uuid":"u-9"}'


def test_evaluate_comparison_operators():
    exec_result = {
        "response": {"status": 200, "body": {"count": "5", "tag": None, "list": ["a", "b"]}},
        "outputs": {"n": 3},
    }
    def check(field, operator, expected, want):
        passed, _, _ = evaluate_comparison({"field": field, "operator": operator, "expected": expected}, exec_result, {})
        assert passed is want, f"{field} {operator} {expected} -> {passed}, want {want}"

    check("status", "equals", "200", True)          # numeric coercion
    check("status", "not_equals", "404", True)
    check("body.count", "greater_than", "4", True)  # numeric strings compare numerically
    check("body.count", "less_than", "4", False)
    check("body.tag", "exists", "", False)          # null does not "exist"
    check("body.count", "exists", "", True)
    check("body.missing", "exists", "", False)
    check("body.list", "contains", "a", True)       # array membership
    check("body.list", "contains", "c", False)
    check("outputs.n", "equals", "3", True)
    check("n", "equals", "3", True)                 # bare path reads outputs


def test_build_run_csv_orders_and_escapes():
    records = [
        {
            "nodeName": "b", "nodeType": "request", "status": "success",
            "startedAt": "2026-01-01T00:00:02.000Z", "durationMs": 5,
            "resolvedInputs": {}, "outputs": {"v": 'say "hi"'}, "requestPayload": None,
            "response": {"status": 200, "statusText": "OK", "headers": {}, "body": None},
        },
        {
            "nodeName": "a", "nodeType": "request", "status": "failed",
            "startedAt": "2026-01-01T00:00:01.000Z", "durationMs": 3,
            "resolvedInputs": {}, "outputs": None, "requestPayload": None,
            "response": None, "error": "HTTP 500, oops",
            "testResults": [{"name": "t1", "passed": False}], "testError": None,
        },
    ]
    csv = build_run_csv(records)
    lines = csv.split("\n")
    assert lines[0].startswith("node_name,node_type,iteration,attempt,status,started_at,duration_ms")
    # sorted by startedAt: a first despite emission order
    assert lines[1].split(",")[0] == "a"
    assert lines[2].split(",")[0] == "b"
    assert '"HTTP 500, oops"' in lines[1]  # comma-bearing cell quoted
    assert "t1: FAIL" in lines[1]
    # JSON cell quotes are doubled for CSV: {"v":...} -> "{""v"":...}"
    assert '{""v"":' in lines[2]


def test_condense_summary_digest_and_truncation():
    records = (
        [{"nodeName": f"s{i}", "status": "success", "startedAt": f"2026-01-01T00:00:{i:02d}.000Z",
          "durationMs": 1, "resolvedInputs": {}, "outputs": {"big": "x" * 50}, "requestPayload": None,
          "response": None} for i in range(10)]
        + [{"nodeName": "bad", "status": "failed", "startedAt": "2026-01-01T00:01:00.000Z",
            "durationMs": 1, "resolvedInputs": {}, "outputs": None, "requestPayload": None,
            "response": None, "error": "boom", "iteration": 2}]
    )
    summary = {"status": "failed", "records": records, "startedAt": "x", "durationMs": 100}
    report = condense_summary(
        summary, flow_name="f", environment_name="staging",
        max_field_chars=20, max_records=5, warnings=["no environment"],
    )
    assert report["counts"] == {"success": 10, "failed": 1, "skipped": 0}
    assert report["failures"] == [{"nodeName": "bad", "iteration": 2, "error": "boom"}]
    assert report["recordsOmitted"] == 11 - len(report["records"])
    # every failure survives truncation
    assert any(r["nodeName"] == "bad" for r in report["records"])
    assert report["warnings"] == ["no environment"]
    # oversized outputs replaced by the truncation marker
    kept_success = next(r for r in report["records"] if r["status"] == "success")
    assert kept_success["outputs"].get("_truncated") is True
