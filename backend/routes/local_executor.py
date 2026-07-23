"""Sidecar-local request execution: API Explorer runs/previews and Auth
Function resolution, backed by the device's LocalStore instead of cloud
Mongo. Mounted only in local_sidecar.py — the cloud backend is storage/sync
only and no longer executes anything. No auth dependencies, matching the
sidecar's trusted-localhost convention."""

import json
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.local_store import LocalStore
from services.executor import (
    auth_script_hash,
    execute_request,
    get_valid_auth_token,
    load_env_vars,
    resolve_request,
)
from services.auth_sandbox import run_unsafe_auth_script

router = APIRouter(prefix="/api/executor", tags=["local-executor"])

class InputBinding(BaseModel):
    name: str
    source: Literal["literal", "generator"] = "literal"
    value: str = ""

class ExecutorPayload(BaseModel):
    requestId: str
    method: str
    url: str
    headers: list
    queryParams: list
    bodyType: str
    body: Optional[str] = ""
    authType: str
    authConfig: Optional[dict] = None
    responseParserScript: Optional[str] = ""
    requestInterceptorScript: Optional[str] = ""
    environmentId: Optional[str] = None
    inputs: Optional[List[InputBinding]] = None
    outputs: Optional[List[str]] = None

@router.post("/run")
async def run_request(payload: ExecutorPayload):
    """
    Executes an API request and resolves any environment variables or Auth Hooks.
    """
    try:
        result = await execute_request(payload.model_dump(), payload.environmentId)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Request execution failed: {str(e)}")

@router.post("/preview")
async def preview_request(payload: ExecutorPayload):
    """
    Resolves URL, headers, query params, body, and auth (including firing an Auth
    Hook script if configured) into their fully-interpolated values, without
    dispatching the HTTP call. Used to build a runnable cURL preview.
    """
    try:
        return await resolve_request(payload.model_dump(), payload.environmentId)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Request resolution failed: {str(e)}")

@router.get("/auth-token/{auth_function_id}")
async def resolve_auth_function_token(auth_function_id: str, envId: Optional[str] = None):
    """
    Resolves an auth function's token (cached or freshly run). Accepts a local
    or cloud id. Same response shape as the removed cloud endpoint.
    """
    try:
        token = await get_valid_auth_token(auth_function_id, envId)
        return {"token": token if isinstance(token, str) else None, "result": token}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to resolve auth function token: {str(e)}")

class AuthFunctionTest(BaseModel):
    script: str
    environment_id: Optional[str] = None

@router.post("/auth-test")
async def test_auth_function(payload: AuthFunctionTest):
    """
    Dry-runs an auth function script in the sandbox with the given environment's
    variables. Pure dry-run — nothing is cached or persisted.
    """
    try:
        token_res = await run_unsafe_auth_script(payload.script, load_env_vars(payload.environment_id))
        if isinstance(token_res, str) and token_res.startswith("ERROR:"):
            return {"success": False, "error": token_res}
        return {
            "success": True,
            "token": token_res if isinstance(token_res, str) else None,
            "result": token_res
        }
    except Exception as e:
        return {"success": False, "error": f"Execution failed: {str(e)}"}

@router.get("/auth-cache")
async def get_auth_cache_status():
    """
    Returns {authFunctionLocalId: {expiresAt}} for every *currently valid*
    cached token — entries whose script/TTL changed or that are within 30s of
    expiry are omitted. Feeds the "Cached token active" badge.
    """
    prefix = "auth_token_cache:"
    records = {r["localId"]: r for r in LocalStore.list("auth_function")}
    now = datetime.now(timezone.utc)
    valid: Dict[str, Dict[str, str]] = {}
    for key, raw in LocalStore.list_prefs(prefix).items():
        local_id = key[len(prefix):]
        record = records.get(local_id)
        if not record:
            continue
        try:
            entry = json.loads(raw)
            payload = json.loads(record["payload"])
            if entry.get("scriptHash") != auth_script_hash(payload.get("script", ""), payload.get("expires_in")):
                continue
            expires_at = datetime.fromisoformat(entry["expiresAt"])
        except Exception:
            continue
        if expires_at <= now + timedelta(seconds=30):
            continue
        valid[local_id] = {"expiresAt": entry["expiresAt"]}
    return valid
