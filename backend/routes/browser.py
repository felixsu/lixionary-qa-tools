import json
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect
from typing import Dict, Any, List, Optional
from pydantic import BaseModel
from bson import ObjectId

from routes.auth import get_current_user
from services.browser import BrowserSessionManager
from services.generator import generate_pom_class, generate_http_client
from db.redis_client import RedisClient
from db.mongo import MongoDB

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

# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------

@router.get("/sessions")
async def list_sessions(current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["id"])
    sessions_col = MongoDB.get_collection("browser_sessions")
    sessions = await sessions_col.find(
        {"user_id": user_id, "status": {"$ne": "closed"}}
    ).sort("created_at", -1).to_list(None)
    return [
        {
            "session_id": s["session_id"],
            "status": s["status"],
            "created_at": s["created_at"].isoformat() if isinstance(s.get("created_at"), datetime) else s.get("created_at", ""),
            "profile_id": s.get("profile_id"),
        }
        for s in sessions
    ]

@router.post("/sessions")
async def create_session(current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["id"])
    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    sessions_col = MongoDB.get_collection("browser_sessions")
    await sessions_col.insert_one({
        "user_id": user_id,
        "session_id": session_id,
        "status": "pending",
        "created_at": datetime.now(timezone.utc),
        "profile_id": None,
    })
    return {"session_id": session_id, "status": "pending"}

@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["id"])
    sessions_col = MongoDB.get_collection("browser_sessions")
    session = await sessions_col.find_one({"session_id": session_id, "user_id": user_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await BrowserSessionManager.close_session(session_id)
    await sessions_col.delete_one({"session_id": session_id})
    return {"message": f"Session {session_id} closed"}

# ---------------------------------------------------------------------------
# Network logs
# ---------------------------------------------------------------------------

@router.get("/network/{session_id}/logs")
async def get_network_logs(session_id: str, current_user: dict = Depends(get_current_user)):
    if RedisClient.client is None:
        raise HTTPException(status_code=500, detail="Redis is not connected")
    keys = []
    async for key in RedisClient.client.scan_iter(f"network:{session_id}:*"):
        keys.append(key)
    logs = []
    for key in keys:
        log_json = await RedisClient.get_json(key)
        if log_json:
            log_data = json.loads(log_json)
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
    return logs

@router.get("/network/{session_id}/details/{log_id:path}")
async def get_network_log_details(session_id: str, log_id: str, current_user: dict = Depends(get_current_user)):
    req_key = f"network:{session_id}:{log_id}"
    resp_key = f"network:response:{session_id}:{log_id}"
    req_json = await RedisClient.get_json(req_key)
    if not req_json:
        raise HTTPException(status_code=404, detail="Network request log not found")
    req_data = json.loads(req_json)
    resp_json = await RedisClient.get_json(resp_key)
    response_data = json.loads(resp_json) if resp_json else None
    return {"request": req_data, "response": response_data}

# ---------------------------------------------------------------------------
# Code generation
# ---------------------------------------------------------------------------

@router.post("/pom/generate")
async def generate_pom(payload: GeneratePOMPayload, current_user: dict = Depends(get_current_user)):
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
    try:
        logs = []
        for log_id in payload.logIds:
            req_key = f"network:{payload.sessionId}:{log_id}"
            req_json = await RedisClient.get_json(req_key)
            if req_json:
                req_data = json.loads(req_json)
                resp_key = f"network:response:{payload.sessionId}:{log_id}"
                resp_json = await RedisClient.get_json(resp_key)
                if resp_json:
                    req_data["responseBody"] = json.loads(resp_json).get("body")
                logs.append(req_data)
        client_code = generate_http_client(payload.baseUrl, logs)
        return {"code": client_code}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Client generation failed: {str(e)}")

class AddPOMMethodPayload(BaseModel):
    sessionId: str
    methodName: str
    action: str
    strategy: str
    selector: str
    frameLocators: Optional[List[str]] = []

def add_pom_method_to_file(session_id: str, my_page_path: str, method_name: str, method_body: str):
    import os
    from services.browser import get_session_lock
    lock = get_session_lock(session_id)
    with lock:
        if not os.path.exists(my_page_path):
            os.makedirs(os.path.dirname(my_page_path), exist_ok=True)
            with open(my_page_path, "w") as f:
                f.write("from playwright.sync_api import Page\n\nclass MyPage:\n    def __init__(self, page: Page):\n        self.page = page\n")

        with open(my_page_path, "r") as f:
            content = f.read()

        if f"def {method_name}(" in content:
            raise ValueError(f"Method '{method_name}' already exists in MyPage class")

        if not content.endswith("\n"):
            content += "\n"
        if not content.endswith("\n\n"):
            content += "\n"

        new_content = content + method_body
        with open(my_page_path, "w") as f:
            f.write(new_content)


@router.post("/pom/add")
async def add_pom_method(payload: AddPOMMethodPayload, current_user: dict = Depends(get_current_user)):
    import os
    import re
    import asyncio
    from routes.workspace import get_workspace_dir, validate_session_owner

    user_id = str(current_user["id"])
    await validate_session_owner(payload.sessionId, user_id)
    workspace_dir = get_workspace_dir(user_id, payload.sessionId)
    my_page_path = os.path.join(workspace_dir, "inspection_code", "my_page.py")

    # Clean and check method name
    method_name = re.sub(r"[^a-zA-Z0-9_]", "", payload.methodName.lower())
    if not method_name or method_name[0].isdigit():
        method_name = f"action_{method_name}"

    # Format the strategy and args
    strategy = payload.strategy
    if strategy.startswith("locator"):
        strategy = "locator"
    
    strategy_args = ""
    if strategy == "get_by_role":
        match = re.match(r'([^\[]+)\[name="([^"]+)"\]', payload.selector)
        if match:
            role_type = match.group(1)
            role_name = match.group(2).replace('"', '\\"')
            strategy_args = f'"{role_type}", name="{role_name}"'
        else:
            escaped_selector = payload.selector.replace('"', '\\"')
            strategy_args = f'"{escaped_selector}"'
    else:
        escaped_selector = payload.selector.replace('"', '\\"')
        strategy_args = f'"{escaped_selector}"'

    frame_chain = ""
    if payload.frameLocators:
        for fl in payload.frameLocators:
            frame_chain += f".frame_locator('{fl}')"

    docstring = f"Perform {payload.action} on {strategy}: {payload.selector}"
    if payload.frameLocators:
        docstring += f" (inside iframe: {' -> '.join(payload.frameLocators)})"

    # Construct the method signature and body
    sig_args = "self"
    if payload.action == "fill":
        sig_args += ", value: str"

    method_body = f"    def {method_name}({sig_args}) -> None:\n"
    method_body += f'        """{docstring}"""\n'
    
    target = "self.page"
    call_args = 'value' if payload.action == 'fill' else ''
    method_body += f'        {target}{frame_chain}.{strategy}({strategy_args}).{payload.action}({call_args})\n'

    try:
        await asyncio.to_thread(
            add_pom_method_to_file,
            payload.sessionId,
            my_page_path,
            method_name,
            method_body
        )
        return {"message": f"Method {method_name} added to MyPage successfully"}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write to my_page.py: {str(e)}")

# ---------------------------------------------------------------------------
# WebSocket browser session
# ---------------------------------------------------------------------------

async def _upsert_session_status(session_id: str, user_id: str, status: str):
    try:
        sessions_col = MongoDB.get_collection("browser_sessions")
        await sessions_col.update_one(
            {"session_id": session_id, "user_id": user_id},
            {"$set": {"status": status}},
            upsert=False,
        )
    except Exception as e:
        print(f"Failed to update session status in DB: {e}")

@router.websocket("/ws/browser-session/{session_id}")
async def browser_session_websocket(websocket: WebSocket, session_id: str):
    await websocket.accept()
    print(f"WebSocket connection established for browser session: {session_id}")

    query_params = dict(websocket.query_params)
    token = query_params.get("token")
    profile_id = query_params.get("profileId")
    env_id = query_params.get("envId")

    cookies = None
    local_storage = None
    ws_user_id: Optional[str] = None

    if token:
        try:
            import jwt
            from config import settings

            payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
            ws_user_id = payload.get("sub")

            if ws_user_id and profile_id and profile_id != "undefined":
                profiles_col = MongoDB.get_collection("browser_profiles")
                profile = await profiles_col.find_one({"_id": ObjectId(profile_id), "ownerId": ObjectId(ws_user_id)})
                if profile:
                    if profile.get("cookies"):
                        try:
                            cookies = json.loads(profile["cookies"])
                        except Exception as e:
                            print(f"Failed to parse profile cookies: {e}")
                    if profile.get("localStorage"):
                        try:
                            local_storage = json.loads(profile["localStorage"])
                        except Exception as e:
                            print(f"Failed to parse profile localStorage: {e}")

                    auth_func_id = profile.get("authFunctionId")
                    auth_injection = profile.get("authInjection")
                    if auth_func_id and auth_injection:
                        try:
                            from services.executor import get_valid_auth_token
                            auth_token = await get_valid_auth_token(str(auth_func_id), env_id)
                            inj_type = auth_injection.get("type")
                            inj_key = auth_injection.get("key")
                            domain_or_origin = auth_injection.get("domainOrOrigin")

                            if inj_type == "cookie":
                                if not isinstance(cookies, list):
                                    cookies = []
                                cookies = [c for c in cookies if c.get("name") != inj_key]
                                cookies.append({"name": inj_key, "value": auth_token, "domain": domain_or_origin, "path": "/"})
                            elif inj_type == "localStorage":
                                if not isinstance(local_storage, dict):
                                    local_storage = {"origins": []}
                                if "origins" not in local_storage:
                                    local_storage["origins"] = []
                                target_origin = domain_or_origin.lower().rstrip("/")
                                origin_entry = next(
                                    (e for e in local_storage["origins"] if e.get("origin", "").lower().rstrip("/") == target_origin),
                                    None
                                )
                                if not origin_entry:
                                    origin_entry = {"origin": domain_or_origin, "localStorage": []}
                                    local_storage["origins"].append(origin_entry)
                                if not isinstance(origin_entry.get("localStorage"), list):
                                    origin_entry["localStorage"] = []
                                origin_entry["localStorage"] = [kv for kv in origin_entry["localStorage"] if kv.get("name") != inj_key]
                                origin_entry["localStorage"].append({"name": inj_key, "value": auth_token})
                        except Exception as e:
                            print(f"Failed to resolve or inject Auth Hook token: {e}")
        except Exception as e:
            print(f"WebSocket authentication/profile resolving failed: {e}")

    # Mark session active in DB
    if ws_user_id:
        await _upsert_session_status(session_id, ws_user_id, "active")

    async def send_to_client(message: dict):
        try:
            await websocket.send_json(message)
        except Exception as e:
            print(f"Error sending message on WebSocket: {e}")

    try:
        page = await BrowserSessionManager.get_or_create_session(
            session_id,
            send_to_client,
            cookies=cookies,
            local_storage=local_storage,
            user_id=ws_user_id
        )
        await send_to_client({"type": "status", "data": {"connected": True, "url": page.url}})

        while True:
            data_str = await websocket.receive_text()
            cmd = json.loads(data_str)
            action = cmd.get("action")

            # Always resolve the current active page (tab switches change it)
            active_session = BrowserSessionManager._sessions.get(session_id)
            page = BrowserSessionManager._active_page(active_session) if active_session else page

            if action == "navigate":
                url = cmd.get("url")
                if url:
                    await page.goto(url)
            elif action == "toggle-inspect":
                enabled = cmd.get("enabled", False)
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
            elif action == "paste":
                text = cmd.get("text", "")
                if text:
                    await page.keyboard.insert_text(text)

            elif action == "switch_tab":
                idx = cmd.get("page_index", 0)
                session = BrowserSessionManager._sessions.get(session_id)
                if session and 0 <= idx < len(session["pages"]):
                    session["active_page_index"] = idx
                    active = session["pages"][idx]
                    await send_to_client({"type": "navigation", "url": active.url})

            elif action == "close_tab":
                idx = cmd.get("page_index", 0)
                session = BrowserSessionManager._sessions.get(session_id)
                if session and 0 <= idx < len(session["pages"]) and idx != 0:
                    await session["pages"][idx].close()

    except WebSocketDisconnect:
        print(f"WebSocket disconnected for session: {session_id}")
        # Keep browser session alive — user may reconnect.
        if ws_user_id:
            await _upsert_session_status(session_id, ws_user_id, "disconnected")
    except Exception as e:
        print(f"WebSocket error for session {session_id}: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
        # Close the browser session on unrecoverable errors.
        await BrowserSessionManager.close_session(session_id)
        if ws_user_id:
            await _upsert_session_status(session_id, ws_user_id, "error")
