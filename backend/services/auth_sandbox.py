import json
import hmac
import hashlib
import base64
import httpx
import quickjs
from typing import Dict, Any, Tuple

_HASH_ALGOS = {"sha256": hashlib.sha256, "sha1": hashlib.sha1, "sha512": hashlib.sha512, "md5": hashlib.md5}

def _encode(data: bytes, encoding: str) -> str:
    return base64.b64encode(data).decode() if encoding == "base64" else data.hex()

def crypto_hmac(algorithm: str, secret: str, message: str, encoding: str = "hex") -> str:
    algo = _HASH_ALGOS.get(algorithm.lower())
    if not algo:
        raise ValueError(f"Unsupported HMAC algorithm: {algorithm}")
    return _encode(hmac.new(secret.encode(), message.encode(), algo).digest(), encoding)

def crypto_hash(algorithm: str, message: str, encoding: str = "hex") -> str:
    algo = _HASH_ALGOS.get(algorithm.lower())
    if not algo:
        raise ValueError(f"Unsupported hash algorithm: {algorithm}")
    return _encode(algo(message.encode()).digest(), encoding)

def crypto_base64_encode(value: str) -> str:
    return base64.b64encode(value.encode()).decode()

def crypto_base64_decode(value: str) -> str:
    return base64.b64decode(value).decode()

def python_fetch_handler(url: str, options_json: str = "{}") -> str:
    """
    Synchronous HTTP fetch helper injected into the QuickJS sandbox.
    """
    try:
        options = json.loads(options_json)
    except Exception:
        options = {}

    method = options.get("method", "GET").upper()
    headers = options.get("headers", {})
    body = options.get("body", None)

    # Perform synchronous HTTP request using httpx
    with httpx.Client(timeout=5.0) as client:
        try:
            if method == "GET":
                response = client.get(url, headers=headers)
            elif method == "POST":
                # Check if body is string or dict
                if isinstance(body, str):
                    response = client.post(url, headers=headers, content=body)
                else:
                    response = client.post(url, headers=headers, json=body)
            elif method == "PUT":
                if isinstance(body, str):
                    response = client.put(url, headers=headers, content=body)
                else:
                    response = client.put(url, headers=headers, json=body)
            elif method == "DELETE":
                response = client.delete(url, headers=headers)
            else:
                return json.dumps({"error": f"Unsupported HTTP method: {method}"})

            return response.text
        except Exception as e:
            return json.dumps({"error": f"Fetch failed: {str(e)}"})

async def run_unsafe_auth_script(user_script: str, context_env: Dict[str, str]) -> str:
    """
    Runs untrusted JavaScript code securely inside a QuickJS isolate.
    Returns the evaluated string result.
    """
    # Create QuickJS context
    ctx = quickjs.Context()

    # Enforce basic constraints (set memory limit to 16MB)
    try:
        ctx.set_memory_limit(16 * 1024 * 1024)
    except AttributeError:
        # If the installed quickjs version doesn't support setting memory limit directly
        pass

    # Expose variables and standard helpers
    # Inject 'env' object
    ctx.eval(f"const env = {json.dumps(context_env)};")

    # Add 'python_fetch_callback' callback
    ctx.add_callable("python_fetch_callback", python_fetch_handler)

    # Define JS fetchToken wrapper that stringifies the options object
    ctx.eval("""
    const fetchToken = (url, options) => {
        return python_fetch_callback(url, JSON.stringify(options || {}));
    };
    """)

    # Expose a global console object for logging/debugging
    ctx.eval("const console = { log: function(...args) { return args.join(' '); } };")

    # Wrap user script in a self-executing function
    wrapped_script = f"""
    (function() {{
        try {{
            {user_script}
        }} catch(e) {{
            return 'ERROR: ' + e.message;
        }}
    }})()
    """

    # Execute inside context
    try:
        result = ctx.eval(wrapped_script)
        return str(result)
    except Exception as e:
        return f"ERROR: Execution failed: {str(e)}"

async def run_unsafe_response_parser(response_body: str, response_headers: Dict[str, str], parser_script: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Runs a response parser script on an HTTP response.
    Injects 'response', an 'output' object for declared request outputs, and an
    'env' storage object ('vars' kept as a deprecated alias) for environment writes.
    Returns (outputs, env_writes).
    """
    ctx = quickjs.Context()

    # Store set variables
    extracted_vars = {}

    def vars_set_handler(key: str, value: Any):
        extracted_vars[key] = value

    ctx.add_callable("python_vars_set", vars_set_handler)
    # Coerce values on the JS side: the quickjs->Python bridge only accepts
    # primitives, so objects/arrays are JSON-stringified and null/undefined
    # become empty strings instead of raising a conversion error.
    ctx.eval("""
    const env = {
        set: function(key, val) {
            if (val === null || val === undefined) {
                python_vars_set(String(key), "");
                return;
            }
            python_vars_set(String(key), typeof val === "object" ? JSON.stringify(val) : val);
        }
    };
    const vars = env;
    const output = {};
    """)

    # Try parsing response body as JSON
    try:
        parsed_body = json.loads(response_body)
    except Exception:
        parsed_body = response_body

    response_obj = {
        "body": parsed_body,
        "headers": response_headers
    }

    # Merge parsed JSON body keys directly into response_obj to support direct access (e.g. response.data)
    if isinstance(parsed_body, dict):
        for k, v in parsed_body.items():
            if k not in response_obj:
                response_obj[k] = v

    # Inject response context
    ctx.eval(f"const response = {json.dumps(response_obj)};")

    # Wrap script and run
    wrapped_script = f"""
    (function() {{
        try {{
            {parser_script}
            return "SUCCESS";
        }} catch(e) {{
            return "ERROR: " + e.message;
        }}
    }})()
    """

    try:
        status = ctx.eval(wrapped_script)
        if str(status).startswith("ERROR:"):
            raise ValueError(status)
        outputs = json.loads(ctx.eval("JSON.stringify(output)") or "{}")
        return outputs, extracted_vars
    except Exception as e:
        raise RuntimeError(f"Parser execution failed: {str(e)}")

async def run_unsafe_request_interceptor(script: str, request_obj: Dict[str, Any], context_env: Dict[str, str]) -> Dict[str, Any]:
    """
    Runs the Request Interceptor script before a request is dispatched. Injects
    a mutable `request` (url/method/headers/params/body/bodyType — only
    url/headers/params/body are read back and applied; method/bodyType are
    read-only context), a read-only `env`, a stub `console`, and a `crypto`
    helper object (hmac/hash/base64Encode/base64Decode). Returns the mutated
    {url, headers, params, body} dict.
    """
    ctx = quickjs.Context()
    try:
        ctx.set_memory_limit(16 * 1024 * 1024)
    except AttributeError:
        pass

    ctx.eval(f"const env = {json.dumps(context_env)};")
    ctx.eval(f"const request = {json.dumps(request_obj)};")
    ctx.eval("const console = { log: function(...args) { return args.join(' '); } };")

    ctx.add_callable("python_crypto_hmac", crypto_hmac)
    ctx.add_callable("python_crypto_hash", crypto_hash)
    ctx.add_callable("python_crypto_b64encode", crypto_base64_encode)
    ctx.add_callable("python_crypto_b64decode", crypto_base64_decode)
    ctx.eval("""
    const crypto = {
        hmac: (algorithm, secret, message, encoding) => python_crypto_hmac(algorithm, secret, message, encoding || "hex"),
        hash: (algorithm, message, encoding) => python_crypto_hash(algorithm, message, encoding || "hex"),
        base64Encode: (value) => python_crypto_b64encode(String(value)),
        base64Decode: (value) => python_crypto_b64decode(String(value)),
    };
    """)

    wrapped_script = f"""
    (function() {{
        try {{
            {script}
            return "SUCCESS";
        }} catch(e) {{
            return "ERROR: " + e.message;
        }}
    }})()
    """

    try:
        status = ctx.eval(wrapped_script)
        if str(status).startswith("ERROR:"):
            raise ValueError(status)
        mutated = json.loads(ctx.eval("JSON.stringify(request)") or "{}")
    except Exception as e:
        raise RuntimeError(f"ERROR: {str(e)}")

    headers = {str(k): str(v) for k, v in (mutated.get("headers") or {}).items()}
    params = {str(k): str(v) for k, v in (mutated.get("params") or {}).items()}
    body = mutated.get("body", request_obj.get("body", ""))
    if not isinstance(body, str):
        body = json.dumps(body)

    return {"url": mutated.get("url", request_obj.get("url", "")), "headers": headers, "params": params, "body": body}
