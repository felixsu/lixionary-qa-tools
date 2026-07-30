"""Tests for the studio-assistant response validation and chat normalization."""

from routes.local_ai import _validate_assistant_response
from services.llm_provider import normalize_messages


def test_validate_assistant_response_shapes():
    # Valid proposal passes through untouched.
    valid = (
        '{"message": "Plan below.", "actions": ['
        '{"type": "create_flow", "name": "Smoke"},'
        '{"type": "add_node", "nodeType": "request", "name": "getUuid",'
        ' "config": {"requestName": "Get UUID", "mappings": [{"inputName": "x", "source": "reference", "value": "a.b"}]}},'
        '{"type": "add_node", "nodeType": "delay", "name": "wait", "config": {"ms": 500}},'
        '{"type": "add_node", "nodeType": "looper", "name": "loop",'
        ' "config": {"itemsSource": "static", "itemsValue": "[1,2]", "request": {"requestName": "Get item", "mappings": []}}},'
        '{"type": "add_node", "nodeType": "verifier", "name": "check",'
        ' "config": {"request": {"requestName": "Get order"}, "comparisons": [{"field": "status", "operator": "equals", "expected": "200"}],'
        ' "maxAttempts": 3, "intervalMs": 1000}},'
        '{"type": "update_node", "name": "wait", "config": {"ms": 900}},'
        '{"type": "connect", "from": "getUuid", "to": "wait"}'
        "]}"
    )
    result = _validate_assistant_response(valid)
    assert result["parseError"] is False
    assert result["message"] == "Plan below."
    assert len(result["actions"]) == 7

    # Markdown fences are stripped before parsing.
    fenced = "```json\n{\"message\": \"hi\", \"actions\": []}\n```"
    result = _validate_assistant_response(fenced)
    assert result["parseError"] is False and result["message"] == "hi" and result["actions"] == []

    # Plain text becomes an action-less clarification turn.
    result = _validate_assistant_response("Which request should the flow start with?")
    assert result["parseError"] is True
    assert result["actions"] == []
    assert "Which request" in result["message"]

    # One malformed action drops the whole list (atomic), message survives.
    bad_action = '{"message": "Plan.", "actions": [{"type": "add_node", "nodeType": "webhook", "name": "x", "config": {}}]}'
    result = _validate_assistant_response(bad_action)
    assert result["parseError"] is True and result["actions"] == []
    assert result["message"].startswith("Plan.")

    # Bad mapping source rejects too.
    bad_mapping = (
        '{"message": "m", "actions": [{"type": "add_node", "nodeType": "request", "name": "a",'
        ' "config": {"requestName": "R", "mappings": [{"inputName": "x", "source": "magic", "value": ""}]}}]}'
    )
    assert _validate_assistant_response(bad_mapping)["actions"] == []

    # create_flow anywhere but first drops the list.
    late_create = (
        '{"message": "m", "actions": [{"type": "connect", "from": "a", "to": "b"},'
        ' {"type": "create_flow", "name": "F"}]}'
    )
    result = _validate_assistant_response(late_create)
    assert result["parseError"] is True and result["actions"] == []

    # Missing message → degraded turn, never a crash.
    result = _validate_assistant_response('{"actions": []}')
    assert result["parseError"] is True


def test_normalize_messages_merges_roles():
    merged = normalize_messages(
        [
            {"role": "user", "content": "build a flow"},
            {"role": "assistant", "content": '{"message": "done", "actions": []}'},
            {"role": "user", "content": "[Applied all 3 proposed actions to the canvas.]"},
            {"role": "user", "content": "now add a verifier"},
            {"role": "user", "content": "   "},  # dropped
            {"role": "system", "content": "ignored role"},  # dropped
        ]
    )
    assert [m["role"] for m in merged] == ["user", "assistant", "user"]
    assert "[Applied all 3" in merged[2]["content"] and "now add a verifier" in merged[2]["content"]
