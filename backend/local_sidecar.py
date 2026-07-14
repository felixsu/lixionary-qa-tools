import os
import sys
import json
import uuid
import asyncio
import subprocess
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from playwright.async_api import async_playwright, Page, Request, Response

# Add current directory to path so naming/generator services can be imported
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from services.browser import BrowserSessionManager, rank_locators
from services.naming import polish_method_names, dedupe_names, heuristic_method_name, propose_locator_fix
from services.generator import generate_pom_class, generate_http_client, build_pom_method_code

app = FastAPI(title="Lixionary Local Automation Explorer Sidecar")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared Local Workspace directory: ~/Documents/AutomationExplorer/workspaces
USER_HOME = os.path.expanduser("~")
BASE_DIR = os.path.join(USER_HOME, "Documents", "AutomationExplorer")
WORKSPACE_DIR = os.path.join(BASE_DIR, "workspaces")
VENV_DIR = os.path.join(BASE_DIR, "venv")

os.makedirs(WORKSPACE_DIR, exist_ok=True)

# Active local sessions registry: { session_id: SessionDict }
_active_sessions = {}

# In-memory network logs: { session_id: [RequestLogs] }
_network_logs = {}
_network_log_details = {}  # { session_id: { log_id: Details } }

# Running Python script processes: { session_id: process }
_running_processes = {}

# Default workspace boilerplate
DEFAULT_MY_PAGE_PY = "from playwright.sync_api import Page\n\nclass MyPage:\n    def __init__(self, page: Page):\n        self.page = page\n"

DEFAULT_MY_CLIENT_PY = 'from __future__ import annotations\nimport httpx\nfrom pydantic import BaseModel, Field\nfrom typing import List, Optional, Any\n\n# --- Pydantic Models ---\n\nclass MyClient:\n    def __init__(self, base_url: str = "https://api-qa.ninjavan.co", token: str = None):\n        self.client = httpx.Client(base_url=base_url)\n        if token:\n            self.client.headers.update({"Authorization": f"Bearer {token}"})\n'

DEFAULT_PLAYGROUND_PY = 'from playwright.sync_api import Page\nfrom inspection_code.my_page import MyPage\n\n\nclass PlaygroundPage(MyPage):\n    def __init__(self, page: Page):\n        super().__init__(page)\n'

DEFAULT_MAIN_PY = """import os
import time
from playwright.sync_api import sync_playwright
from playground import PlaygroundPage

# Pre-made delay helper (ms: milliseconds)
def delay(ms: int):
    time.sleep(ms / 1000)

def run_playground(page):
    \"\"\"Run playground tasks using the live browser page.\"\"\"
    mPage = PlaygroundPage(page)
    # Add your test operations here!
    # e.g., mPage.click_button()

# Retrieve local browser remote debugging URL
cdp_url = os.getenv("BROWSER_CDP_URL", "http://localhost:9222")

print(f"Connecting to browser at: {cdp_url}...")
try:
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(cdp_url)

        # Reuse the first active context and page
        context = browser.contexts[0]
        page = context.pages[0]

        print(f"Current page URL: {page.url}")
        run_playground(page)
        print("Execution completed successfully!")
except Exception as e:
    print(f"ERROR: Execution failed: {e}")
"""

class FileSavePayload(BaseModel):
    content: str

class FileResetPayload(BaseModel):
    sessionId: str
    filename: str

class RunScriptPayload(BaseModel):
    filename: str
    session_id: str

class GeneratePOMPayload(BaseModel):
    className: str
    url: Optional[str] = ""
    parentLocator: Optional[str] = ""
    elements: List[dict]

class GenerateClientPayload(BaseModel):
    baseUrl: str
    logIds: List[str]
    sessionId: str

class AddPOMMethodPayload(BaseModel):
    sessionId: str
    methodName: str
    action: str
    strategy: str
    selector: str
    frameLocators: Optional[List[str]] = []

class BulkPOMMethod(BaseModel):
    methodName: str
    action: str
    strategy: str
    selector: str
    frameLocators: Optional[List[str]] = []

class AddPOMMethodsBulkPayload(BaseModel):
    sessionId: str
    methods: List[BulkPOMMethod]

def get_workspace_dir(session_id: str) -> str:
    path = os.path.join(WORKSPACE_DIR, session_id)
    os.makedirs(path, exist_ok=True)
    return path

def sanitize_filename(filename: str) -> str:
    normalized = os.path.normpath(filename)
    parts = normalized.split(os.sep)
    if len(parts) == 2 and parts[0] == "inspection_code":
        base = parts[1]
        if not base.endswith(".py") or ".." in base or "/" in base or "\\" in base:
            raise HTTPException(status_code=400, detail="Invalid filename")
        return os.path.join("inspection_code", base)
    elif len(parts) == 1:
        base = parts[0]
        if not base.endswith(".py") or ".." in base or "/" in base or "\\" in base:
            raise HTTPException(status_code=400, detail="Invalid filename")
        return base
    else:
        raise HTTPException(status_code=400, detail="Invalid directory structure")

# Setup Python Virtual Environment at startup
def setup_local_venv():
    try:
        print(f"Checking Python virtual environment at {VENV_DIR}...")
        if not os.path.exists(VENV_DIR):
            print("Creating Python virtual environment...")
            subprocess.run([sys.executable, "-m", "venv", VENV_DIR], check=True)
            
        # Determine pip path
        pip_path = os.path.join(VENV_DIR, "bin", "pip") if os.name != "nt" else os.path.join(VENV_DIR, "Scripts", "pip")
        print("Installing dependencies in local venv...")
        subprocess.run([pip_path, "install", "playwright", "httpx", "pydantic"], check=True)
        
        # Install playwright browsers in venv
        playwright_path = os.path.join(VENV_DIR, "bin", "playwright") if os.name != "nt" else os.path.join(VENV_DIR, "Scripts", "playwright")
        print("Installing local Playwright browsers...")
        subprocess.run([playwright_path, "install", "chromium"], check=True)
        print("Local venv setup completed successfully.")
    except Exception as e:
        print(f"WARNING: Local virtualenv setup failed: {e}. Running scripts will fallback to system python.")

@app.on_event("startup")
async def startup_event():
    # Setup venv in background so startup returns immediately
    asyncio.create_task(asyncio.to_thread(setup_local_venv))

# Helper to check if frame locator matches uniquely
async def count_locator_matches(frame, strategy: str, selector: str) -> int:
    try:
        loc = BrowserSessionManager._build_locator(frame, strategy, selector)
        return await loc.count()
    except Exception:
        return 0

# Helper to traverse frames chain
async def get_frame_locators_chain(frame, page: Page) -> List[str]:
    chain = []
    curr = frame
    while curr and curr != page.main_frame:
        try:
            iframe_el = await curr.frame_element()
            if iframe_el:
                parent = curr.parent_frame
                if parent:
                    selector = await parent.evaluate("""
                        (el) => {
                            if (el.id) return '#' + el.id;
                            const nameAttr = el.getAttribute('name');
                            if (nameAttr) return 'iframe[name="' + nameAttr.replace(/"/g, '\\\\"') + '"]';
                            const srcAttr = el.getAttribute('src');
                            if (srcAttr) {
                                const cleanSrc = srcAttr.split(/[?#]/)[0].replace(/"/g, '\\\\"');
                                return `iframe[src*="${cleanSrc}"]`;
                            }
                            const iframes = Array.from(document.querySelectorAll('iframe'));
                            const idx = iframes.indexOf(el);
                            if (idx !== -1) {
                                return `iframe:nth-of-type(${idx + 1})`;
                            }
                            return 'iframe';
                        }
                    """, iframe_el)
                    if selector:
                        chain.insert(0, selector)
            curr = curr.parent_frame
        except Exception:
            break
    return chain

# Local browser session WebSocket router
@app.websocket("/api/browser/ws/browser-session/{session_id}")
async def local_browser_websocket(websocket: WebSocket, session_id: str):
    await websocket.accept()
    print(f"Local WebSocket connected for browser session: {session_id}")

    playwright_mgr = None
    browser = None
    context = None
    page = None
    cdp_session = None
    ws_connected = True

    # Register local network log store
    _network_logs[session_id] = []
    _network_log_details[session_id] = {}

    async def send_to_client(message: dict):
        nonlocal ws_connected
        if not ws_connected:
            return
        try:
            await websocket.send_json(message)
        except Exception:
            ws_connected = False

    try:
        # Step 1: Wait for "init" configuration message from frontend
        init_data_str = await websocket.receive_text()
        init_cmd = json.loads(init_data_str)
        if init_cmd.get("action") != "init":
            await send_to_client({"type": "error", "message": "Expected initialization action"})
            await websocket.close()
            return

        cookies = init_cmd.get("cookies")
        local_storage = init_cmd.get("localStorage")
        default_url = init_cmd.get("defaultUrl") or "about:blank"

        # Launch local headful Chromium browser with remote debugging port enabled
        playwright_mgr = await async_playwright().start()
        browser = await playwright_mgr.chromium.launch(
            headless=False,
            args=["--start-maximized", "--remote-debugging-port=9222"]
        )
        
        # Define context with standard viewport
        context = await browser.new_context(viewport={"width": 1280, "height": 720})

        if cookies:
            try:
                await context.add_cookies(cookies)
                print(f"Injected {len(cookies)} cookies into local browser session")
            except Exception as e:
                print(f"Failed to inject cookies locally: {e}")

        if local_storage:
            try:
                ls_script = """
                (function() {
                    try {
                        const data = %s;
                        let items = [];
                        if (Array.isArray(data)) {
                            items = data;
                        } else if (typeof data === 'object' && data !== null) {
                            if (Array.isArray(data.origins)) {
                                items = data.origins;
                            }
                        }
                        if (items.length > 0) {
                            const currentOrigin = window.location.origin.toLowerCase().replace(/\/$/, "");
                            for (const item of items) {
                                if (item && item.origin) {
                                    const targetOrigin = item.origin.toLowerCase().replace(/\/$/, "");
                                    if (currentOrigin === targetOrigin && Array.isArray(item.localStorage)) {
                                        for (const kv of item.localStorage) {
                                            if (kv && kv.name) {
                                                localStorage.setItem(kv.name, String(kv.value));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e) {}
                })();
                """ % json.dumps(local_storage)
                await context.add_init_script(ls_script)
            except Exception as e:
                print(f"Failed to inject local storage script: {e}")

        # Expose binding for element selection overlay
        async def on_element_selected(source, element_info_str: str):
            session = _active_sessions.get(session_id)
            if not session:
                return
            session["last_clicked_frame"] = source["frame"]

            try:
                el_info = json.loads(element_info_str)
                frame_chain = await get_frame_locators_chain(source["frame"], session["pages"][session["active_page_index"]])
                el_info["frameLocators"] = frame_chain

                ranked_locators = rank_locators(el_info)
                counts = await asyncio.gather(*[
                    count_locator_matches(source["frame"], loc["strategy"], loc["selector"])
                    for loc in ranked_locators
                ])

                validated_locators = []
                for loc, count in zip(ranked_locators, counts):
                    loc["count"] = count
                    loc["unique"] = (count == 1)
                    if count > 1:
                        loc["score"] -= 1000
                    validated_locators.append(loc)

                validated_locators.sort(key=lambda x: x["score"], reverse=True)

                stale = False
                stale_reason = None
                try:
                    connectivity = await source["frame"].evaluate(
                        "window.__lixionaryCheckElementConnected && window.__lixionaryCheckElementConnected()"
                    )
                    if connectivity and not connectivity.get("connected"):
                        stale = True
                        stale_reason = connectivity.get("reason") or "detached"
                except Exception:
                    pass

                await send_to_client({
                    "type": "element_selected",
                    "data": {
                        "element": el_info,
                        "locators": validated_locators,
                        "stale": stale,
                        "staleReason": stale_reason
                    }
                })
            except Exception as e:
                print(f"Error processing click: {e}")

        await context.expose_binding("pythonOnElementSelected", on_element_selected)

        # Inject overlay script
        inspector_js = BrowserSessionManager.get_inspector_js()
        await context.add_init_script(inspector_js)

        # Open page
        page = await context.new_page()

        # Monitor request/response logs
        async def handle_request(req: Request):
            req_data = {
                "id": req.url + "_" + str(id(req)),
                "url": req.url,
                "method": req.method,
                "headers": req.headers,
                "resourceType": req.resource_type,
                "postData": req.post_data
            }
            # Append locally
            _network_logs[session_id].append(req_data)
            await send_to_client({"type": "network_request", "data": req_data})

        async def handle_response(res: Response):
            req = res.request
            resp_body = ""
            if res.status < 400:
                try:
                    resp_body = await res.text()
                except Exception:
                    resp_body = "[Binary/Non-Text Payload]"

            res_data = {
                "id": req.url + "_" + str(id(req)),
                "url": res.url,
                "status": res.status,
                "statusText": res.status_text,
                "headers": res.headers,
                "body": resp_body
            }
            # Store details in memory
            _network_log_details[session_id][res_data["id"]] = {
                "request": {
                    "id": res_data["id"],
                    "url": req.url,
                    "method": req.method,
                    "headers": req.headers,
                    "resourceType": req.resource_type,
                    "postData": req.post_data
                },
                "response": res_data
            }
            await send_to_client({
                "type": "network_response",
                "data": {
                    "id": res_data["id"],
                    "status": res_data["status"],
                    "statusText": res_data["statusText"]
                }
            })

        page.on("request", lambda r: asyncio.create_task(handle_request(r)))
        page.on("response", lambda r: asyncio.create_task(handle_response(r)))

        async def handle_nav(frame):
            try:
                await frame.evaluate(inspector_js)
                session = _active_sessions.get(session_id)
                if session and session.get("inspect_enabled"):
                    await frame.evaluate("window.__setLixionaryInspectMode(true)")
            except Exception:
                pass
            if frame == page.main_frame:
                await send_to_client({"type": "navigation", "url": page.url})

        page.on("framenavigated", lambda f: asyncio.create_task(handle_nav(f)))
        page.on("frameattached", lambda f: asyncio.create_task(handle_nav(f)))

        # Navigate to start URL
        url_to_open = default_url if default_url.startswith(("http://", "https://")) else "about:blank"
        try:
            await page.goto(url_to_open)
        except Exception as e:
            print(f"Initial navigation failed: {e}")

        # Setup active session dict
        _active_sessions[session_id] = {
            "session_id": session_id,
            "playwright_mgr": playwright_mgr,
            "browser": browser,
            "context": context,
            "pages": [page],
            "active_page_index": 0,
            "inspect_enabled": False,
            "last_clicked_frame": None,
            "anchor_frame": None,
            "callback": send_to_client
        }

        # Register in the shared BrowserSessionManager class registry so background services (e.g. exploration) can locate it
        BrowserSessionManager._sessions[session_id] = _active_sessions[session_id]

        # Start Screencast frame capture via CDP
        cdp_session = await context.new_cdp_session(page)
        await cdp_session.send("Page.startScreencast", {"format": "jpeg", "quality": 80})

        async def on_screencast_frame(event):
            await send_to_client({
                "type": "screencast_frame",
                "data": {
                    "image": event["data"],
                    "metadata": event["metadata"],
                    "sessionId": event.get("sessionId")
                }
            })
            try:
                await cdp_session.send("Page.screencastFrameAck", {"sessionId": event["sessionId"]})
            except Exception:
                pass

        cdp_session.on("Page.screencastFrame", lambda e: asyncio.create_task(on_screencast_frame(e)))

        # Tell client we are connected
        await send_to_client({"type": "status", "data": {"connected": True, "url": page.url}})

        # Handle incoming WebSocket commands
        while True:
            cmd_data = await websocket.receive_text()
            cmd = json.loads(cmd_data)
            action = cmd.get("action")
            session = _active_sessions.get(session_id)
            if not session:
                continue

            active_page = session["pages"][session["active_page_index"]]

            if action == "navigate":
                target_url = cmd.get("url")
                if target_url:
                    await active_page.goto(target_url)
            elif action == "toggle-inspect":
                enabled = cmd.get("enabled", False)
                session["inspect_enabled"] = enabled
                eval_script = f"window.__setLixionaryInspectMode({json.dumps(enabled)})"
                for frame in active_page.frames:
                    try:
                        await frame.evaluate(eval_script)
                    except Exception:
                        pass
            elif action == "set-anchor":
                target_frame = session.get("last_clicked_frame") or active_page.main_frame
                anchor_info = await target_frame.evaluate(
                    "window.__setLixionaryAnchorFromLast ? window.__setLixionaryAnchorFromLast() : null"
                )
                session["anchor_frame"] = target_frame
                await send_to_client({"type": "anchor_set", "data": {"anchorInfo": anchor_info}})
            elif action == "clear-anchor":
                anchor_frame = session.get("anchor_frame") or active_page.main_frame
                try:
                    await anchor_frame.evaluate("if (window.__clearLixionaryAnchor) window.__clearLixionaryAnchor()")
                except Exception:
                    pass
                session["anchor_frame"] = None
                await send_to_client({"type": "anchor_cleared"})
            elif action == "scan-page":
                scan_scope = cmd.get("scope", "page")
                await send_to_client({"type": "page_scan_started", "data": {"scope": scan_scope}})
                
                try:
                    # Enumerate items
                    scan_items = []
                    scope_label = None
                    total = 0
                    truncated = False
                    
                    if scan_scope == "selected":
                        frame = session.get("last_clicked_frame") or active_page.main_frame
                        raw = await frame.evaluate("window.__lixionaryScanPage ? window.__lixionaryScanPage({scoped: true}) : null")
                        if raw:
                            scope_info = raw.get("scope") or {}
                            scope_label = f"<{scope_info.get('tagName', '?')}> {scope_info.get('text', '')}".strip()
                            frame_chain = await get_frame_locators_chain(frame, active_page)
                            total = raw.get("total", 0)
                            truncated = bool(raw.get("truncated"))
                            for item in raw.get("elements", []):
                                scan_items.append((frame, item, frame_chain))
                    else:
                        for frame in active_page.frames:
                            try:
                                raw = await frame.evaluate("window.__lixionaryScanPage ? window.__lixionaryScanPage({scoped: false}) : null")
                                if raw:
                                    frame_chain = await get_frame_locators_chain(frame, active_page)
                                    total += raw.get("total", 0)
                                    truncated = truncated or bool(raw.get("truncated"))
                                    for item in raw.get("elements", []):
                                        scan_items.append((frame, item, frame_chain))
                            except Exception:
                                pass

                    # Resolve locators
                    resolved = []
                    for frame, item, _chain in scan_items:
                        ranked = rank_locators(item)
                        chosen = None
                        for loc in ranked:
                            count = await count_locator_matches(frame, loc["strategy"], loc["selector"])
                            loc["count"] = count
                            loc["unique"] = (count == 1)
                            if count == 1:
                                chosen = loc
                                break
                        if chosen is None:
                            for loc in ranked:
                                loc["count"] = None
                                loc["unique"] = False
                            chosen = ranked[0] if ranked else None
                        resolved.append({"ranked": ranked, "chosen": chosen})

                    # Deduplicate names and polish
                    items_list = [item for _frame, item, _chain in scan_items]
                    positional_counters = {}
                    heuristic_results = [heuristic_method_name(item, positional_counters) for item in items_list]
                    heuristic_names = dedupe_names([name for name, _weak in heuristic_results])
                    final_names, name_source = await polish_method_names(items_list, heuristic_names)

                    elements = []
                    for idx, ((_frame, item, frame_chain), res) in enumerate(zip(scan_items, resolved)):
                        if res["chosen"] is None:
                            continue
                        elements.append({
                            "id": idx,
                            "tagName": item.get("tagName", ""),
                            "text": item.get("text") or item.get("value") or "",
                            "action": item.get("action"),
                            "subtype": item.get("subtype"),
                            "disabled": bool(item.get("disabled")),
                            "methodName": final_names[idx],
                            "locator": res["chosen"],
                            "locators": res["ranked"],
                            "frameLocators": frame_chain,
                        })

                    scan_result = {
                        "url": active_page.url,
                        "total": total or len(elements),
                        "truncated": truncated,
                        "nameSource": name_source,
                        "scope": scan_scope,
                        "scopeLabel": scope_label,
                        "elements": elements,
                    }
                    await send_to_client({"type": "page_scan_result", "data": scan_result})
                except Exception as ex:
                    await send_to_client({"type": "page_scan_error", "data": {"message": str(ex)}})
            elif action == "verify":
                verify_action = cmd.get("verifyAction")
                locators = cmd.get("locators") or []
                value = cmd.get("value")
                await send_to_client({"type": "verify_started", "data": {"action": verify_action}})
                try:
                    frame = session.get("last_clicked_frame") or active_page.main_frame
                    success = False
                    result_text = None
                    attempts = []

                    for idx, loc in enumerate(locators):
                        strategy = loc.get("strategy")
                        selector = loc.get("selector")
                        if not strategy or not selector:
                            continue
                        
                        await send_to_client({
                            "type": "verify_attempt",
                            "data": {"index": idx, "source": "ranked", "strategy": strategy, "selector": selector, "status": "trying"}
                        })
                        try:
                            # Build and run action
                            locator = BrowserSessionManager._build_locator(frame, strategy, selector)
                            result_text = await asyncio.wait_for(BrowserSessionManager._execute_verify_action(locator, verify_action, value), timeout=7)
                            attempts.append({"index": idx, "source": "ranked", "strategy": strategy, "selector": selector, "status": "success"})
                            success = True
                            break
                        except Exception as e:
                            attempts.append({"index": idx, "source": "ranked", "strategy": strategy, "selector": selector, "status": "failed", "error": str(e)})

                    # Run fallback LLM fix if failed
                    if not success:
                        failed_attempts = [{"strategy": a["strategy"], "selector": a["selector"], "error": a.get("error", "")} for a in attempts]
                        fixes, _ = await propose_locator_fix(cmd.get("element") or {}, failed_attempts)
                        for idx, fix in enumerate(fixes):
                            fix_idx = len(attempts)
                            await send_to_client({
                                "type": "verify_attempt",
                                "data": {"index": fix_idx, "source": "llm", "strategy": fix["strategy"], "selector": fix["selector"], "status": "trying"}
                            })
                            try:
                                locator = BrowserSessionManager._build_locator(frame, fix["strategy"], fix["selector"])
                                result_text = await asyncio.wait_for(BrowserSessionManager._execute_verify_action(locator, verify_action, value), timeout=7)
                                attempts.append({"index": fix_idx, "source": "llm", "strategy": fix["strategy"], "selector": fix["selector"], "status": "success"})
                                success = True
                                break
                            except Exception as e:
                                attempts.append({"index": fix_idx, "source": "llm", "strategy": fix["strategy"], "selector": fix["selector"], "status": "failed", "error": str(e)})

                    await send_to_client({
                        "type": "verify_result",
                        "data": {
                            "success": success,
                            "action": verify_action,
                            "attempts": attempts,
                            "resultText": result_text
                        }
                    })
                except Exception as ex:
                    await send_to_client({"type": "verify_result", "data": {"success": False, "action": verify_action, "error": str(ex)}})
            
            # Interactive Canvas mouse inputs
            elif action == "mouse_click":
                x = cmd.get("x", 0.5)
                y = cmd.get("y", 0.5)
                viewport = active_page.viewport_size or {"width": 1280, "height": 720}
                await active_page.mouse.click(x * viewport["width"], y * viewport["height"])
            elif action == "mouse_down":
                x = cmd.get("x", 0.5)
                y = cmd.get("y", 0.5)
                viewport = active_page.viewport_size or {"width": 1280, "height": 720}
                await active_page.mouse.move(x * viewport["width"], y * viewport["height"])
                await active_page.mouse.down(button=cmd.get("button", "left"))
            elif action == "mouse_up":
                x = cmd.get("x", 0.5)
                y = cmd.get("y", 0.5)
                viewport = active_page.viewport_size or {"width": 1280, "height": 720}
                await active_page.mouse.move(x * viewport["width"], y * viewport["height"])
                await active_page.mouse.up(button=cmd.get("button", "left"))
            elif action == "mouse_move":
                x = cmd.get("x", 0.5)
                y = cmd.get("y", 0.5)
                viewport = active_page.viewport_size or {"width": 1280, "height": 720}
                await active_page.mouse.move(x * viewport["width"], y * viewport["height"])
            elif action == "mouse_wheel":
                delta_x = cmd.get("deltaX", 0)
                delta_y = cmd.get("deltaY", 0)
                await active_page.mouse.wheel(delta_x, delta_y)
            elif action == "keyboard_press":
                key = cmd.get("key")
                if key:
                    await active_page.keyboard.press(key)
            elif action == "paste":
                text = cmd.get("text", "")
                if text:
                    await active_page.keyboard.insert_text(text)
            elif action == "explore":
                if session and (session.get("verify_in_progress") or session.get("explore_in_progress")):
                    continue
                explore_prompt = cmd.get("prompt")
                explore_scope = cmd.get("scope", "page")
                await send_to_client({"type": "explore_started", "data": {}})
                asyncio.create_task(
                    BrowserSessionManager.run_page_exploration(session_id, explore_prompt, explore_scope)
                )
            elif action == "stop-explore":
                if session:
                    session["explore_cancelled"] = True

    except WebSocketDisconnect:
        print(f"WebSocket disconnected: {session_id}")
    except Exception as e:
        print(f"Local sidecar WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        ws_connected = False
        # Clean up browser session
        if session_id in _active_sessions:
            session = _active_sessions[session_id]
            try:
                await session["context"].close()
                await session["playwright_mgr"].stop()
            except Exception:
                pass
            del _active_sessions[session_id]
            if session_id in BrowserSessionManager._sessions:
                del BrowserSessionManager._sessions[session_id]
        print(f"Local browser session terminated: {session_id}")

@app.get("/api/browser/sessions")
async def list_local_sessions():
    return [
        {
            "session_id": s_id,
            "status": "active",
            "created_at": "",
            "profile_id": None
        }
        for s_id in _active_sessions.keys()
    ]

@app.post("/api/browser/sessions")
async def create_local_session():
    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    return {"session_id": session_id, "status": "pending"}

@app.delete("/api/browser/sessions/{session_id}")
async def delete_local_session(session_id: str):
    if session_id in _active_sessions:
        session = _active_sessions[session_id]
        try:
            await session["context"].close()
            await session["playwright_mgr"].stop()
        except Exception:
            pass
        del _active_sessions[session_id]
    return {"message": f"Local session {session_id} closed"}

@app.get("/api/browser/network/{session_id}/logs")
async def get_local_network_logs(session_id: str):
    return _network_logs.get(session_id) or []

@app.get("/api/browser/network/{session_id}/details/{log_id:path}")
async def get_local_network_log_details(session_id: str, log_id: str):
    details = _network_log_details.get(session_id, {}).get(log_id)
    if not details:
        raise HTTPException(status_code=404, detail="Network log details not found")
    return details

@app.post("/api/browser/pom/generate")
async def generate_local_pom(payload: GeneratePOMPayload):
    try:
        pom_code = generate_pom_class(
            class_name=payload.className,
            url=payload.url,
            parent_locator=payload.parentLocator,
            elements=payload.elements
        )
        return {"code": pom_code}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/browser/client/generate")
async def generate_local_client(payload: GenerateClientPayload):
    try:
        logs = []
        for log_id in payload.logIds:
            details = _network_log_details.get(payload.sessionId, {}).get(log_id)
            if details:
                req_data = details["request"]
                req_data["responseBody"] = details["response"].get("body")
                logs.append(req_data)
        client_code = generate_http_client(payload.baseUrl, logs)
        return {"code": client_code}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/browser/pom/add")
async def add_local_pom_method(payload: AddPOMMethodPayload):
    from services.naming import sanitize_method_name

    session_workspace = get_workspace_dir(payload.sessionId)
    os.makedirs(os.path.join(session_workspace, "inspection_code"), exist_ok=True)
    my_page_path = os.path.join(session_workspace, "inspection_code", "my_page.py")

    method_name = sanitize_method_name(payload.methodName)
    method_body = build_pom_method_code(
        method_name, payload.action, payload.strategy, payload.selector, payload.frameLocators or []
    )

    try:
        if not os.path.exists(my_page_path):
            with open(my_page_path, "w") as f:
                f.write(DEFAULT_MY_PAGE_PY)

        with open(my_page_path, "r") as f:
            content = f.read()

        if f"def {method_name}(" in content:
            raise HTTPException(status_code=400, detail=f"Method '{method_name}' already exists in MyPage class")

        if not content.endswith("\n"):
            content += "\n"
        if not content.endswith("\n\n"):
            content += "\n"

        new_content = content + method_body
        with open(my_page_path, "w") as f:
            f.write(new_content)

        return {"message": f"Method {method_name} added successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/browser/pom/add-bulk")
async def add_local_pom_methods_bulk(payload: AddPOMMethodsBulkPayload):
    from services.naming import sanitize_method_name

    session_workspace = get_workspace_dir(payload.sessionId)
    os.makedirs(os.path.join(session_workspace, "inspection_code"), exist_ok=True)
    my_page_path = os.path.join(session_workspace, "inspection_code", "my_page.py")

    try:
        if not os.path.exists(my_page_path):
            with open(my_page_path, "w") as f:
                f.write(DEFAULT_MY_PAGE_PY)

        with open(my_page_path, "r") as f:
            content = f.read()

        added = []
        for method in payload.methods:
            requested = sanitize_method_name(method.methodName)
            final_name = requested
            suffix = 1
            while f"def {final_name}(" in content:
                suffix += 1
                final_name = f"{requested}_{suffix}"

            method_body = build_pom_method_code(
                final_name,
                method.action,
                method.strategy,
                method.selector,
                method.frameLocators or [],
            )

            if not content.endswith("\n"):
                content += "\n"
            if not content.endswith("\n\n"):
                content += "\n"
            content += method_body
            added.append({"requested": requested, "recorded": final_name})

        with open(my_page_path, "w") as f:
            f.write(content)

        return {"count": len(added), "added": added}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Workspace File System Management APIs
@app.get("/api/workspace/files")
async def list_workspace_files(session_id: str = Query(...)):
    workspace_dir = get_workspace_dir(session_id)
    
    # Pre-scaffold boiletplates
    inspection_code_dir = os.path.join(workspace_dir, "inspection_code")
    os.makedirs(inspection_code_dir, exist_ok=True)

    my_page_path = os.path.join(inspection_code_dir, "my_page.py")
    if not os.path.exists(my_page_path):
        with open(my_page_path, "w") as f:
            f.write(DEFAULT_MY_PAGE_PY)

    my_client_path = os.path.join(inspection_code_dir, "my_client.py")
    if not os.path.exists(my_client_path):
        with open(my_client_path, "w") as f:
            f.write(DEFAULT_MY_CLIENT_PY)

    playground_path = os.path.join(workspace_dir, "playground.py")
    if not os.path.exists(playground_path):
        with open(playground_path, "w") as f:
            f.write(DEFAULT_PLAYGROUND_PY)

    main_py_path = os.path.join(workspace_dir, "main.py")
    if not os.path.exists(main_py_path):
        with open(main_py_path, "w") as f:
            f.write(DEFAULT_MAIN_PY)

    files = []
    # Scan root folder
    for entry in os.scandir(workspace_dir):
        if entry.is_file() and entry.name.endswith(".py"):
            stat = entry.stat()
            files.append({
                "name": entry.name,
                "size": stat.st_size,
                "updatedAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
            })
    # Scan inspection_code folder
    for entry in os.scandir(inspection_code_dir):
        if entry.is_file() and entry.name.endswith(".py"):
            stat = entry.stat()
            files.append({
                "name": f"inspection_code/{entry.name}",
                "size": stat.st_size,
                "updatedAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
            })

    files.sort(key=lambda x: (x["name"] != "main.py", x["name"]))
    return files

@app.get("/api/workspace/files/{filename:path}")
async def read_workspace_file(filename: str, session_id: str = Query(...)):
    workspace_dir = get_workspace_dir(session_id)
    safe_name = sanitize_filename(filename)
    file_path = os.path.join(workspace_dir, safe_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    with open(file_path, "r") as f:
        content = f.read()
    return {"filename": safe_name, "content": content}

@app.post("/api/workspace/files/{filename:path}")
async def save_workspace_file(filename: str, payload: FileSavePayload, session_id: str = Query(...)):
    workspace_dir = get_workspace_dir(session_id)
    safe_name = sanitize_filename(filename)
    if safe_name.startswith("inspection_code/"):
        raise HTTPException(status_code=403, detail="Files inside inspection_code/ are read-only")
    file_path = os.path.join(workspace_dir, safe_name)
    with open(file_path, "w") as f:
        f.write(payload.content)
    return {"message": f"File {safe_name} saved successfully"}

@app.delete("/api/workspace/files/{filename:path}")
async def delete_workspace_file(filename: str, session_id: str = Query(...)):
    workspace_dir = get_workspace_dir(session_id)
    safe_name = sanitize_filename(filename)
    if safe_name.startswith("inspection_code/"):
        raise HTTPException(status_code=403, detail="Files inside inspection_code/ are read-only")
    if safe_name == "main.py":
        raise HTTPException(status_code=400, detail="Cannot delete main.py")
    file_path = os.path.join(workspace_dir, safe_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    os.remove(file_path)
    return {"message": f"File {safe_name} deleted successfully"}

@app.post("/api/workspace/reset")
async def reset_workspace(payload: FileResetPayload):
    workspace_dir = get_workspace_dir(payload.sessionId)
    safe_name = sanitize_filename(payload.filename)
    file_path = os.path.join(workspace_dir, safe_name)
    if safe_name.startswith("inspection_code/"):
        raise HTTPException(status_code=403, detail="Files inside inspection_code/ are read-only")

    content = ""
    if safe_name == "playground.py":
        content = DEFAULT_PLAYGROUND_PY
    elif safe_name == "main.py":
        content = DEFAULT_MAIN_PY
    else:
        content = ""

    with open(file_path, "w") as f:
        f.write(content)

    return {"message": f"File {safe_name} reset to default template"}

@app.post("/api/workspace/run")
async def run_local_script_direct(payload: RunScriptPayload):
    session_workspace = get_workspace_dir(payload.session_id)
    file_path = os.path.join(session_workspace, payload.filename)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"Script {payload.filename} not found in workspace")

    # Determine virtualenv python path or fallback to system python
    python_bin = os.path.join(VENV_DIR, "bin", "python") if os.name != "nt" else os.path.join(VENV_DIR, "Scripts", "python")
    if not os.path.exists(python_bin):
        python_bin = "python" # fallback

    from fastapi.responses import StreamingResponse

    async def log_streamer():
        yield f"--- Starting local execution of {payload.filename} ---\n"
        process = None
        try:
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            # Point to local headful browser debugging port
            env["BROWSER_CDP_URL"] = "http://localhost:9222"
            
            process = await asyncio.create_subprocess_exec(
                python_bin, "-u", file_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=session_workspace,
                env=env
            )
            _running_processes[payload.session_id] = process

            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                yield line.decode("utf-8")

            await process.wait()
            yield f"\n--- Script completed with exit code {process.returncode} ---\n"
        except Exception as err:
            yield f"\nExecution Error: {str(err)}\n"
        finally:
            if payload.session_id in _running_processes:
                del _running_processes[payload.session_id]
            if process and process.returncode is None:
                try:
                    process.terminate()
                except Exception:
                    pass

    return StreamingResponse(log_streamer(), media_type="text/event-stream")

@app.post("/api/workspace/stop")
async def stop_workspace_script(session_id: str = Query(...)):
    process = _running_processes.get(session_id)
    if process:
        try:
            process.terminate()
            await asyncio.sleep(0.5)
            if process.returncode is None:
                process.kill()
        except Exception:
            pass
        if session_id in _running_processes:
            del _running_processes[session_id]
        return {"message": "Process terminated successfully"}
    return {"message": "No running script found for this session"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8484)
