import json
import httpx
import quickjs
from typing import Dict, Any

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

async def run_unsafe_response_parser(response_body: str, response_headers: Dict[str, str], parser_script: str) -> Dict[str, Any]:
    """
    Runs a response parser script on an HTTP response.
    Injects 'response' and a custom 'vars' storage object.
    Returns the variables that were extracted.
    """
    ctx = quickjs.Context()
    
    # Store set variables
    extracted_vars = {}
    
    def vars_set_handler(key: str, value: Any):
        extracted_vars[key] = value

    ctx.add_callable("python_vars_set", vars_set_handler)
    ctx.eval("""
    const vars = {
        set: function(key, val) {
            python_vars_set(key, val);
        }
    };
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
        return extracted_vars
    except Exception as e:
        raise RuntimeError(f"Parser execution failed: {str(e)}")
