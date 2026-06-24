import re
import time
import json
import jwt
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List
import httpx
from bson import ObjectId

from db.mongo import MongoDB
from services.auth_sandbox import run_unsafe_auth_script, run_unsafe_response_parser

def interpolate_variables(text: str, variables: Dict[str, str]) -> str:
    """
    Replaces all occurrences of {{key}} in text with the matching value from variables.
    """
    if not text:
        return text
    
    def replacer(match):
        key = match.group(1).strip()
        return variables.get(key, match.group(0))
        
    return re.sub(r"\{\{([^}]+)\}\}", replacer, text)

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

async def execute_request(request_data: Dict[str, Any], environment_id: str = None) -> Dict[str, Any]:
    """
    Runs the full Request Execution Loop:
    1. Reads active environment variables.
    2. Performs variable interpolation.
    3. Runs Auth Hook functions if configured (caching tokens).
    4. Executes the HTTP call via async proxy client.
    5. Evaluates Response Parser script.
    6. Returns execution statistics, headers, body, and extracted variables.
    """
    # 1. Load active environment variables
    variables = {}
    if environment_id:
        env_col = MongoDB.get_collection("environments")
        env = await env_col.find_one({"_id": ObjectId(environment_id)})
        if env:
            for var in env.get("variables", []):
                variables[var["key"]] = var["value"]

    # 2. Interpolate URL, headers, query params, body
    url = interpolate_variables(request_data.get("url", ""), variables)
    method = request_data.get("method", "GET").upper()
    
    headers = {}
    for h in request_data.get("headers", []):
        if h.get("key"):
            headers[h["key"]] = interpolate_variables(h.get("value", ""), variables)
            
    params = {}
    for p in request_data.get("queryParams", []):
        if p.get("key"):
            params[p["key"]] = interpolate_variables(p.get("value", ""), variables)

    body_type = request_data.get("bodyType", "NONE").upper()
    body_content = request_data.get("body", "")
    
    # Interpolate body if JSON or TEXT
    if body_type in ["JSON", "RAW", "TEXT"] and body_content:
        body_content = interpolate_variables(body_content, variables)

    # 3. Handle Authentication Hook
    auth_type = request_data.get("authType", "NONE").upper()
    auth_config = request_data.get("authConfig", {})

    if auth_type == "HOOK" and auth_config.get("authFunctionId"):
        auth_func_id = auth_config["authFunctionId"]
        auth_col = MongoDB.get_collection("auth_functions")
        auth_func = await auth_col.find_one({"_id": ObjectId(auth_func_id)})

        if auth_func:
            now = datetime.now(timezone.utc)
            cached_token = auth_func.get("cachedToken")
            expires_at = auth_func.get("expiresAt")
            
            # Make sure expires_at is timezone-aware
            if expires_at and expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)

            # If cached token is missing or expired, run sandbox script to get new token
            if not cached_token or not expires_at or expires_at <= now:
                print(f"Auth function cache miss/expiry for: {auth_func['name']}. Running sandbox...")
                script = auth_func.get("script", "")
                
                # Execute in QuickJS sandbox
                new_token = await run_unsafe_auth_script(script, variables)
                
                if new_token.startswith("ERROR:"):
                    raise ValueError(f"Auth Hook Execution Failed: {new_token}")
                
                # Extract expiry (check JWT exp claim or default 1 hour)
                token_expiry = extract_jwt_expiry(new_token)
                
                # Update DB cache
                await auth_col.update_one(
                    {"_id": ObjectId(auth_func_id)},
                    {
                        "$set": {
                            "cachedToken": new_token,
                            "expiresAt": token_expiry,
                            "updatedAt": datetime.now(timezone.utc)
                        }
                    }
                )
                cached_token = new_token
                print(f"Token cached. Expiration set to: {token_expiry}")
            
            # Apply token as Bearer token header
            headers["Authorization"] = f"Bearer {cached_token}"

    elif auth_type == "BEARER" and auth_config.get("token"):
        token_val = interpolate_variables(auth_config["token"], variables)
        headers["Authorization"] = f"Bearer {token_val}"
        
    elif auth_type == "API_KEY" and auth_config.get("key") and auth_config.get("value"):
        key_name = interpolate_variables(auth_config["key"], variables)
        key_val = interpolate_variables(auth_config["value"], variables)
        headers[key_name] = key_val

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
                "parsedVariables": {}
            }

    # 5. Execute Response Parser Script
    parsed_variables = {}
    parser_script = request_data.get("responseParserScript")
    if parser_script and response.status_code < 400:
        try:
            parsed_variables = await run_unsafe_response_parser(
                response_body=response_body,
                response_headers=response_headers,
                parser_script=parser_script
            )
            
            # If variables were extracted, save them back to the active environment
            if parsed_variables and environment_id:
                env_col = MongoDB.get_collection("environments")
                # Retrieve current variables
                env_doc = await env_col.find_one({"_id": ObjectId(environment_id)})
                if env_doc:
                    updated_vars = {v["key"]: v for v in env_doc.get("variables", [])}
                    
                    # Update or append parsed variables
                    for key, val in parsed_variables.items():
                        updated_vars[key] = {
                            "key": key,
                            "value": str(val),
                            "isSecret": False
                        }
                    
                    await env_col.update_one(
                        {"_id": ObjectId(environment_id)},
                        {"$set": {"variables": list(updated_vars.values())}}
                    )
        except Exception as e:
            print(f"Response parser script run failed: {str(e)}")

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
        "parsedVariables": parsed_variables
    }
