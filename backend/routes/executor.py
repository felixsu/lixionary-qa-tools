from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any, List, Literal, Optional
from pydantic import BaseModel

from routes.auth import get_current_user
from services.executor import execute_request, resolve_request
from services.sync_versioning import get_device_id

router = APIRouter(prefix="/api/executor", tags=["executor"])

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
    environmentId: Optional[str] = None
    inputs: Optional[List[InputBinding]] = None
    outputs: Optional[List[str]] = None

@router.post("/run")
async def run_request(
    payload: ExecutorPayload,
    current_user: dict = Depends(get_current_user),
    device_id: str = Depends(get_device_id),
):
    """
    Executes an API request using the proxy runner and resolves any environment variables or Auth Hooks.
    """
    try:
        # Convert request body payload into dictionary
        req_data = payload.model_dump()
        env_id = payload.environmentId

        # Execute proxy request
        result = await execute_request(req_data, env_id, device_id=device_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Request execution failed: {str(e)}")

@router.post("/preview")
async def preview_request(payload: ExecutorPayload, current_user: dict = Depends(get_current_user)):
    """
    Resolves URL, headers, query params, body, and auth (including firing an Auth
    Hook script if configured) into their fully-interpolated values, without
    dispatching the HTTP call. Used to build a runnable cURL preview.
    """
    try:
        req_data = payload.model_dump()
        return await resolve_request(req_data, payload.environmentId)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Request resolution failed: {str(e)}")
