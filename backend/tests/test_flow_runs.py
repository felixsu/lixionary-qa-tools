"""Tests for the flow-run history: LocalStore.flow_runs against a real
temp-file SQLite DB, and the /api/flow-runs route handlers against the
FakeStore from test_mcp_tools (same monkeypatch idiom).
"""

import json
import os
import tempfile

from fastapi import HTTPException

from tests.test_mcp_tools import FakeStore


def test_flow_runs_store_roundtrip():
    import db.local_store as ls

    original_conn = ls.LocalStore._conn
    original_db_path = ls.DB_PATH
    tmpdir = tempfile.mkdtemp()
    ls.DB_PATH = os.path.join(tmpdir, "test-local.db")
    ls.LocalStore._conn = None
    try:
        ls.LocalStore.connect()
        store = ls.LocalStore

        def insert(run_id, started_at, status, duration_ms=None, summary_json=None, flow="flow-1"):
            store.insert_flow_run(
                run_id, flow_local_id=flow, flow_name="Smoke Flow",
                environment_local_id=None, environment_name=None,
                source="mcp", status=status, node_count=2, started_at=started_at,
                duration_ms=duration_ms, summary_json=summary_json,
            )

        # running row: listed newest-first, no report yet
        insert("r1", "2026-01-01T00:00:01+00:00", "running")
        rows = store.list_flow_runs()
        assert [r["run_id"] for r in rows] == ["r1"]
        assert not rows[0]["has_report"]
        assert rows[0]["avg_duration_ms"] is None

        # finalize fills status/duration/summary and corrects started_at
        store.finalize_flow_run(
            "r1", status="success", duration_ms=100,
            summary_json=json.dumps({"status": "success", "records": []}),
            started_at="2026-01-01T00:00:02+00:00",
        )
        row = store.get_flow_run("r1")
        assert row["status"] == "success"
        assert row["duration_ms"] == 100
        assert row["started_at"] == "2026-01-01T00:00:02+00:00"
        assert json.loads(row["summary_json"])["status"] == "success"

        # avg is over successful runs only
        insert("r2", "2026-01-01T00:00:03+00:00", "success", duration_ms=200, summary_json="{}")
        insert("r3", "2026-01-01T00:00:04+00:00", "failed", duration_ms=999, summary_json="{}")
        rows = store.list_flow_runs()
        assert all(r["avg_duration_ms"] == 150 for r in rows)  # (100+200)/2, 999 excluded

        # prune keeps the newest N but never a running row
        insert("r0", "2026-01-01T00:00:00+00:00", "running")  # oldest, still running
        store.prune_flow_runs(keep=2)
        remaining = {r["run_id"] for r in store.list_flow_runs()}
        assert remaining == {"r0", "r3", "r2"}  # r1 pruned, running r0 protected

        # startup cleanup flips orphaned running rows to failed
        store.fail_stale_flow_runs()
        assert store.get_flow_run("r0")["status"] == "failed"
        assert store.get_flow_run("r0")["duration_ms"] is None
    finally:
        if ls.LocalStore._conn is not None:
            ls.LocalStore._conn.close()
        ls.LocalStore._conn = original_conn
        ls.DB_PATH = original_db_path


async def test_flow_runs_routes():
    import routes.flow_runs as fr

    class RouteFakeStore(FakeStore):
        @staticmethod
        def _now():
            return "2026-01-01T00:00:00+00:00"

    store = RouteFakeStore()
    original = fr.LocalStore
    fr.LocalStore = store
    try:
        summary = {
            "status": "success",
            "startedAt": "2026-01-01T00:00:01+00:00",
            "durationMs": 1234,
            "records": [{"nodeId": "n1", "nodeName": "getUuid", "nodeType": "request",
                         "status": "success", "startedAt": "2026-01-01T00:00:01+00:00",
                         "durationMs": 1234, "resolvedInputs": {}, "outputs": None,
                         "requestPayload": None, "response": None}],
            "context": {"getUuid": {"uuid": "u-1"}},
        }
        created = await fr.register_run(fr.RegisterRunPayload(
            flowLocalId="flow-1", flowName="Smoke Flow", nodeCount=1, summary=summary,
        ))
        assert created["source"] == "user"
        assert created["status"] == "success"
        assert created["durationMs"] == 1234
        assert created["nodeCount"] == 1
        assert created["hasReport"] is True

        # stored summary went through shrink_summary (context dropped)
        stored = json.loads(store.get_flow_run(created["runId"])["summary_json"])
        assert "context" not in stored
        assert stored["records"][0]["nodeName"] == "getUuid"

        # list + detail round-trip in camelCase
        listed = await fr.list_runs(limit=20)
        assert [r["runId"] for r in listed] == [created["runId"]]
        detail = await fr.get_run(created["runId"])
        assert detail["summary"]["status"] == "success"

        # a summary still 'running' is not registrable
        try:
            await fr.register_run(fr.RegisterRunPayload(
                flowLocalId="flow-1", flowName="Smoke Flow", nodeCount=1,
                summary={"status": "running"},
            ))
            raise AssertionError("expected 400 for running summary")
        except HTTPException as e:
            assert e.status_code == 400

        # unknown run id 404s
        try:
            await fr.get_run("nope")
            raise AssertionError("expected 404 for unknown run")
        except HTTPException as e:
            assert e.status_code == 404
    finally:
        fr.LocalStore = original
