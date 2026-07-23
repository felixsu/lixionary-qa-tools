import re
import hmac
import hashlib
import pytest
from services.executor import interpolate_variables, resolve_input_bindings, extract_jwt_expiry, resolve_request
from datetime import datetime, timedelta, timezone

def test_interpolate_variables():
    variables = {"BASE_URL": "https://api.example.com", "USER_ID": "12345"}

    url = "{{env.BASE_URL}}/users/{{env.USER_ID}}"
    result = interpolate_variables(url, variables)
    assert result == "https://api.example.com/users/12345"

    # Bare tokens no longer read the environment — they are request inputs.
    assert interpolate_variables("{{BASE_URL}}/path", variables) == "{{BASE_URL}}/path"

    # Bare tokens resolve from the inputs dict.
    assert interpolate_variables("ref-{{order_ref}}", variables, {"order_ref": "A1"}) == "ref-A1"

    # Unknown env var and unbound input are left untouched.
    assert interpolate_variables("{{env.NOT_FOUND}}/{{missing}}", variables, {}) == "{{env.NOT_FOUND}}/{{missing}}"

def test_resolve_input_bindings():
    env = {"BASE_URL": "https://api.example.com"}

    # Literal passthrough
    assert resolve_input_bindings([{"name": "ref", "source": "literal", "value": "A-1"}], env) == {"ref": "A-1"}

    # Literal values may contain env and $ tokens (one level, no input recursion)
    resolved = resolve_input_bindings(
        [{"name": "path", "source": "literal", "value": "{{env.BASE_URL}}/x-{{$randomInt:2}}"}], env
    )
    assert re.fullmatch(r"https://api\.example\.com/x-[1-9]\d", resolved["path"])

    # Generator binding
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
    resolved = resolve_input_bindings([{"name": "when", "source": "generator", "value": "$date:+1d"}], env)
    assert resolved["when"] == tomorrow

    # Malformed generator falls back to the raw value; empty names are skipped
    resolved = resolve_input_bindings(
        [{"name": "bad", "source": "generator", "value": "$bogus"}, {"name": "", "value": "x"}], env
    )
    assert resolved == {"bad": "$bogus"}

def test_interpolate_variables_dynamic_tokens():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    assert interpolate_variables("{{$date:YYYY-MM-DD}}", {}) == today

    random_int = interpolate_variables("{{$randomInt:4}}", {})
    assert re.fullmatch(r"[1-9]\d{3}", random_int)

    ranged_int = int(interpolate_variables("{{$randomInt:1:5}}", {}))
    assert 1 <= ranged_int <= 5

    email = interpolate_variables("{{$randomEmail}}", {})
    assert "@" in email

    # Unknown dynamic token is left untouched, same fallback as an unresolved variable.
    assert interpolate_variables("{{$bogus}}", {}) == "{{$bogus}}"

    # Dynamic tokens, env vars, and inputs can mix in the same string.
    mixed = interpolate_variables("{{env.VAR}} {{who}} FLX-{{$randomInt:4}}", {"VAR": "hi"}, {"who": "bob"})
    assert re.fullmatch(r"hi bob FLX-[1-9]\d{3}", mixed)

def test_interpolate_variables_date_math():
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
    assert interpolate_variables("{{$date:+1d}}", {}) == tomorrow

    two_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime("%Y-%m-%d %H:%M")
    result = interpolate_variables("{{$date:-2h:YYYY-MM-DD HH:mm}}", {})
    assert result == two_hours_ago

    chained_expected = (datetime.now(timezone.utc) + timedelta(days=1) - timedelta(hours=3)).strftime("%Y-%m-%d %H:%M")
    chained_result = interpolate_variables("{{$date:+1d-3h:YYYY-MM-DD HH:mm}}", {})
    assert chained_result == chained_expected

    # A malformed offset-looking arg falls back to being treated as a literal format string.
    assert interpolate_variables("{{$date:+bogus}}", {}) == "+bogus"

async def test_resolve_request():
    result = await resolve_request({
        "url": "{{env.BASE_URL}}/orders",
        "method": "POST",
        "headers": [{"key": "X-Test", "value": "{{$randomInt:2}}"}],
        "queryParams": [{"key": "q", "value": "{{$randomEmail}}"}],
        "bodyType": "JSON",
        "body": '{"tracking_id": "FLX-{{$randomInt:4}}", "ref": "{{tracking}}"}',
        "authType": "BEARER",
        "authConfig": {"token": "tok-{{$randomInt:4}}"},
        "inputs": [{"name": "tracking", "source": "literal", "value": "T-1"}],
    }, None)

    assert result["url"] == "{{env.BASE_URL}}/orders"  # no environment given, left unresolved
    assert re.fullmatch(r"[1-9]\d", result["headers"]["X-Test"])
    assert "@" in result["params"]["q"]
    assert re.fullmatch(r'\{"tracking_id": "FLX-[1-9]\d{3}", "ref": "T-1"\}', result["body"])
    assert re.fullmatch(r"Bearer tok-[1-9]\d{3}", result["headers"]["Authorization"])

async def test_resolve_request_with_interceptor_hmac_header():
    result = await resolve_request({
        "url": "https://api.example.com/orders",
        "method": "POST",
        "headers": [],
        "queryParams": [],
        "bodyType": "JSON",
        "body": '{"amount":100}',
        "authType": "NONE",
        "authConfig": {},
        "requestInterceptorScript": (
            "request.headers['X-Signature'] = crypto.hmac('sha256', 'my-secret', request.body, 'hex');"
        ),
    }, None)

    expected = hmac.new(b"my-secret", b'{"amount":100}', hashlib.sha256).hexdigest()
    assert result["headers"]["X-Signature"] == expected

async def test_resolve_request_interceptor_error_raises():
    with pytest.raises(ValueError, match="Request Interceptor Execution Failed"):
        await resolve_request({
            "url": "https://api.example.com/orders",
            "method": "GET",
            "headers": [],
            "queryParams": [],
            "bodyType": "NONE",
            "body": "",
            "authType": "NONE",
            "authConfig": {},
            "requestInterceptorScript": "request.headers['X'] = crypto.hmac('not-an-algo', 'k', 'm');",
        }, None)

def test_extract_jwt_expiry_fallback():
    # Invalid token should fallback to 1 hour from now
    expiry = extract_jwt_expiry("invalid-token-string")
    delta = expiry - datetime.now(timezone.utc)
    assert 3500 < delta.total_seconds() < 3700

async def test_get_valid_auth_token_caching():
    import json
    from unittest.mock import AsyncMock, patch
    from services.executor import get_valid_auth_token, auth_script_hash

    now = datetime.now(timezone.utc)
    script = "return 'new-token';"
    record = {
        "localId": "local-1",
        "cloudId": "cloud-1",
        "payload": json.dumps({"name": "Test Hook", "script": script, "expires_in": 3600}),
    }
    prefs: dict = {}

    def fake_get_pref(key):
        return prefs.get(key)

    def fake_set_pref(key, value):
        prefs[key] = value

    with patch("services.executor.LocalStore") as mock_store, \
         patch("services.executor.run_unsafe_auth_script", new_callable=AsyncMock) as mock_run:
        mock_store.get_by_local_or_cloud_id.return_value = record
        mock_store.get_pref.side_effect = fake_get_pref
        mock_store.set_pref.side_effect = fake_set_pref
        mock_run.return_value = "new-token"

        # 1. Valid cache hit: matching script hash, expires well in the future
        prefs["auth_token_cache:local-1"] = json.dumps({
            "token": "old-token",
            "expiresAt": (now + timedelta(seconds=100)).isoformat(),
            "scriptHash": auth_script_hash(script, 3600),
        })
        token = await get_valid_auth_token("local-1")
        assert token == "old-token"
        mock_run.assert_not_called()

        # Lookup by cloud id resolves the same record and the same cache entry
        token = await get_valid_auth_token("cloud-1")
        assert token == "old-token"
        mock_run.assert_not_called()

        # 2. Almost expired (within the 30s buffer) -> rerun and re-cache
        prefs["auth_token_cache:local-1"] = json.dumps({
            "token": "old-token",
            "expiresAt": (now + timedelta(seconds=10)).isoformat(),
            "scriptHash": auth_script_hash(script, 3600),
        })
        token = await get_valid_auth_token("local-1")
        assert token == "new-token"
        assert mock_run.call_count == 1
        assert json.loads(prefs["auth_token_cache:local-1"])["token"] == "new-token"

        # 3. Script hash mismatch (script/TTL changed since caching) -> rerun
        prefs["auth_token_cache:local-1"] = json.dumps({
            "token": "old-token",
            "expiresAt": (now + timedelta(seconds=100)).isoformat(),
            "scriptHash": auth_script_hash("return 'different';", 3600),
        })
        token = await get_valid_auth_token("local-1")
        assert token == "new-token"
        assert mock_run.call_count == 2

        # 4. Corrupt cache entry -> treated as a miss, not an error
        prefs["auth_token_cache:local-1"] = "not-json"
        token = await get_valid_auth_token("local-1")
        assert token == "new-token"
        assert mock_run.call_count == 3

        # 5. Dict token round-trips through the JSON cache
        mock_run.return_value = {"access_token": "abc", "refresh_token": "xyz"}
        prefs.pop("auth_token_cache:local-1", None)
        token = await get_valid_auth_token("local-1")
        assert token == {"access_token": "abc", "refresh_token": "xyz"}
        token = await get_valid_auth_token("local-1")  # second call served from cache
        assert token == {"access_token": "abc", "refresh_token": "xyz"}
        assert mock_run.call_count == 4

        # 6. Unknown (or deleted) auth function -> clear error
        mock_store.get_by_local_or_cloud_id.return_value = None
        try:
            await get_valid_auth_token("nope")
            assert False, "expected ValueError"
        except ValueError as e:
            assert "Auth function not found" in str(e)
