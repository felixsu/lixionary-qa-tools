"""Tests for the MCP tool helpers in backend/mcp_server.py: name/id entity
resolution and the run_flow tool path end-to-end against a fake LocalStore
and a fake executor — no MCP client, no SQLite, no HTTP.

The `mcp` package is env-marker-gated to Python >= 3.10 in
sidecar_requirements.txt, so this whole module skips (mirroring the sidecar's
own guarded import) when it isn't installed.
"""

import asyncio
import json

try:
    import mcp  # noqa: F401
    MCP_AVAILABLE = True
except Exception:
    MCP_AVAILABLE = False


class FakeStore:
    """Duck-typed LocalStore stand-in: entity lists + a prefs dict."""

    def __init__(self, entities=None):
        self.entities = entities or {}  # entity_type -> [record]
        self.prefs = {}

    def list(self, entity_type):
        return list(self.entities.get(entity_type, []))

    def get_by_local_or_cloud_id(self, entity_type, ref):
        for record in self.entities.get(entity_type, []):
            if record["localId"] == ref or record.get("cloudId") == ref:
                return record
        return None

    def get_pref(self, key):
        return self.prefs.get(key)

    def set_pref(self, key, value):
        self.prefs[key] = value

    def delete_pref(self, key):
        self.prefs.pop(key, None)


def _record(local_id, payload, cloud_id=None):
    return {"localId": local_id, "cloudId": cloud_id, "payload": json.dumps(payload)}


def _seed_store():
    flow_payload = {
        "name": "Smoke Flow",
        "nodes": [
            {"id": "n1", "name": "getUuid", "type": "request", "position": {"x": 0, "y": 0},
             "config": {"requestId": "req-1", "mappings": []}},
        ],
        "edges": [],
    }
    return FakeStore({
        "flow": [_record("flow-1", flow_payload, cloud_id="cf-1")],
        "environment": [
            _record("env-1", {"name": "Staging", "variables": [
                {"key": "BASE_URL", "value": "https://x", "isSecret": False},
                {"key": "TOKEN", "value": "s3cret", "isSecret": True},
            ]}),
            _record("env-2", {"name": "Prod", "variables": []}),
        ],
        "collection": [_record("col-1", {
            "id": "col-1",
            "requests": [{
                "id": "req-1", "method": "GET", "url": "http://test/uuid",
                "headers": [], "queryParams": [], "bodyType": "none", "body": "",
                "authType": "none", "authConfig": {}, "inputs": [], "outputs": [],
            }],
        })],
    })


def _with_fake_store(store):
    import mcp_server
    original = mcp_server.LocalStore
    mcp_server.LocalStore = store
    return mcp_server, original


def test_resolve_entity_name_id_and_errors():
    from mcp.server.fastmcp.exceptions import ToolError

    store = _seed_store()
    # duplicate-named environment to exercise ambiguity
    store.entities["environment"].append(_record("env-3", {"name": "staging", "variables": []}))
    mcp_server, original = _with_fake_store(store)
    try:
        # exact name (case-insensitive) on a unique name
        record, payload = mcp_server.resolve_entity("flow", "smoke flow")
        assert record["localId"] == "flow-1" and payload["name"] == "Smoke Flow"

        # id fallback — local and cloud
        assert mcp_server.resolve_entity("flow", "flow-1")[0]["localId"] == "flow-1"
        assert mcp_server.resolve_entity("flow", "cf-1")[0]["localId"] == "flow-1"

        # ambiguous name lists candidate ids
        try:
            mcp_server.resolve_entity("environment", "Staging")
            raise AssertionError("expected ToolError for ambiguous name")
        except ToolError as e:
            assert "ambiguous" in str(e) and "env-1" in str(e) and "env-3" in str(e)

        # not-found lists available names
        try:
            mcp_server.resolve_entity("flow", "nope")
            raise AssertionError("expected ToolError for unknown flow")
        except ToolError as e:
            assert '"Smoke Flow"' in str(e)
    finally:
        mcp_server.LocalStore = original


def test_list_tools_shapes():
    store = _seed_store()
    mcp_server, original = _with_fake_store(store)
    try:
        envs = mcp_server.list_environments_data()
        assert {e["name"] for e in envs} == {"Staging", "Prod"}
        staging = next(e for e in envs if e["name"] == "Staging")
        # keys only — values (possibly secret) never leave the machine
        assert staging["variableKeys"] == ["BASE_URL", "TOKEN"]
        assert "s3cret" not in json.dumps(envs)

        flows = mcp_server.list_flows_data()
        assert flows == [{
            "id": "flow-1", "cloudId": "cf-1", "name": "Smoke Flow",
            "description": "", "nodeCount": 1, "nodeNames": ["getUuid"],
        }]
    finally:
        mcp_server.LocalStore = original


async def _run_flow_roundtrip():
    from mcp.server.fastmcp.exceptions import ToolError

    store = _seed_store()
    mcp_server, original = _with_fake_store(store)

    async def fake_executor(payload, environment_id):
        assert payload["requestId"] == "req-1"
        assert environment_id == "env-1"
        return {"status": 200, "statusText": "OK", "headers": {}, "body": {"uuid": "u-1"},
                "outputs": {"uuid": "u-1"}, "missingOutputs": []}

    try:
        result = await mcp_server.run_flow_impl("Smoke Flow", "staging", 60, executor=fake_executor)
        report = result["report"]
        assert report["status"] == "success"
        assert report["flowName"] == "Smoke Flow"
        assert report["environmentName"] == "Staging"
        assert report["counts"] == {"success": 1, "failed": 0, "skipped": 0}
        assert "warnings" not in report

        # persisted and retrievable, json + csv
        run_id = result["runId"]
        stored = mcp_server.get_run_report_data(run_id, "json")
        assert stored["flowName"] == "Smoke Flow"
        assert stored["summary"]["status"] == "success"
        csv = mcp_server.get_run_report_data(run_id, "csv")
        assert csv.splitlines()[0].startswith("node_name,node_type")
        assert "getUuid" in csv

        # a second run evicts the first (latest-per-flow retention)
        second = await mcp_server.run_flow_impl("flow-1", None, 60, executor=fake_executor2)
        assert any("No environment specified" in w for w in second["report"]["warnings"])
        try:
            mcp_server.get_run_report_data(run_id, "json")
            raise AssertionError("expected ToolError for evicted run")
        except ToolError as e:
            assert "not found" in str(e)
        assert mcp_server.get_run_report_data(second["runId"], "json")["runId"] == second["runId"]
    finally:
        mcp_server.LocalStore = original


async def fake_executor2(payload, environment_id):
    assert environment_id is None
    return {"status": 200, "statusText": "OK", "headers": {}, "body": None,
            "outputs": {}, "missingOutputs": []}


def run_mcp_tool_tests():
    """Entry point for run_tests.py — skips when `mcp` isn't installed."""
    if not MCP_AVAILABLE:
        print("~ mcp package not installed — skipping MCP tool tests")
        return
    test_resolve_entity_name_id_and_errors()
    print("✓ test_resolve_entity_name_id_and_errors passed")
    test_list_tools_shapes()
    print("✓ test_list_tools_shapes passed")
    asyncio.run(_run_flow_roundtrip())
    print("✓ test_run_flow_roundtrip passed")
