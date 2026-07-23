import random
import re
import time
import json
import hashlib
import jwt
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional, Union
import httpx

from db.local_store import LocalStore
from services.auth_sandbox import run_unsafe_auth_script, run_unsafe_response_parser, run_unsafe_request_interceptor

_DATE_FORMAT_TOKENS = [
    ("YYYY", "%Y"), ("YY", "%y"),
    ("MM", "%m"), ("DD", "%d"),
    ("HH", "%H"), ("mm", "%M"), ("ss", "%S"),
]

_OFFSET_UNIT_TO_KWARG = {"d": "days", "h": "hours", "m": "minutes", "s": "seconds"}
_OFFSET_CHAIN_RE = re.compile(r"^((?:[+-]\d+[dhms])+)(?::(.*))?$", re.DOTALL)
_OFFSET_SEGMENT_RE = re.compile(r"([+-]\d+)([dhms])")

_RANDOM_FIRST_NAMES = [
    "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda",
    "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
    "Thomas", "Sarah", "Charles", "Karen",
]
_RANDOM_LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
    "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas",
    "Taylor", "Moore", "Jackson", "Martin",
]

def _format_date(arg: Optional[str]) -> str:
    """
    arg may be a plain format string ("YYYY-MM-DD"), a chain of signed offsets
    ("+3d", "-30m", "+1d-2h"), or an offset chain followed by ":format". Offsets
    are applied as a single timedelta on top of the current UTC time.
    """
    fmt = "YYYY-MM-DD"
    offset_kwargs: Dict[str, int] = {}

    if arg:
        if arg[0] in "+-":
            m = _OFFSET_CHAIN_RE.match(arg)
            if m:
                chain, rest_fmt = m.group(1), m.group(2)
                for num, unit in _OFFSET_SEGMENT_RE.findall(chain):
                    kw = _OFFSET_UNIT_TO_KWARG[unit]
                    offset_kwargs[kw] = offset_kwargs.get(kw, 0) + int(num)
                if rest_fmt is not None:
                    fmt = rest_fmt
            else:
                fmt = arg
        else:
            fmt = arg

    pattern = fmt
    for token, directive in _DATE_FORMAT_TOKENS:
        pattern = pattern.replace(token, directive)
    dt = datetime.now(timezone.utc) + timedelta(**offset_kwargs)
    return dt.strftime(pattern)

def _random_int(arg: Optional[str]) -> Optional[str]:
    if arg is None:
        return str(random.randint(0, 999))
    if ":" in arg:
        parts = arg.split(":")
        if len(parts) != 2:
            return None
        lo, hi = parts
        if not (lo.strip().lstrip("-").isdigit() and hi.strip().lstrip("-").isdigit()):
            return None
        lo, hi = int(lo), int(hi)
        if lo > hi:
            return None
        return str(random.randint(lo, hi))
    if not arg.isdigit() or int(arg) < 1:
        return None
    length = int(arg)
    if length == 1:
        return str(random.randint(0, 9))
    return str(random.randint(1, 9)) + "".join(str(random.randint(0, 9)) for _ in range(length - 1))

def _random_email(domain: Optional[str]) -> str:
    local = f"{random.choice(_RANDOM_FIRST_NAMES).lower()}.{random.choice(_RANDOM_LAST_NAMES).lower()}{random.randint(1, 999)}"
    return f"{local}@{domain or 'example.com'}"

_DYNAMIC_TOKEN_HANDLERS = {
    "date": lambda arg: _format_date(arg),
    "randomint": lambda arg: _random_int(arg),
    "randomemail": lambda arg: _random_email(arg),
    "randomfirstname": lambda arg: random.choice(_RANDOM_FIRST_NAMES),
    "randomlastname": lambda arg: random.choice(_RANDOM_LAST_NAMES),
    "randomfullname": lambda arg: f"{random.choice(_RANDOM_FIRST_NAMES)} {random.choice(_RANDOM_LAST_NAMES)}",
}

def _resolve_dynamic_token(key: str) -> Optional[str]:
    """
    Resolves a $-prefixed dynamic token (e.g. "$date:YYYY-MM-DD", "$randomInt:4") to its
    generated value, or None if the token is unrecognized/malformed.
    """
    body = key[1:]
    if ":" in body:
        fn_name, arg = body.split(":", 1)
    else:
        fn_name, arg = body, None
    handler = _DYNAMIC_TOKEN_HANDLERS.get(fn_name.lower())
    if not handler:
        return None
    return handler(arg)

def interpolate_variables(text: str, env_vars: Dict[str, str], inputs: Optional[Dict[str, str]] = None) -> str:
    """
    Replaces all occurrences of {{key}} in text. Token grammar:
      {{env.NAME}}       -> environment variable NAME
      {{$generator:arg}} -> dynamic token (e.g. {{$date:YYYY-MM-DD}}, {{$randomInt:4}})
      {{name}}           -> request input, resolved from the request's input bindings
    Unresolved/unrecognized tokens are left untouched.
    """
    if not text:
        return text

    def replacer(match):
        key = match.group(1).strip()
        if key.startswith("$"):
            resolved = _resolve_dynamic_token(key)
            return resolved if resolved is not None else match.group(0)
        if key.startswith("env."):
            return env_vars.get(key[4:].strip(), match.group(0))
        return (inputs or {}).get(key, match.group(0))

    return re.sub(r"\{\{([^}]+)\}\}", replacer, text)

def resolve_input_bindings(bindings: List[Dict[str, Any]], env_vars: Dict[str, str]) -> Dict[str, str]:
    """
    Resolves a request's saved input bindings into concrete values, once per run
    (a generator input used in several places gets the same value within one run).
    Literal values may themselves contain {{env.X}} / {{$...}} tokens (no input recursion).
    """
    resolved: Dict[str, str] = {}
    for binding in bindings or []:
        name = (binding.get("name") or "").strip()
        if not name:
            continue
        value = binding.get("value") or ""
        if binding.get("source") == "generator":
            generated = _resolve_dynamic_token(value) if value.startswith("$") else None
            resolved[name] = generated if generated is not None else value
        else:
            resolved[name] = interpolate_variables(value, env_vars)
    return resolved

def extract_jwt_expiry(token: str) -> datetime:
    """
    Decodes JWT token (without signature validation) to extract expiration claim (exp).
    Defaults to 1 hour from now if invalid or missing.
    """
    try:
        # Decode JWT payload
        payload = jwt.decode(token, options={"verify_signature": False})
        exp = payload.get("exp")
        if exp:
            return datetime.fromtimestamp(exp, tz=timezone.utc)
    except Exception:
        pass
    
    # Default fallback: 1 hour
    return datetime.now(timezone.utc) + timedelta(hours=1)

def load_env_vars(environment_ref: Optional[str]) -> Dict[str, str]:
    """
    Loads the variables of an environment from the local store as {key: value}.
    `environment_ref` may be a device-local id or a cloud id. A missing ref or
    unknown environment resolves to {} — the run proceeds without variables,
    matching the cloud executor's old silent-fallback behavior.
    """
    if not environment_ref:
        return {}
    record = LocalStore.get_by_local_or_cloud_id("environment", environment_ref)
    if not record:
        return {}
    try:
        payload = json.loads(record["payload"])
    except Exception:
        return {}
    return {v["key"]: v["value"] for v in payload.get("variables", []) if v.get("key")}

def _auth_cache_key(local_id: str) -> str:
    return f"auth_token_cache:{local_id}"

def auth_script_hash(script: str, expires_in: Optional[int]) -> str:
    """Cache-invalidation fingerprint: a change to the script or its configured
    TTL (whether edited locally or synced in from another device) must force a
    re-run — this replaces the cloud's PUT-time cachedToken reset."""
    return hashlib.sha256(f"{script or ''}\n{expires_in}".encode()).hexdigest()

def read_cached_auth_token(record: Dict[str, Any]) -> Optional[Union[str, Dict[str, Any]]]:
    """Returns the cached token for an auth-function record if it is still
    valid (matching script hash, well-formed, >30s from expiry), else None."""
    raw = LocalStore.get_pref(_auth_cache_key(record["localId"]))
    if not raw:
        return None
    try:
        entry = json.loads(raw)
        payload = json.loads(record["payload"])
        if entry.get("scriptHash") != auth_script_hash(payload.get("script", ""), payload.get("expires_in")):
            return None
        expires_at = datetime.fromisoformat(entry["expiresAt"])
    except Exception:
        return None
    if expires_at <= datetime.now(timezone.utc) + timedelta(seconds=30):
        return None
    token = entry.get("token")
    return token if token else None

async def get_valid_auth_token(auth_func_ref: str, environment_ref: Optional[str] = None) -> Union[str, Dict[str, Any]]:
    """
    Resolves the valid auth token for the given auth function (local or cloud id).
    If the cached token is missing, expired, almost expired (within 30 seconds),
    or the script/TTL changed since it was cached, reruns the sandbox script,
    caches the result in device-local prefs (never synced), and returns it. The
    result is either a plain string or a dict, depending on what the auth
    function's script returned.
    """
    record = LocalStore.get_by_local_or_cloud_id("auth_function", auth_func_ref)
    if not record:
        raise ValueError(f"Auth function not found: {auth_func_ref}")

    cached_token = read_cached_auth_token(record)
    if cached_token is not None:
        return cached_token

    payload = json.loads(record["payload"])
    script = payload.get("script", "")
    expires_in = payload.get("expires_in")
    print(f"Auth function cache miss/expiry/almost expired for: {payload.get('name')}. Running sandbox...")

    new_token = await run_unsafe_auth_script(script, load_env_vars(environment_ref))

    if isinstance(new_token, str) and new_token.startswith("ERROR:"):
        raise ValueError(f"Auth Hook Execution Failed: {new_token}")

    # Compute expiry. Object results have no field-guessing for JWT
    # decoding, so they rely on the function's configured expires_in
    # (or the same 1-hour default extract_jwt_expiry falls back to).
    now = datetime.now(timezone.utc)
    if expires_in is not None and expires_in > 0:
        token_expiry = now + timedelta(seconds=expires_in)
    elif isinstance(new_token, str):
        token_expiry = extract_jwt_expiry(new_token)
    else:
        token_expiry = now + timedelta(hours=1)

    LocalStore.set_pref(_auth_cache_key(record["localId"]), json.dumps({
        "token": new_token,
        "expiresAt": token_expiry.isoformat(),
        "scriptHash": auth_script_hash(script, expires_in),
    }))
    print(f"Token cached. Expiration set to: {token_expiry}")

    return new_token

async def resolve_request(request_data: Dict[str, Any], environment_id: str = None) -> Dict[str, Any]:
    """
    Loads active environment variables and interpolates URL, headers, query params,
    body, and auth config (including firing an Auth Hook script if configured) into
    their fully-resolved values. Does not dispatch any HTTP call.
    """
    # 1. Load active environment variables
    variables = load_env_vars(environment_id)

    # 2. Resolve input bindings once per run, then interpolate URL, headers, query params, body
    inputs = resolve_input_bindings(request_data.get("inputs") or [], variables)

    url = interpolate_variables(request_data.get("url", ""), variables, inputs)

    headers = {}
    for h in request_data.get("headers", []):
        if h.get("key"):
            headers[h["key"]] = interpolate_variables(h.get("value", ""), variables, inputs)

    params = {}
    for p in request_data.get("queryParams", []):
        if p.get("key"):
            params[p["key"]] = interpolate_variables(p.get("value", ""), variables, inputs)

    body_type = request_data.get("bodyType", "NONE").upper()
    body_content = request_data.get("body", "")

    # Interpolate body if JSON or TEXT
    if body_type in ["JSON", "RAW", "TEXT"] and body_content:
        body_content = interpolate_variables(body_content, variables, inputs)

    # 3. Handle Authentication Hook
    auth_type = request_data.get("authType", "NONE").upper()
    auth_config = request_data.get("authConfig", {})

    if auth_type in ("HOOK", "AUTH_HOOK") and auth_config.get("authFunctionId"):
        auth_func_id = auth_config["authFunctionId"]
        resolved_token = await get_valid_auth_token(auth_func_id, environment_id)
        if isinstance(resolved_token, dict):
            token_field = auth_config.get("tokenField")
            if not token_field:
                raise ValueError(
                    "Auth function returned multiple fields; set a Token field in the "
                    "Auth Hook config to pick which one to use as the Bearer token."
                )
            if token_field not in resolved_token:
                raise ValueError(f"Auth function result has no field named '{token_field}'.")
            cached_token = resolved_token[token_field]
        else:
            cached_token = resolved_token
        headers["Authorization"] = f"Bearer {cached_token}"

    elif auth_type == "BEARER" and auth_config.get("token"):
        token_val = interpolate_variables(auth_config["token"], variables, inputs)
        headers["Authorization"] = f"Bearer {token_val}"

    elif auth_type == "API_KEY" and auth_config.get("key") and auth_config.get("value"):
        key_name = interpolate_variables(auth_config["key"], variables, inputs)
        key_val = interpolate_variables(auth_config["value"], variables, inputs)
        headers[key_name] = key_val

    # 4. Run Request Interceptor script (after auth, so it can see/modify the
    # final Authorization header — e.g. to compute an HMAC over headers+body)
    interceptor_script = request_data.get("requestInterceptorScript")
    if interceptor_script:
        request_obj = {
            "url": url,
            "method": request_data.get("method", "GET").upper(),
            "headers": headers,
            "params": params,
            "body": body_content,
            "bodyType": body_type,
        }
        try:
            mutated = await run_unsafe_request_interceptor(interceptor_script, request_obj, variables)
        except Exception as e:
            raise ValueError(f"Request Interceptor Execution Failed: {str(e)}")
        url, headers, params, body_content = mutated["url"], mutated["headers"], mutated["params"], mutated["body"]

    return {"url": url, "headers": headers, "params": params, "body": body_content}

async def execute_request(request_data: Dict[str, Any], environment_id: str = None) -> Dict[str, Any]:
    """
    Runs the full Request Execution Loop:
    1. Resolves URL, headers, query params, body, and auth via resolve_request().
    2. Executes the HTTP call via async proxy client.
    3. Evaluates Response Parser script.
    4. Returns execution statistics, headers, body, and extracted variables.
    """
    resolved = await resolve_request(request_data, environment_id)
    url = resolved["url"]
    headers = resolved["headers"]
    params = resolved["params"]
    body_content = resolved["body"]
    method = request_data.get("method", "GET").upper()
    body_type = request_data.get("bodyType", "NONE").upper()

    # 4. Dispatch the HTTP Request
    start_time = time.time()
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            req_kwargs = {
                "method": method,
                "url": url,
                "headers": headers,
                "params": params
            }

            if body_type == "JSON" and body_content:
                try:
                    req_kwargs["json"] = json.loads(body_content)
                except json.JSONDecodeError:
                    req_kwargs["content"] = body_content
            elif body_type == "FORM" and body_content:
                try:
                    req_kwargs["data"] = json.loads(body_content)
                except json.JSONDecodeError:
                    req_kwargs["content"] = body_content
            elif body_content:
                req_kwargs["content"] = body_content

            response = await client.request(**req_kwargs)
            duration_ms = int((time.time() - start_time) * 1000)
            
            response_body = response.text
            response_headers = dict(response.headers)
            status_code = response.status_code
            status_text = response.reason_phrase

        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            return {
                "status": 500,
                "statusText": "Execution Error",
                "headers": {},
                "body": f"HTTP dispatch failed: {str(e)}",
                "executionTimeMs": duration_ms,
                "parsedVariables": {},
                "parserError": None,
                "outputs": {},
                "missingOutputs": []
            }

    # 5. Execute Response Parser Script
    declared_outputs = [o for o in (request_data.get("outputs") or []) if o]
    outputs_result = {}
    parsed_variables = {}
    parser_error = None
    parser_script = request_data.get("responseParserScript")
    if parser_script and response.status_code >= 400:
        parser_error = f"Parser skipped: response status {response.status_code}"
    elif parser_script:
        try:
            outputs_result, parsed_variables = await run_unsafe_response_parser(
                response_body=response_body,
                response_headers=response_headers,
                parser_script=parser_script
            )

            # If env writes were made, save them back to the active environment
            # in the local store. LocalStore.update bumps the record's version,
            # marking it dirty so the sync engine pushes the change to the cloud
            # on the next pass — the local-first equivalent of the old versioned
            # cloud write.
            if parsed_variables and environment_id:
                env_record = LocalStore.get_by_local_or_cloud_id("environment", environment_id)
                if env_record:
                    env_payload = json.loads(env_record["payload"])
                    updated_vars = {v["key"]: v for v in env_payload.get("variables", [])}

                    # Update or append parsed variables
                    for key, val in parsed_variables.items():
                        updated_vars[key] = {
                            "key": key,
                            "value": str(val),
                            "isSecret": False
                        }

                    env_payload["variables"] = list(updated_vars.values())
                    LocalStore.update("environment", env_record["localId"], json.dumps(env_payload))
        except Exception as e:
            parser_error = str(e)
            print(f"Response parser script run failed: {str(e)}")

    missing_outputs = [name for name in declared_outputs if name not in outputs_result]

    # Persist last extracted outputs per request (groundwork for request chaining)
    if declared_outputs and request_data.get("requestId"):
        try:
            LocalStore.set_pref(f"request_outputs:{request_data['requestId']}", json.dumps({
                "outputs": outputs_result,
                "missingOutputs": missing_outputs,
                "updatedAt": datetime.now(timezone.utc).isoformat()
            }))
        except Exception as e:
            print(f"Failed to persist request outputs: {str(e)}")

    # Try formatting body as JSON for client
    try:
        formatted_body = json.loads(response_body)
    except Exception:
        formatted_body = response_body

    return {
        "status": status_code,
        "statusText": status_text,
        "headers": response_headers,
        "body": formatted_body,
        "executionTimeMs": duration_ms,
        "parsedVariables": parsed_variables,
        "parserError": parser_error,
        "outputs": outputs_result,
        "missingOutputs": missing_outputs
    }
