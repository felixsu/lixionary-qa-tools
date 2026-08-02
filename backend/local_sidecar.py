import io
import os
import sys
import json
import uuid
import asyncio
import zipfile
import subprocess
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response as FastAPIResponse
from playwright.async_api import async_playwright, Page, Request, Response

# Add current directory to path so naming/generator services can be imported
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from local_paths import get_base_dir

# Flavored runtime knobs, injected by the Tauri launcher. Defaults keep a bare
# `python local_sidecar.py` behaving exactly like the production sidecar.
SIDECAR_PORT = int(os.environ.get("SIDECAR_PORT", "8484"))
CDP_PORT = int(os.environ.get("AE_CDP_PORT", "9222"))

from services.browser import BrowserSessionManager, rank_locators, sanitize_cookies, render_recording_script
from services.naming import propose_locator_fix
from services.generator import build_pom_method_code
from db.local_store import LocalStore
from routes.local_store import router as local_store_router
from routes.local_executor import router as local_executor_router
from routes.local_ai import router as local_ai_router
from services.search_indexer import start_background_worker

app = FastAPI(title="Lixionary Local Automation Explorer Sidecar")
app.include_router(local_store_router)
app.include_router(local_executor_router)
app.include_router(local_ai_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_origin_regex=r"(chrome-extension://.*|tauri://.*|http://tauri\.localhost)",
)

@app.get("/health")
async def health():
    # Deliberately no auth/DB touch — pure "is this process accepting HTTP
    # connections" signal for the frontend's backend-monitoring panel,
    # distinct from /api/local-store/device-id which also proves the local
    # SQLite store is functional.
    return {"status": "ok"}

# Shared Local Workspace directory: <base dir>/workspaces
# (~/Documents/AutomationExplorer by default; AE_DATA_DIR overrides per flavor)
BASE_DIR = get_base_dir()
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
    path = os.path.join(WORKSPACE_DIR, "default")
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
            
        # Run pip/playwright as `python -m ...`, never via the venv's console
        # scripts: a moved venv (migrate_legacy_data_dir) leaves script shebangs
        # pointing at the old venv path, so venv/bin/pip fails with "bad
        # interpreter" even though the venv python itself still works.
        python_path = os.path.join(VENV_DIR, "bin", "python") if os.name != "nt" else os.path.join(VENV_DIR, "Scripts", "python.exe")
        print("Installing dependencies in local venv...")
        subprocess.run([python_path, "-m", "pip", "install", "playwright", "httpx", "pydantic"], check=True)

        # Install playwright browsers in venv
        print("Installing local Playwright browsers...")
        subprocess.run([python_path, "-m", "playwright", "install", "chromium"], check=True)
        print("Local venv setup completed successfully.")
    except Exception as e:
        print(f"WARNING: Local virtualenv setup failed: {e}. Running scripts will fallback to system python.")

@app.on_event("startup")
async def startup_event():
    # Local SQLite store for offline-first config data — fast, do inline.
    LocalStore.connect()
    # Backfill/refresh the request search index in the background (also picks
    # up any collections whose descriptions changed while the app was closed).
    asyncio.create_task(start_background_worker())
    # Setup venv in background so startup returns immediately
    asyncio.create_task(asyncio.to_thread(setup_local_venv))

async def get_live_viewport(session, active_page: Page) -> dict:
    """Current page size in CSS px, for scaling normalized mouse coords.

    Screencast frame metadata is authoritative (it tracks window resizes in
    headed no_viewport mode); page.evaluate bridges the gap right after
    connect/tab-switch before the first frame lands; viewport_size is the
    headless last resort (it is None under no_viewport).
    """
    vp = session.get("live_viewport")
    if vp:
        return vp
    try:
        return await active_page.evaluate("({width: window.innerWidth, height: window.innerHeight})")
    except Exception:
        return active_page.viewport_size or {"width": 1280, "height": 720}

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
        headless = bool(init_cmd.get("headless", False))
        viewport_width = int(init_cmd.get("viewportWidth") or 1280)
        viewport_height = int(init_cmd.get("viewportHeight") or 720)

        # Launch local Chromium browser with remote debugging port enabled.
        # In headed mode the OS window is sized to the profile's resolution
        # (--window-size only applies to a visible window, so it's skipped
        # entirely in headless mode).
        launch_args = [f"--remote-debugging-port={CDP_PORT}"]
        if not headless:
            launch_args.append(f"--window-size={viewport_width},{viewport_height}")
        playwright_mgr = await async_playwright().start()
        browser = await playwright_mgr.chromium.launch(
            headless=headless,
            args=launch_args
        )

        # Auto-granted permissions avoid prompt overlays. Headed mode uses
        # no_viewport so the page tracks the real OS window (including manual
        # resizes) instead of being letterboxed inside an emulated viewport;
        # headless has no OS window, so the profile resolution is applied as
        # an emulated viewport there.
        context_kwargs = {
            "permissions": ["geolocation", "notifications", "camera", "microphone", "clipboard-read", "clipboard-write"]
        }
        if headless:
            context_kwargs["viewport"] = {"width": viewport_width, "height": viewport_height}
        else:
            context_kwargs["no_viewport"] = True
        context = await browser.new_context(**context_kwargs)

        if cookies:
            try:
                await context.add_cookies(sanitize_cookies(cookies))
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
                frame_chain = await BrowserSessionManager._get_frame_locators_chain(source["frame"], session["pages"][session["active_page_index"]])
                el_info["frameLocators"] = frame_chain

                ranked_locators = rank_locators(el_info)
                counts = await asyncio.gather(*[
                    BrowserSessionManager._count_locator_matches(source["frame"], loc["strategy"], loc["selector"])
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

        async def on_interaction_recorded(source, action_json: str):
            try:
                action_data = json.loads(action_json)
                session = _active_sessions.get(session_id)
                if session:
                    frame_chain = await BrowserSessionManager._get_frame_locators_chain(source["frame"], session["pages"][session["active_page_index"]])
                    action_data["element"]["frameLocators"] = frame_chain
                    await BrowserSessionManager.record_interaction(session_id, action_data)
            except Exception as e:
                print(f"Error recording interaction: {e}")

        await context.expose_binding("pythonOnElementSelected", on_element_selected)
        await context.expose_binding("pythonOnInteractionRecorded", on_interaction_recorded)

        # Inject overlay script
        inspector_js = BrowserSessionManager.get_inspector_js()
        await context.add_init_script(inspector_js)

        # Inject recorder script
        recorder_js = BrowserSessionManager.get_recorder_js()
        await context.add_init_script(recorder_js)

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

        async def handle_nav(owner_page: Page, frame):
            try:
                await frame.evaluate(inspector_js)
                await frame.evaluate(recorder_js)
                session = _active_sessions.get(session_id)
                if session:
                    if session.get("inspect_enabled"):
                        await frame.evaluate("window.__setLixionaryInspectMode(true)")
                    if session.get("recording_enabled"):
                        await frame.evaluate("window.__setLixionaryRecordingMode(true)")
            except Exception:
                pass
            if frame == owner_page.main_frame:
                # Only the active tab drives the URL bar — background tabs
                # navigating (e.g. an OAuth popup) must not hijack it.
                session = _active_sessions.get(session_id)
                is_active = True
                if session:
                    try:
                        is_active = session["pages"][session["active_page_index"]] == owner_page
                    except Exception:
                        pass
                if is_active:
                    await send_to_client({"type": "navigation", "url": owner_page.url})

        async def handle_page_close(closed_page: Page):
            session = _active_sessions.get(session_id)
            if not session or closed_page not in session["pages"]:
                return
            idx = session["pages"].index(closed_page)
            was_active = (idx == session["active_page_index"])
            session["pages"].remove(closed_page)
            if not session["pages"]:
                # Last page gone — the whole context is closing, nothing to switch to.
                return
            new_active = session["active_page_index"]
            if idx < new_active:
                new_active -= 1
            elif was_active:
                new_active = min(new_active, len(session["pages"]) - 1)
            session["active_page_index"] = new_active
            if was_active:
                session["last_clicked_frame"] = None
                session["live_viewport"] = None
                new_page = session["pages"][new_active]
                try:
                    await start_screencast(new_page)
                except Exception:
                    pass
                await send_to_client({"type": "navigation", "url": new_page.url})
            await send_to_client({"type": "tab_closed", "data": {"index": idx, "active_index": new_active}})

        def attach_page_handlers(target_page: Page):
            target_page.on("request", lambda r: asyncio.create_task(handle_request(r)))
            target_page.on("response", lambda r: asyncio.create_task(handle_response(r)))
            target_page.on("framenavigated", lambda f, p=target_page: asyncio.create_task(handle_nav(p, f)))
            target_page.on("frameattached", lambda f, p=target_page: asyncio.create_task(handle_nav(p, f)))
            target_page.on("close", lambda p: asyncio.create_task(handle_page_close(p)))

        attach_page_handlers(page)

        # Track tabs/popups the user opens while browsing directly in the
        # headed window — without this they'd be invisible to the app (no
        # screencast, wrong target for inspect/verify).
        async def handle_new_page(new_page: Page):
            session = _active_sessions.get(session_id)
            if not session or new_page in session["pages"]:
                return
            session["pages"].append(new_page)
            attach_page_handlers(new_page)
            idx = session["pages"].index(new_page)
            try:
                await new_page.wait_for_load_state("domcontentloaded", timeout=10000)
            except Exception:
                pass
            await send_to_client({"type": "tab_opened", "data": {"index": idx, "url": new_page.url}})

        context.on("page", lambda p: asyncio.create_task(handle_new_page(p)))

        # Navigate to start URL
        url_to_open = default_url if default_url.startswith(("http://", "https://")) else "about:blank"
        try:
            await page.goto(url_to_open)
        except Exception as e:
            print(f"Initial navigation failed: {e}")

        # --window-size sets the *outer* window (including tab strip and
        # address bar chrome), but the profile resolution should describe the
        # page content area. Measure the actual inner size and grow the
        # window by the chrome delta so the viewport matches the profile
        # exactly. Best effort — a failure just leaves the outer size.
        if not headless:
            try:
                inner = await page.evaluate("({width: window.innerWidth, height: window.innerHeight})")
                delta_w = viewport_width - int(inner["width"])
                delta_h = viewport_height - int(inner["height"])
                if delta_w or delta_h:
                    bounds_cdp = await context.new_cdp_session(page)
                    try:
                        info = await bounds_cdp.send("Browser.getWindowForTarget")
                        window_id = info.get("windowId")
                        bounds = info.get("bounds") or {}
                        if window_id is not None and bounds.get("width") and bounds.get("height"):
                            await bounds_cdp.send("Browser.setWindowBounds", {
                                "windowId": window_id,
                                "bounds": {
                                    "width": int(bounds["width"]) + delta_w,
                                    "height": int(bounds["height"]) + delta_h
                                }
                            })
                    finally:
                        try:
                            await bounds_cdp.detach()
                        except Exception:
                            pass
            except Exception as e:
                print(f"Viewport size correction failed: {e}")

        # Setup active session dict
        _active_sessions[session_id] = {
            "session_id": session_id,
            "playwright_mgr": playwright_mgr,
            "browser": browser,
            "context": context,
            "pages": [page],
            "active_page_index": 0,
            "headless": headless,
            "inspect_enabled": False,
            "recording_enabled": False,
            "recorded_steps": [],
            "last_clicked_frame": None,
            "anchor_frame": None,
            # Live page size in CSS px, refreshed from screencast frame
            # metadata — the mouse handlers scale normalized coords with it
            # so clicks stay accurate after the user resizes the real window.
            "live_viewport": None,
            "callback": send_to_client
        }

        # Register in the shared BrowserSessionManager class registry so background services (e.g. exploration) can locate it
        BrowserSessionManager._sessions[session_id] = _active_sessions[session_id]

        # Start Screencast frame capture via CDP. Wrapped in a restartable
        # helper so tab switches can move the stream to another page.
        screencast_ref = {"cdp": None}

        async def start_screencast(target_page: Page):
            old_cdp = screencast_ref["cdp"]
            if old_cdp:
                for teardown in ("Page.stopScreencast",):
                    try:
                        await old_cdp.send(teardown)
                    except Exception:
                        pass
                try:
                    await old_cdp.detach()
                except Exception:
                    pass
            new_cdp = await context.new_cdp_session(target_page)
            screencast_ref["cdp"] = new_cdp

            async def on_screencast_frame(event):
                meta = event.get("metadata") or {}
                if meta.get("deviceWidth") and meta.get("deviceHeight"):
                    sess = _active_sessions.get(session_id)
                    if sess is not None:
                        sess["live_viewport"] = {"width": meta["deviceWidth"], "height": meta["deviceHeight"]}
                await send_to_client({
                    "type": "screencast_frame",
                    "data": {
                        "image": event["data"],
                        "metadata": event["metadata"],
                        "sessionId": event.get("sessionId")
                    }
                })
                try:
                    await new_cdp.send("Page.screencastFrameAck", {"sessionId": event["sessionId"]})
                except Exception:
                    pass

            new_cdp.on("Page.screencastFrame", lambda e: asyncio.create_task(on_screencast_frame(e)))
            await new_cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 80})

        await start_screencast(page)

        # Tell client we are connected, including the effective viewport so
        # the frontend doesn't rely on its own possibly-stale copy of the
        # profile's resolution for click-coordinate scaling. In headed mode
        # the real viewport can differ from the requested one (window chrome,
        # OS constraints), so measure it rather than echoing the profile.
        status_viewport = {"width": viewport_width, "height": viewport_height}
        if not headless:
            try:
                status_viewport = await page.evaluate("({width: window.innerWidth, height: window.innerHeight})")
            except Exception:
                pass
        await send_to_client({
            "type": "status",
            "data": {
                "connected": True,
                "url": page.url,
                "viewport": status_viewport
            }
        })

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
            elif action == "start-recording":
                session["recording_enabled"] = True
                session["recorded_steps"] = []
                # Initialize my_recording.py with boilerplate
                my_recording_path = os.path.join(get_workspace_dir(session_id), "my_recording.py")
                with open(my_recording_path, "w") as f:
                    f.write(render_recording_script([]))

                # Enable recording mode on page frames
                await BrowserSessionManager.set_recording_mode(session_id, True)
                await send_to_client({"type": "recording_started"})

            elif action == "stop-recording":
                session["recording_enabled"] = False
                await BrowserSessionManager.set_recording_mode(session_id, False)
                await send_to_client({"type": "recording_stopped"})
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
                    # Same enumerate → resolve → name pipeline Explore uses.
                    scan_items, total, truncated, scope_label = await BrowserSessionManager._enumerate_interactive_elements(session_id, scan_scope)
                    resolved = await BrowserSessionManager._resolve_locators_for_items(scan_items)
                    scan_result = await BrowserSessionManager._finalize_scan_elements(
                        scan_items, resolved, active_page.url, scan_scope, scope_label, total, truncated
                    )
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
            elif action == "test-selector":
                raw_selector = (cmd.get("selector") or "").strip()
                if not raw_selector:
                    await send_to_client({
                        "type": "selector_test_result",
                        "data": {"selector": "", "totalCount": 0, "frames": [], "error": "Selector is empty"}
                    })
                    continue
                total_count = 0
                frame_results = []
                first_error = None
                for frame in active_page.frames:
                    try:
                        loc = BrowserSessionManager._build_locator(frame, "locator (Custom)", raw_selector)
                        count = await loc.count()
                    except Exception as e:
                        if first_error is None:
                            first_error = BrowserSessionManager._clean_verify_error(e)
                        continue
                    if count > 0:
                        total_count += count
                        try:
                            await loc.evaluate_all(
                                "els => window.__lixionaryHighlightMatches && window.__lixionaryHighlightMatches(els)"
                            )
                        except Exception:
                            pass
                        frame_chain = await BrowserSessionManager._get_frame_locators_chain(frame, active_page)
                        frame_results.append({"frameLocators": frame_chain, "count": count})
                await send_to_client({
                    "type": "selector_test_result",
                    "data": {
                        "selector": raw_selector,
                        "totalCount": total_count,
                        "frames": frame_results,
                        # An invalid selector fails in every frame; a valid one that
                        # simply matched nothing reports 0 without an error.
                        "error": first_error if total_count == 0 else None,
                    }
                })
            elif action == "clear-highlight":
                for frame in active_page.frames:
                    try:
                        await frame.evaluate("window.__lixionaryClearLixHighlights && window.__lixionaryClearLixHighlights()")
                    except Exception:
                        pass
            elif action == "switch_tab":
                idx = int(cmd.get("page_index", 0))
                if 0 <= idx < len(session["pages"]) and idx != session["active_page_index"]:
                    session["active_page_index"] = idx
                    session["last_clicked_frame"] = None
                    # Drop the cached size until the new tab's first frame
                    # lands — get_live_viewport falls back to measuring.
                    session["live_viewport"] = None
                    new_active = session["pages"][idx]
                    try:
                        await new_active.bring_to_front()
                    except Exception:
                        pass
                    try:
                        await start_screencast(new_active)
                    except Exception:
                        pass
                    if session.get("inspect_enabled"):
                        for frame in new_active.frames:
                            try:
                                await frame.evaluate("window.__setLixionaryInspectMode(true)")
                            except Exception:
                                pass
                    await send_to_client({"type": "navigation", "url": new_active.url})
            elif action == "close_tab":
                idx = int(cmd.get("page_index", 0))
                if 0 <= idx < len(session["pages"]) and len(session["pages"]) > 1:
                    # handle_page_close (page "close" event) does the bookkeeping
                    await session["pages"][idx].close()

            # Interactive Canvas mouse inputs
            elif action == "mouse_click":
                x = cmd.get("x", 0.5)
                y = cmd.get("y", 0.5)
                viewport = await get_live_viewport(session, active_page)
                await active_page.mouse.click(x * viewport["width"], y * viewport["height"])
            elif action == "mouse_down":
                x = cmd.get("x", 0.5)
                y = cmd.get("y", 0.5)
                viewport = await get_live_viewport(session, active_page)
                await active_page.mouse.move(x * viewport["width"], y * viewport["height"])
                await active_page.mouse.down(button=cmd.get("button", "left"))
            elif action == "mouse_up":
                x = cmd.get("x", 0.5)
                y = cmd.get("y", 0.5)
                viewport = await get_live_viewport(session, active_page)
                await active_page.mouse.move(x * viewport["width"], y * viewport["height"])
                await active_page.mouse.up(button=cmd.get("button", "left"))
            elif action == "mouse_move":
                x = cmd.get("x", 0.5)
                y = cmd.get("y", 0.5)
                viewport = await get_live_viewport(session, active_page)
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

@app.post("/api/browser/pom/add")
async def add_local_pom_method(payload: AddPOMMethodPayload):
    from services.naming import sanitize_method_name

    session_workspace = get_workspace_dir(payload.sessionId)
    os.makedirs(os.path.join(session_workspace, "inspection_code"), exist_ok=True)
    my_page_path = os.path.join(session_workspace, "inspection_code", "my_page.py")

    method_name = sanitize_method_name(payload.methodName)

    page_url = None
    session = _active_sessions.get(payload.sessionId)
    if session:
        try:
            active_page = session["pages"][session["active_page_index"]]
            page_url = active_page.url
        except Exception:
            pass

    method_body = build_pom_method_code(
        method_name, payload.action, payload.strategy, payload.selector, payload.frameLocators or [], page_url
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

    page_url = None
    session = _active_sessions.get(payload.sessionId)
    if session:
        try:
            active_page = session["pages"][session["active_page_index"]]
            page_url = active_page.url
        except Exception:
            pass

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
                page_url,
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

    if safe_name == "inspection_code/my_page.py":
        content = DEFAULT_MY_PAGE_PY
    elif safe_name == "inspection_code/my_client.py":
        content = DEFAULT_MY_CLIENT_PY
    elif safe_name.startswith("inspection_code/"):
        raise HTTPException(status_code=403, detail="Files inside inspection_code/ are read-only")
    elif safe_name == "playground.py":
        content = DEFAULT_PLAYGROUND_PY
    elif safe_name == "main.py":
        content = DEFAULT_MAIN_PY
    else:
        content = ""

    with open(file_path, "w") as f:
        f.write(content)

    return {"message": f"File {safe_name} reset to default template", "content": content}

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
            # Point to this flavor's headful browser debugging port
            env["BROWSER_CDP_URL"] = f"http://localhost:{CDP_PORT}"
            
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

# Desktop OAuth relay: in the packaged app the Google sign-in must run in
# the system browser (Google Identity Services popups don't work inside the
# webview). The browser lands on the callback page, which drops the auth code
# here; the app polls to pick it up. Single slot, consumed on read, short TTL.
_auth_bridge_slot: Optional[Dict[str, Any]] = None

class AuthBridgeCode(BaseModel):
    code: str
    state: Optional[str] = None

@app.post("/api/auth-bridge/code")
async def push_auth_bridge_code(payload: AuthBridgeCode):
    global _auth_bridge_slot
    _auth_bridge_slot = {
        "code": payload.code,
        "state": payload.state,
        "ts": datetime.now(timezone.utc).timestamp(),
    }
    return {"ok": True}

@app.get("/api/auth-bridge/code")
async def pop_auth_bridge_code():
    global _auth_bridge_slot
    slot = _auth_bridge_slot
    _auth_bridge_slot = None
    if not slot or datetime.now(timezone.utc).timestamp() - slot["ts"] > 180:
        return {"pending": True}
    return {"pending": False, "code": slot["code"], "state": slot["state"]}

# Chrome extension helper WebSocket globals
_extension_ws: Optional[WebSocket] = None
_extension_requests: Dict[str, asyncio.Future] = {}

@app.websocket("/api/browser-helper/ws")
async def extension_helper_websocket(websocket: WebSocket):
    global _extension_ws
    await websocket.accept()
    _extension_ws = websocket
    print("Chrome Extension Helper connected to sidecar WebSocket.")
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            if message.get("type") == "PING":
                # Keepalive from the extension's MV3 service worker
                await websocket.send_json({"type": "PONG"})
                continue
            req_id = message.get("requestId")
            if req_id and req_id in _extension_requests:
                _extension_requests[req_id].set_result(message)
    except WebSocketDisconnect:
        print("Chrome Extension Helper disconnected from sidecar.")
    finally:
        if _extension_ws == websocket:
            _extension_ws = None

async def send_extension_request(req_type: str, payload: Any = None, timeout: float = 5.0) -> Dict[str, Any]:
    global _extension_ws
    if not _extension_ws:
        raise HTTPException(status_code=503, detail="Chrome Extension Helper is not connected to sidecar")
    
    req_id = str(uuid.uuid4())
    future = asyncio.get_event_loop().create_future()
    _extension_requests[req_id] = future
    
    try:
        await _extension_ws.send_json({
            "type": req_type,
            "payload": payload,
            "requestId": req_id
        })
        response = await asyncio.wait_for(future, timeout=timeout)
        if not response.get("success"):
            raise HTTPException(status_code=500, detail=response.get("error", "Unknown error from extension"))
        return response
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Request to Chrome Extension Helper timed out")
    finally:
        _extension_requests.pop(req_id, None)

@app.get("/api/browser-helper/status")
async def get_helper_status():
    return {"connected": _extension_ws is not None}

# The chrome-extension directory sits next to backend/ both in the repo and in
# the Tauri bundle's resource directory (see tauri.conf.json bundle.resources).
EXTENSION_SRC_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "chrome-extension")
)

@app.get("/api/browser-helper/extension")
async def download_extension_zip():
    if not os.path.isdir(EXTENSION_SRC_DIR):
        raise HTTPException(status_code=404, detail="Chrome extension source not found next to the sidecar")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(EXTENSION_SRC_DIR):
            for fname in files:
                full = os.path.join(root, fname)
                rel = os.path.relpath(full, EXTENSION_SRC_DIR)
                zf.write(full, os.path.join("automation-explorer-helper", rel))
    return FastAPIResponse(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=automation-explorer-helper.zip"},
    )

@app.get("/api/browser-helper/tabs")
async def get_helper_tabs():
    res = await send_extension_request("GET_TABS")
    return res.get("payload", [])

class HelperDataRequest(BaseModel):
    tabId: int
    url: str

@app.post("/api/browser-helper/data")
async def get_helper_data(payload: HelperDataRequest):
    res = await send_extension_request("GET_DATA", payload.dict())
    return res.get("payload", {})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=SIDECAR_PORT)
