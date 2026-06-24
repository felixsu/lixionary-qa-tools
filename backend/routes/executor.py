from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any, Optional
from pydantic import BaseModel

from routes.auth import get_current_user
from services.executor import execute_request

router = APIRouter(prefix="/api/executor", tags=["executor"])

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

@router.post("/run")
async def run_request(payload: ExecutorPayload, current_user: dict = Depends(get_current_user)):
    """
    Executes an API request using the proxy runner and resolves any environment variables or Auth Hooks.
    """
    try:
        # Convert request body payload into dictionary
        req_data = payload.model_dump()
        env_id = payload.environmentId
        
        # Execute proxy request
        result = await execute_request(req_data, env_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Request execution failed: {str(e)}")
