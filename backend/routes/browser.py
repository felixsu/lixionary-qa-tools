import json
import uuid
import asyncio
import httpx
import websockets
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import StreamingResponse
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
    sessions_col = MongoDB.get_collection("browser_sessions")
    
    # Check if active session count >= 12
    active_sessions = await sessions_col.find({"status": {"$ne": "closed"}}).to_list(None)
    if len(active_sessions) >= 12:
        # Retrieve user details for active sessions
        user_ids = []
        for s in active_sessions:
            try:
                user_ids.append(ObjectId(s["user_id"]))
            except Exception:
                pass
                
        users_col = MongoDB.get_collection("users")
        users = await users_col.find({"_id": {"$in": user_ids}}).to_list(None)
        user_map = {str(u["_id"]): {
            "name": u.get("name", "Unknown Teammate"),
            "email": u.get("email", "Unknown Email")
        } for u in users}
        
        session_details = []
        for s in active_sessions:
            u_info = user_map.get(s["user_id"], {"name": "Unknown Teammate", "email": "Unknown Email"})
            session_details.append({
                "session_id": s["session_id"],
                "status": s["status"],
                "owner_name": u_info["name"],
                "owner_email": u_info["email"],
                "created_at": s["created_at"].isoformat() if isinstance(s.get("created_at"), datetime) else s.get("created_at", "")
            })
            
        raise HTTPException(
            status_code=429,
            detail={
                "error": "resource_depleted",
                "message": "Global limit of 12 active browser sessions reached. Please ask a teammate to close their session.",
                "active_sessions": session_details
            }
        )

    session_id = f"sess_{uuid.uuid4().hex[:12]}"
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
    default_url: Optional[str] = None

    if token:
        try:
            from routes.auth import decode_iam_token
            from bson.errors import InvalidId

            payload = await decode_iam_token(token)
            
            # Resolve the local MongoDB user_id using the email claim if available
            email = payload.get("email")
            if email:
                users_col = MongoDB.get_collection("users")
                user = await users_col.find_one({"email": email})
                if user:
                    ws_user_id = str(user["_id"])
            
            if not ws_user_id:
                ws_user_id = payload.get("sub")

            if ws_user_id and profile_id and profile_id != "undefined":
                try:
                    owner_id_obj = ObjectId(ws_user_id)
                except InvalidId:
                    owner_id_obj = None
                
                try:
                    profile_id_obj = ObjectId(profile_id)
                except InvalidId:
                    profile_id_obj = None

                if owner_id_obj and profile_id_obj:
                    profiles_col = MongoDB.get_collection("browser_profiles")
                    profile = await profiles_col.find_one({"_id": profile_id_obj, "ownerId": owner_id_obj})
                if profile:
                    default_url = profile.get("defaultUrl")
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
            user_id=ws_user_id,
            default_url=default_url
        )
        if session_id in BrowserSessionManager._sessions:
            BrowserSessionManager._sessions[session_id]["disconnected_at"] = None

        session_info = BrowserSessionManager._sessions.get(session_id, {})
        vnc_port = session_info.get("vnc_port", 8080)
        await send_to_client({"type": "status", "data": {"connected": True, "url": page.url, "vnc_port": vnc_port}})

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
        if session_id in BrowserSessionManager._sessions:
            BrowserSessionManager._sessions[session_id]["disconnected_at"] = datetime.now(timezone.utc)
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

# ---------------------------------------------------------------------------
# VNC Proxying (to bypass Mixed Content HTTPS errors in production)
# ---------------------------------------------------------------------------

@router.get("/vnc/{session_id}/{path:path}")
async def vnc_http_proxy(session_id: str, path: str, request: Request):
    if not path:
        path = "vnc.html"
        
    target_url = f"http://lixionary-vnc-browser-{session_id}:8080/{path}"
    
    if request.query_params:
        target_url += f"?{request.query_params}"
        
    client = httpx.AsyncClient()
    try:
        req = client.build_request("GET", target_url)
        resp = await client.send(req, stream=True)
        
        # Exclude hop-by-hop headers
        headers = {k: v for k, v in resp.headers.items() if k.lower() not in [
            "content-length", "connection", "keep-alive", "proxy-authenticate", 
            "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"
        ]}
        
        async def stream_generator():
            try:
                async for chunk in resp.aiter_raw():
                    yield chunk
            finally:
                await resp.aclose()
                await client.aclose()
        
        return StreamingResponse(
            stream_generator(),
            status_code=resp.status_code,
            headers=headers,
            media_type=resp.headers.get("content-type")
        )
    except Exception as e:
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"VNC proxy error: {str(e)}")

@router.websocket("/vnc-ws/{session_id}")
async def vnc_ws_proxy(websocket: WebSocket, session_id: str):
    await websocket.accept()
    
    target_ws_url = f"ws://lixionary-vnc-browser-{session_id}:8080/websockify"
    
    try:
        async with websockets.connect(target_ws_url, subprotocols=["binary"]) as target_ws:
            async def forward_to_target():
                try:
                    while True:
                        msg = await websocket.receive()
                        if "bytes" in msg:
                            await target_ws.send(msg["bytes"])
                        elif "text" in msg:
                            await target_ws.send(msg["text"])
                except Exception:
                    pass
                    
            async def forward_to_client():
                try:
                    while True:
                        data = await target_ws.recv()
                        if isinstance(data, bytes):
                            await websocket.send_bytes(data)
                        else:
                            await websocket.send_text(data)
                except Exception:
                    pass
                    
            await asyncio.gather(forward_to_target(), forward_to_client())
    except Exception as e:
        print(f"VNC WebSocket proxy error for session {session_id}: {e}")
        try:
            await websocket.close(code=1011, reason=str(e))
        except Exception:
            pass
