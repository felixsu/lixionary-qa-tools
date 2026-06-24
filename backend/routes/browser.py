import json
from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect
from typing import Dict, Any, List, Optional
from pydantic import BaseModel
from bson import ObjectId

from routes.auth import get_current_user
from services.browser import BrowserSessionManager
from services.generator import generate_pom_class, generate_http_client
from db.redis_client import RedisClient

router = APIRouter(prefix="/api/browser", tags=["browser"])

class GeneratePOMPayload(BaseModel):
    className: str
    url: Optional[str] = ""
    parentLocator: Optional[str] = ""
    elements: List[dict]

class GenerateClientPayload(BaseModel):
    baseUrl: str
    logIds: List[str]
    sessionId: str

@router.get("/network/{session_id}/logs")
async def get_network_logs(session_id: str, current_user: dict = Depends(get_current_user)):
    """
    Retrieves all summarized network logs for a session from Redis.
    """
    if RedisClient.client is None:
        raise HTTPException(status_code=500, detail="Redis is not connected")
        
    keys = []
    # Search for all request keys matching this session
    async for key in RedisClient.client.scan_iter(f"network:{session_id}:*"):
        keys.append(key)
        
    logs = []
    for key in keys:
        log_json = await RedisClient.get_json(key)
        if log_json:
            log_data = json.loads(log_json)
            
            # Fetch status if response has arrived
            resp_key = f"network:response:{session_id}:{log_data['id']}"
            resp_json = await RedisClient.get_json(resp_key)
            if resp_json:
                resp_data = json.loads(resp_json)
                log_data["status"] = resp_data.get("status")
                log_data["statusText"] = resp_data.get("statusText")
            else:
                log_data["status"] = None
                log_data["statusText"] = "Pending"
                
            logs.append(log_data)
            
    # Sort logs (optional, but let's keep them in order of URL/keys)
    return logs

@router.get("/network/{session_id}/details/{log_id:path}")
async def get_network_log_details(session_id: str, log_id: str, current_user: dict = Depends(get_current_user)):
    """
    Retrieves the full request/response payload details for a single network log.
    """
    req_key = f"network:{session_id}:{log_id}"
    resp_key = f"network:response:{session_id}:{log_id}"
    
    req_json = await RedisClient.get_json(req_key)
    if not req_json:
        raise HTTPException(status_code=404, detail="Network request log not found")
        
    req_data = json.loads(req_json)
    resp_json = await RedisClient.get_json(resp_key)
    
    response_data = None
    if resp_json:
        response_data = json.loads(resp_json)
        
    return {
        "request": req_data,
        "response": response_data
    }

@router.post("/pom/generate")
async def generate_pom(payload: GeneratePOMPayload, current_user: dict = Depends(get_current_user)):
    """
    Auto-generates Playwright Python POM class definitions.
    """
    try:
        pom_code = generate_pom_class(
            class_name=payload.className,
            url=payload.url,
            parent_locator=payload.parentLocator,
            elements=payload.elements
        )
        return {"code": pom_code}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"POM generation failed: {str(e)}")

@router.post("/client/generate")
async def generate_client(payload: GenerateClientPayload, current_user: dict = Depends(get_current_user)):
    """
    Auto-generates httpx-based Python HTTP API clients from recorded network logs.
    """
    try:
        # Load request objects from Redis
        logs = []
        for log_id in payload.logIds:
            req_key = f"network:{payload.sessionId}:{log_id}"
            req_json = await RedisClient.get_json(req_key)
            if req_json:
                req_data = json.loads(req_json)
                
                # Fetch full response body for Pydantic schema generation
                resp_key = f"network:response:{payload.sessionId}:{log_id}"
                resp_json = await RedisClient.get_json(resp_key)
                if resp_json:
                    resp_data = json.loads(resp_json)
                    req_data["body"] = resp_data.get("body")
                    
                logs.append(req_data)
                
        client_code = generate_http_client(payload.baseUrl, logs)
        return {"code": client_code}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Client generation failed: {str(e)}")

@router.websocket("/ws/browser-session/{session_id}")
async def browser_session_websocket(websocket: WebSocket, session_id: str):
    """
    WebSocket channel to coordinate interactive browser control and event streams.
    """
    await websocket.accept()
    print(f"WebSocket connection established for browser session: {session_id}")

    # Define sender helper to send back to client
    async def send_to_client(message: dict):
        try:
            await websocket.send_json(message)
        except Exception as e:
            print(f"Error sending message on WebSocket: {e}")

    try:
        # Initialize browser session
        page = await BrowserSessionManager.get_or_create_session(session_id, send_to_client)
        
        # Send initial status
        await send_to_client({
            "type": "status",
            "data": {
                "connected": True,
                "url": page.url
            }
        })

        # Keep listening for frontend actions
        while True:
            data_str = await websocket.receive_text()
            cmd = json.loads(data_str)
            action = cmd.get("action")

            if action == "navigate":
                url = cmd.get("url")
                if url:
                    print(f"WebSocket navigating to: {url}")
                    await page.goto(url)
                    
            elif action == "toggle-inspect":
                enabled = cmd.get("enabled", False)
                print(f"WebSocket toggling inspect mode: {enabled}")
                await BrowserSessionManager.set_inspect_mode(session_id, enabled)
                
            elif action == "click":
                selector = cmd.get("selector")
                if selector:
                    await page.click(selector)
                    
            elif action == "fill":
                selector = cmd.get("selector")
                value = cmd.get("value", "")
                if selector:
                    await page.fill(selector, value)

    except WebSocketDisconnect:
        print(f"WebSocket disconnected for session: {session_id}")
        await BrowserSessionManager.close_session(session_id)
    except Exception as e:
        print(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
        await BrowserSessionManager.close_session(session_id)
