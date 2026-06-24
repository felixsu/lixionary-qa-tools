import json
import re
from typing import Dict, Any, List, Optional
from playwright.async_api import async_playwright, Browser, BrowserContext, Page, Request, Response
from config import settings
from db.redis_client import RedisClient

class BrowserSessionManager:
    # Dictionary to keep active sessions: {session_id: {"browser": browser, "context": context, "page": page}}
    _sessions = {}

    @classmethod
    async def get_or_create_session(cls, session_id: str, ws_send_callback=None) -> Page:
        """
        Retrieves or creates a Playwright CDP session connecting to the VNC browser.
        Exposes page event listeners to record network traffic and DOM mutations.
        """
        if session_id in cls._sessions:
            session = cls._sessions[session_id]
            # Check if browser is still connected
            if session["browser"].is_connected():
                if ws_send_callback:
                    # Update callback
                    session["callback"] = ws_send_callback
                return session["page"]
            else:
                await cls.close_session(session_id)

        print(f"Creating new Playwright CDP session: {session_id} to {settings.BROWSER_CDP_URL}")
        
        # Start playwright
        playwright_mgr = await async_playwright().start()
        
        # Connect over CDP to VNC browser
        browser = await playwright_mgr.chromium.connect_over_cdp(settings.BROWSER_CDP_URL)
        
        # Get active context or create new one
        contexts = browser.contexts
        if contexts:
            context = contexts[0]
        else:
            context = await browser.new_context(viewport={"width": 1280, "height": 720})

        # Get active page or create one
        pages = context.pages
        if pages:
            page = pages[0]
        else:
            page = await context.new_page()

        cls._sessions[session_id] = {
            "playwright_mgr": playwright_mgr,
            "browser": browser,
            "context": context,
            "page": page,
            "callback": ws_send_callback,
            "inspect_enabled": False
        }

        # Setup event listeners
        await cls._setup_listeners(session_id, page)
        
        # Inject element inspection javascript overlay script
        await cls.inject_inspector_script(page, session_id)

        return page

    @classmethod
    async def close_session(cls, session_id: str):
        if session_id in cls._sessions:
            print(f"Closing browser session: {session_id}")
            session = cls._sessions[session_id]
            try:
                # We do not close the browser since it's a shared VNC instance,
                # we just disconnect our CDP client and stop the playwright manager.
                await session["playwright_mgr"].stop()
            except Exception as e:
                print(f"Error closing session: {e}")
            del cls._sessions[session_id]

    @classmethod
    async def _setup_listeners(cls, session_id: str, page: Page):
        """
        Attaches request/response event listeners to log network traffic to Redis.
        Also pushes events to the active WebSocket client.
        """
        async def handle_request(req: Request):
            session = cls._sessions.get(session_id)
            if not session:
                return

            req_data = {
                "id": req.url + "_" + str(id(req)),
                "url": req.url,
                "method": req.method,
                "headers": req.headers,
                "resourceType": req.resource_type
            }

            # Save in Redis ephemeral storage for filtering/details inspect
            redis_key = f"network:{session_id}:{req_data['id']}"
            await RedisClient.set_json(redis_key, json.dumps(req_data), expire_seconds=1800)

            # Send real-time event to Frontend
            if session.get("callback"):
                await session["callback"]({
                    "type": "network_request",
                    "data": req_data
                })

        async def handle_response(res: Response):
            session = cls._sessions.get(session_id)
            if not session:
                return

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

            redis_key = f"network:response:{session_id}:{res_data['id']}"
            await RedisClient.set_json(redis_key, json.dumps(res_data), expire_seconds=1800)

            if session.get("callback"):
                await session["callback"]({
                    "type": "network_response",
                    "data": {
                        "id": res_data["id"],
                        "status": res_data["status"],
                        "statusText": res_data["statusText"]
                    }
                })

        page.on("request", handle_request)
        page.on("response", handle_response)

        # Re-inject inspector overlay script on frame navigation
        async def handle_nav(frame):
            if frame == page.main_frame:
                await cls.inject_inspector_script(page, session_id)
                session = cls._sessions.get(session_id)
                if session and session.get("callback"):
                    await session["callback"]({
                        "type": "navigation",
                        "url": page.url
                    })

        page.on("framenavigated", handle_nav)

    @classmethod
    async def inject_inspector_script(cls, page: Page, session_id: str):
        """
        Injects the inspector JS runtime into the target page.
        Allows hover outlines and interception of clicked elements.
        """
        # Register python callback for selected elements
        async def on_element_selected(element_info_str: str):
            session = cls._sessions.get(session_id)
            if not session:
                return
            
            try:
                el_info = json.loads(element_info_str)
                ranked_locators = rank_locators(el_info)
                
                if session.get("callback"):
                    await session["callback"]({
                        "type": "element_selected",
                        "data": {
                            "element": el_info,
                            "locators": ranked_locators
                        }
                    })
            except Exception as e:
                print(f"Error processing selected element: {e}")

        await page.expose_function("pythonOnElementSelected", on_element_selected)

        # Script to inject into browser
        inspector_js = """
        (function() {
            if (window.__lixionary_inspector_injected) return;
            window.__lixionary_inspector_injected = true;

            let inspectMode = false;
            let hoverOverlay = null;

            // Create canvas hover border outline
            function createHoverOverlay() {
                if (hoverOverlay) return;
                hoverOverlay = document.createElement('div');
                hoverOverlay.id = 'lixionary-hover-overlay';
                hoverOverlay.style.position = 'absolute';
                hoverOverlay.style.pointerEvents = 'none';
                hoverOverlay.style.border = '2px dashed #6366f1';
                hoverOverlay.style.backgroundColor = 'rgba(99, 102, 241, 0.1)';
                hoverOverlay.style.zIndex = '999999';
                hoverOverlay.style.transition = 'all 0.1s ease';
                hoverOverlay.style.display = 'none';
                document.body.appendChild(hoverOverlay);
            }

            // Expose control API
            window.__setLixionaryInspectMode = function(enabled) {
                inspectMode = enabled;
                if (!inspectMode && hoverOverlay) {
                    hoverOverlay.style.display = 'none';
                }
            };

            // Gather element metadata
            function getElementMetadata(el) {
                const rect = el.getBoundingClientRect();
                
                // Helper to get CSS selector path
                const getCssPath = (node) => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return '';
                    let path = [];
                    while (node && node.nodeType === Node.ELEMENT_NODE) {
                        let selector = node.nodeName.toLowerCase();
                        if (node.id) {
                            selector += '#' + node.id;
                            path.unshift(selector);
                            break; // Stop at ID
                        } else {
                            let sibling = node;
                            let sibIndex = 1;
                            while (sibling = sibling.previousElementSibling) {
                                if (sibling.nodeName.toLowerCase() == node.nodeName.toLowerCase()) {
                                    sibIndex++;
                                }
                            }
                            if (sibIndex > 1) {
                                selector += `:nth-of-type(${sibIndex})`;
                            }
                        }
                        path.unshift(selector);
                        node = node.parentNode;
                    }
                    return path.join(' > ');
                };

                // Helper to get basic XPath selector
                const getXPath = (node) => {
                    if (node.id) return `//*[@id="${node.id}"]`;
                    let path = '';
                    for (; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentNode) {
                        let index = 1;
                        for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
                            if (sibling.nodeType === Node.DOCUMENT_TYPE_NODE) continue;
                            if (sibling.nodeName === node.nodeName) index++;
                        }
                        const tagName = node.nodeName.toLowerCase();
                        path = `/${tagName}[${index}]` + path;
                    }
                    return path;
                };

                return {
                    tagName: el.tagName.toLowerCase(),
                    text: el.innerText ? el.innerText.trim().substring(0, 100) : '',
                    testId: el.getAttribute('data-testid') || el.getAttribute('data-test-id') || '',
                    label: el.getAttribute('aria-label') || el.getAttribute('label') || '',
                    placeholder: el.getAttribute('placeholder') || '',
                    role: el.getAttribute('role') || '',
                    cssSelector: getCssPath(el),
                    xpath: getXPath(el),
                    classes: el.className || '',
                    rect: {
                        top: rect.top + window.scrollY,
                        left: rect.left + window.scrollX,
                        width: rect.width,
                        height: rect.height
                    }
                };
            }

            document.addEventListener('mouseover', function(e) {
                if (!inspectMode) return;
                createHoverOverlay();
                
                const el = e.target;
                if (el.id === 'lixionary-hover-overlay') return;

                const rect = el.getBoundingClientRect();
                hoverOverlay.style.top = (rect.top + window.scrollY) + 'px';
                hoverOverlay.style.left = (rect.left + window.scrollX) + 'px';
                hoverOverlay.style.width = rect.width + 'px';
                hoverOverlay.style.height = rect.height + 'px';
                hoverOverlay.style.display = 'block';
            }, true);

            document.addEventListener('click', function(e) {
                if (!inspectMode) return;
                
                const el = e.target;
                if (el.id === 'lixionary-hover-overlay') return;

                e.preventDefault();
                e.stopPropagation();

                // Build metadata and send to python backend
                const metadata = getElementMetadata(el);
                window.pythonOnElementSelected(JSON.stringify(metadata));
            }, true);
        })();
        """
        await page.evaluate(inspector_js)

    @classmethod
    async def set_inspect_mode(cls, session_id: str, enabled: bool):
        session = cls._sessions.get(session_id)
        if session:
            session["inspect_enabled"] = enabled
            # Evaluate control command on page
            await session["page"].evaluate(f"window.__setLixionaryInspectMode({json.dumps(enabled)})")

def rank_locators(metadata: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Locator Priority Engine Algorithm:
    Evaluates element structure and ranks generated Playwright python locator statements.
    Score = PriorityWeight(Strategy) - Penalty(Length)
    """
    locators = []
    tag_name = metadata.get("tagName", "")
    text = metadata.get("text", "")
    test_id = metadata.get("testId", "")
    label = metadata.get("label", "")
    placeholder = metadata.get("placeholder", "")
    role = metadata.get("role", "")
    css = metadata.get("cssSelector", "")
    xpath = metadata.get("xpath", "")

    # 1. Test ID
    if test_id:
        expr = f'page.get_by_test_id("{test_id}")'
        # Priority Weight = 100
        score = 100 - len(expr)
        locators.append({"strategy": "get_by_test_id", "selector": test_id, "statement": expr, "score": score})

    # 2. Label Text
    if label:
        expr = f'page.get_by_label("{label}")'
        # Priority Weight = 90
        score = 90 - len(expr)
        locators.append({"strategy": "get_by_label", "selector": label, "statement": expr, "score": score})

    # 3. Role Selector (with Tag mappings to standard ARIA roles)
    computed_role = role
    if not computed_role:
        # Fallback mappings for standard HTML tags
        if tag_name == "button":
            computed_role = "button"
        elif tag_name == "input" and metadata.get("classes", "") != "checkbox":
            computed_role = "textbox"
        elif tag_name == "a":
            computed_role = "link"
        elif tag_name == "select":
            computed_role = "combobox"

    role_name = text or label or placeholder
    if computed_role and role_name:
        expr = f'page.get_by_role("{computed_role}", name="{role_name}")'
        # Priority Weight = 80
        score = 80 - len(expr)
        locators.append({"strategy": "get_by_role", "selector": f'{computed_role}[name="{role_name}"]', "statement": expr, "score": score})

    # 4. Text Locator
    if text and len(text) < 40:
        expr = f'page.get_by_text("{text}")'
        score = 75 - len(expr)
        locators.append({"strategy": "get_by_text", "selector": text, "statement": expr, "score": score})

    # 5. CSS Selector
    if css:
        expr = f'page.locator("{css}")'
        # Priority Weight = 40
        score = 40 - len(expr)
        locators.append({"strategy": "locator (CSS)", "selector": css, "statement": expr, "score": score})

    # 6. XPath
    if xpath:
        expr = f'page.locator("{xpath}")'
        # Priority Weight = 10
        score = 10 - len(expr)
        locators.append({"strategy": "locator (XPath)", "selector": xpath, "statement": expr, "score": score})

    # Sort locators descending by score
    locators.sort(key=lambda x: x["score"], reverse=True)
    return locators
