import asyncio
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
    async def get_or_create_session(cls, session_id: str, ws_send_callback=None, cookies=None, local_storage=None, user_id=None, default_url=None) -> Page:
        """
        Retrieves or creates a Playwright CDP session connecting to the VNC browser.
        Exposes page event listeners to record network traffic and DOM mutations.
        """
        if session_id in cls._sessions:
            session = cls._sessions[session_id]
            # Check if browser is still connected
            if session["browser"].is_connected():
                if ws_send_callback:
                    session["callback"] = ws_send_callback
                if user_id:
                    session["user_id"] = user_id

                # Re-inject cookies — profile auth tokens may have been refreshed since session start
                if cookies:
                    try:
                        if isinstance(cookies, list) and cookies:
                            await session["context"].add_cookies(cookies)
                    except Exception as e:
                        print(f"Failed to re-inject cookies on reconnect: {e}")

                # Navigate to the profile's default URL to restore a known page state.
                # The localStorage init script already registered in the context fires on this navigation.
                page = cls._active_page(session)
                if default_url and default_url.startswith(("http://", "https://")):
                    try:
                        await page.goto(default_url)
                    except Exception as e:
                        print(f"Failed to navigate to default URL on reconnect: {e}")

                return page
            else:
                await cls.close_session(session_id)

        # Resolve/spawn dynamic browser container using DockerClient
        from services.docker_client import DockerClient, DockerException
        docker_client = DockerClient()
        container_name = f"lixionary-vnc-browser-{session_id}"
        
        # Check if container already exists and is running
        container_info = await docker_client.inspect_container(container_name)
        assigned_port = 8080
        
        if container_info and container_info.get("State", {}).get("Running"):
            print(f"Reusing existing dynamic browser container: {container_name}")
            # Retrieve the host port mapped to 8080/tcp
            ports = container_info.get("NetworkSettings", {}).get("Ports", {})
            vnc_ports = ports.get("8080/tcp")
            if vnc_ports and len(vnc_ports) > 0:
                host_port_str = vnc_ports[0].get("HostPort")
                if host_port_str:
                    assigned_port = int(host_port_str)
        else:
            # If container exists but stopped, remove it first
            if container_info:
                try:
                    await docker_client.remove_container(container_name, force=True)
                except Exception:
                    pass

            print(f"Spawning new dynamic VNC-browser container: {container_name}")
            
            # Inspect template container 'lixionary-vnc-browser' to clone config
            template_info = await docker_client.inspect_container("lixionary-vnc-browser")
            if not template_info:
                raise Exception("Template container 'lixionary-vnc-browser' not found. Cannot clone configuration.")
            
            image = template_info.get("Config", {}).get("Image") or template_info.get("Image")
            env = template_info.get("Config", {}).get("Env", [])
            networks = template_info.get("NetworkSettings", {}).get("Networks", {})
            
            # Copy template environment variables and inject the container name
            env_vars = list(env) if env else []
            env_vars.append(f"CONTAINER_NAME={container_name}")
            
            container_config = {
                "Image": image,
                "Env": env_vars,
                "HostConfig": {
                    "PortBindings": {
                        "8080/tcp": [{"HostPort": ""}] # Auto-assign free port
                    },
                    "ShmSize": 2147483648 # 2GB SHM size to prevent Chrome crashes
                }
            }
            
            await docker_client.create_container(container_name, container_config)
            
            # Connect the new container to the same network(s) as the template container
            for net_name in networks.keys():
                await docker_client.connect_network(net_name, container_name)
                
            # Start the container
            await docker_client.start_container(container_name)
            
            # Wait for container port mapping to resolve
            for _ in range(20):
                info = await docker_client.inspect_container(container_name)
                ports = info.get("NetworkSettings", {}).get("Ports", {})
                vnc_ports = ports.get("8080/tcp")
                if vnc_ports and len(vnc_ports) > 0:
                    host_port_str = vnc_ports[0].get("HostPort")
                    if host_port_str:
                        assigned_port = int(host_port_str)
                        break
                await asyncio.sleep(0.2)

        cdp_url = f"http://{container_name}:9222"
        
        # Wait for the VNC-browser container's CDP endpoint/forwarder to be fully initialized and listening
        import httpx
        cdp_ready = False
        print(f"Waiting for CDP endpoint at {cdp_url} to respond...")
        for _ in range(30): # Wait up to 15 seconds
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(f"{cdp_url}/json/version", timeout=1.0)
                    if resp.status_code == 200:
                        cdp_ready = True
                        break
            except Exception:
                pass
            await asyncio.sleep(0.5)

        if not cdp_ready:
            print(f"WARNING: CDP endpoint at {cdp_url} did not respond within timeout. Attempting connection anyway.")

        print(f"Creating new Playwright CDP session: {session_id} to dynamic container {cdp_url}")
        
        # Start playwright
        playwright_mgr = await async_playwright().start()
        
        # Connect over CDP to dynamic VNC browser container
        browser = await playwright_mgr.chromium.connect_over_cdp(cdp_url)
        
        # Use the default visible browser context so that Chrome window is visible on the VNC desktop.
        # Since each session has its own dedicated Docker container, container-level isolation is sufficient.
        context = browser.contexts[0] if browser.contexts else await browser.new_context(viewport={"width": 1280, "height": 720})

        if cookies:
            try:
                if isinstance(cookies, list) and cookies:
                    await context.add_cookies(cookies)
                    print(f"Successfully injected {len(cookies)} cookies into browser session {session_id}")
            except Exception as e:
                print(f"Failed to inject cookies into context: {e}")

        if local_storage:
            try:
                # We inject localStorage keys using an init script that runs on every page/frame navigation.
                # Supports both key-value dict (old format) and origin-scoped array list (new formats)
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
                            } else if (data.origin && Array.isArray(data.localStorage)) {
                                items = [data];
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
                                                const sessKey = '__lixionary_injected_' + kv.name;
                                                if (!sessionStorage.getItem(sessKey)) {
                                                    localStorage.setItem(kv.name, String(kv.value));
                                                    sessionStorage.setItem(sessKey, 'true');
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        } else if (typeof data === 'object' && data !== null) {
                            // Old format fallback: simple key-value object
                            for (const [key, val] of Object.entries(data)) {
                                const sessKey = '__lixionary_injected_' + key;
                                if (!sessionStorage.getItem(sessKey)) {
                                    localStorage.setItem(key, String(val));
                                    sessionStorage.setItem(sessKey, 'true');
                                }
                            }
                        }
                    } catch (e) {
                        console.error('Lixionary profile localStorage injection error:', e);
                    }
                })();
                """ % json.dumps(local_storage)
                await context.add_init_script(ls_script)
                print(f"Successfully added localStorage injection init script into browser session {session_id}")
            except Exception as e:
                print(f"Failed to inject localStorage script: {e}")

        # Register python callback for selected elements on context level using expose_binding
        async def on_element_selected(source, element_info_str: str):
            session = cls._sessions.get(session_id)
            if not session:
                return

            # Track which frame the element was clicked in (used for iframe anchor support)
            session["last_clicked_frame"] = source["frame"]

            try:
                el_info = json.loads(element_info_str)
                
                # Resolve parent frame locators chain
                frame_chain = await cls._get_frame_locators_chain(source["frame"], cls._active_page(session))
                el_info["frameLocators"] = frame_chain
                
                ranked_locators = rank_locators(el_info)
                
                # Verify uniqueness on the active browser frame
                validated_locators = []
                for loc in ranked_locators:
                    count = await cls._count_locator_matches(
                        source["frame"],
                        loc["strategy"],
                        loc["selector"]
                    )
                    loc["count"] = count
                    loc["unique"] = (count == 1)
                    if count > 1:
                        # Heavily penalize non-unique locators to push them to the bottom
                        loc["score"] -= 1000
                    validated_locators.append(loc)
                
                # Re-sort after adjusting scores
                validated_locators.sort(key=lambda x: x["score"], reverse=True)
                
                if session.get("callback"):
                    await session["callback"]({
                        "type": "element_selected",
                        "data": {
                            "element": el_info,
                            "locators": validated_locators
                        }
                    })
            except Exception as e:
                print(f"Error processing selected element: {e}")

        try:
            await context.expose_binding("pythonOnElementSelected", on_element_selected)
        except Exception:
            pass

        # Register inspector JS as an init script on context to ensure it persists across navigations
        try:
            inspector_js = cls.get_inspector_js()
            await context.add_init_script(inspector_js)
        except Exception as e:
            print(f"Error adding inspector init script to context: {e}")

        # Reuse the existing visible tab if available, otherwise create a new one
        if context.pages:
            page = context.pages[0]
        else:
            page = await context.new_page()

        # Handle startup navigation
        url_to_open = default_url if default_url else "about:blank"
        if url_to_open.startswith("http://") or url_to_open.startswith("https://"):
            try:
                await page.goto(url_to_open)
            except Exception as e:
                print(f"Failed to navigate to default URL on startup: {e}")

        cls._sessions[session_id] = {
            "playwright_mgr": playwright_mgr,
            "browser": browser,
            "context": context,
            "pages": [page],
            "active_page_index": 0,
            "callback": ws_send_callback,
            "inspect_enabled": False,
            "user_id": user_id,
            "vnc_port": assigned_port,
            "cdp_url": cdp_url,
        }

        # Setup event listeners on the first page
        await cls._setup_listeners(session_id, page)
        await cls.inject_inspector_script(page, session_id)

        # Listen for new tabs/popups opened inside this session's context
        async def handle_new_page(new_page: Page):
            session = cls._sessions.get(session_id)
            if not session:
                return
            idx = len(session["pages"])
            session["pages"].append(new_page)
            await cls._setup_listeners(session_id, new_page)
            await cls.inject_inspector_script(new_page, session_id)
            if session.get("callback"):
                await session["callback"]({"type": "tab_opened", "data": {"index": idx, "url": new_page.url}})

            async def on_tab_close():
                session2 = cls._sessions.get(session_id)
                if not session2:
                    return
                try:
                    close_idx = session2["pages"].index(new_page)
                except ValueError:
                    return
                session2["pages"].pop(close_idx)
                if session2["active_page_index"] >= len(session2["pages"]):
                    session2["active_page_index"] = max(0, len(session2["pages"]) - 1)
                if session2.get("callback"):
                    await session2["callback"]({"type": "tab_closed", "data": {"index": close_idx, "active_index": session2["active_page_index"]}})

            new_page.on("close", lambda: asyncio.create_task(on_tab_close()))

        context.on("page", lambda p: asyncio.create_task(handle_new_page(p)))

        return page

    @classmethod
    def _active_page(cls, session: dict) -> Page:
        return session["pages"][session["active_page_index"]]

    @classmethod
    async def close_session(cls, session_id: str):
        if session_id in cls._sessions:
            print(f"Closing browser session: {session_id}")
            session = cls._sessions[session_id]
            try:
                await session["context"].close()
            except Exception as e:
                print(f"Error closing context for session {session_id}: {e}")
            try:
                await session["playwright_mgr"].stop()
            except Exception as e:
                print(f"Error stopping playwright for session {session_id}: {e}")
            del cls._sessions[session_id]

        # Stop and remove the dynamic container
        try:
            from services.docker_client import DockerClient
            docker_client = DockerClient()
            container_name = f"lixionary-vnc-browser-{session_id}"
            print(f"Stopping and removing dynamic browser container: {container_name}")
            await docker_client.stop_container(container_name, timeout=5)
            await docker_client.remove_container(container_name)
        except Exception as e:
            print(f"Error stopping/removing dynamic container {session_id}: {e}")

    @classmethod
    async def _count_locator_matches(cls, frame, strategy: str, selector: str) -> int:
        try:
            if strategy == "get_by_test_id":
                loc = frame.get_by_test_id(selector)
            elif strategy == "get_by_label":
                loc = frame.get_by_label(selector)
            elif strategy == "get_by_role":
                import re
                match = re.match(r'^([^\[]+)\[name="(.+)"\]$', selector)
                if match:
                    role = match.group(1)
                    name = match.group(2)
                    loc = frame.get_by_role(role, name=name)
                else:
                    loc = frame.locator(selector)
            elif strategy == "get_by_text":
                loc = frame.get_by_text(selector)
            elif strategy == "locator (CSS)":
                loc = frame.locator(selector)
            elif strategy == "locator (XPath)":
                loc = frame.locator(selector)
            elif strategy == "locator (Anchored XPath)":
                loc = frame.locator(f"xpath={selector}")
            else:
                loc = frame.locator(selector)
            
            return await loc.count()
        except Exception as e:
            print(f"Error counting matches for strategy {strategy}, selector {selector}: {e}")
            return 0

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
                "resourceType": req.resource_type,
                "postData": req.post_data
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

            if session.get("user_id") and res.status < 400 and req.resource_type in ["fetch", "xhr"]:
                asyncio.create_task(
                    asyncio.to_thread(
                        try_dump_api_call,
                        session["user_id"],
                        session_id,
                        res.url,
                        req.method,
                        req.post_data,
                        resp_body
                    )
                )

        page.on("request", handle_request)
        page.on("response", handle_response)

        # Re-inject inspector overlay script on frame navigation
        async def handle_nav(frame):
            try:
                # Inject inspector JS on the navigated frame
                inspector_js = cls.get_inspector_js()
                await frame.evaluate(inspector_js)
                
                # Check if inspect mode is active
                session = cls._sessions.get(session_id)
                if session and session.get("inspect_enabled"):
                    # Activate inspect mode on the navigated frame
                    eval_script = (
                        "(function() {\n"
                        "    if (typeof window.__setLixionaryInspectMode === 'function') {\n"
                        "        window.__setLixionaryInspectMode(true);\n"
                        "    }\n"
                        "})()"
                    )
                    await frame.evaluate(eval_script)
            except Exception:
                pass

            if frame == page.main_frame:
                session = cls._sessions.get(session_id)
                if session and session.get("callback"):
                    await session["callback"]({
                        "type": "navigation",
                        "url": page.url
                    })

        page.on("framenavigated", handle_nav)
        page.on("frameattached", handle_nav)

    @classmethod
    async def _get_frame_locators_chain(cls, frame, page: Page) -> List[str]:
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
                                if (el.name) return 'iframe[name="' + el.name + '"]';
                                if (el.src) {
                                    const cleanSrc = el.src.split(/[?#]/)[0];
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

    @classmethod
    async def inject_inspector_script(cls, page: Page, session_id: str):
        """
        Injects the inspector JS runtime into the target page.
        Allows hover outlines and interception of clicked elements.
        """
        try:
            inspector_js = cls.get_inspector_js()
            await page.evaluate(inspector_js)
        except Exception as e:
            print(f"Error evaluating inspector script: {e}")

    @classmethod
    def get_inspector_js(cls) -> str:
        return """
        (function() {
            if (window.__lixionary_inspector_injected) return;
            window.__lixionary_inspector_injected = true;

            let inspectMode = false;
            let hoverOverlay = null;
            let lixionaryAnchor = null;
            let lixionaryLastClickedEl = null;

            window.__setLixionaryAnchorFromLast = function() {
                if (lixionaryAnchor) {
                    lixionaryAnchor.style.outline = lixionaryAnchor._prevOutline || '';
                    lixionaryAnchor._prevOutline = undefined;
                }
                lixionaryAnchor = lixionaryLastClickedEl;
                if (lixionaryAnchor) {
                    lixionaryAnchor._prevOutline = lixionaryAnchor.style.outline;
                    lixionaryAnchor.style.outline = '3px solid #22c55e';
                }
                return lixionaryAnchor ? {
                    tagName: lixionaryAnchor.tagName.toLowerCase(),
                    id: lixionaryAnchor.id || '',
                    text: lixionaryAnchor.innerText ? lixionaryAnchor.innerText.trim().substring(0, 50) : ''
                } : null;
            };

            window.__clearLixionaryAnchor = function() {
                if (lixionaryAnchor) {
                    lixionaryAnchor.style.outline = lixionaryAnchor._prevOutline || '';
                    lixionaryAnchor._prevOutline = undefined;
                }
                lixionaryAnchor = null;
            };

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
                if (document.body) {
                    document.body.appendChild(hoverOverlay);
                } else {
                    document.documentElement.appendChild(hoverOverlay);
                }
            }

            // Expose control API
            window.__setLixionaryInspectMode = function(enabled) {
                inspectMode = enabled;
                if (!inspectMode && hoverOverlay) {
                    hoverOverlay.style.display = 'none';
                }
            };

            // Helper to find preceding sibling with text label
            function findPrecedingTextSibling(element) {
                let sibling = element.previousElementSibling;
                while (sibling) {
                    const text = sibling.innerText ? sibling.innerText.trim() : '';
                    if (text && text.length > 0 && text.length < 50 && text.indexOf('\\n') === -1) {
                        return { el: sibling, text: text };
                    }
                    sibling = sibling.previousElementSibling;
                }
                if (element.parentElement) {
                    let parentSibling = element.parentElement.previousElementSibling;
                    while (parentSibling) {
                        const text = parentSibling.innerText ? parentSibling.innerText.trim() : '';
                        if (text && text.length > 0 && text.length < 50 && text.indexOf('\\n') === -1) {
                            return { el: parentSibling, text: text };
                        }
                        parentSibling = parentSibling.previousElementSibling;
                    }
                }
                return null;
            }

            // Generate sibling-anchored XPath
            function getSiblingAnchoredXPath(el) {
                const anchor = findPrecedingTextSibling(el);
                if (!anchor) return null;

                const elTag = el.tagName.toLowerCase();
                const anchorTag = anchor.el.tagName.toLowerCase();
                const anchorText = anchor.text.replace(/"/g, '\\"');

                if (el.parentElement === anchor.el.parentElement) {
                    let index = 1;
                    let sibling = anchor.el.nextElementSibling;
                    while (sibling && sibling !== el) {
                        if (sibling.tagName.toLowerCase() === elTag) {
                            index++;
                        }
                        sibling = sibling.nextElementSibling;
                    }
                    return `//${anchorTag}[text()="${anchorText}"]/following-sibling::${elTag}[${index}]`;
                } else {
                    const commonAncestor = el.parentElement?.parentElement;
                    if (commonAncestor && commonAncestor.contains(anchor.el)) {
                        const descendants = Array.from(commonAncestor.getElementsByTagName(elTag));
                        const index = descendants.indexOf(el) + 1;
                        return `//${anchorTag}[contains(text(), "${anchorText}")]/parent::*//${elTag}[${index}]`;
                    }
                }
                return null;
            }

            // Generate parent-container-anchored XPath
            function getParentContainerAnchoredXPath(el) {
                let ancestor = el.parentElement;
                const elTag = el.tagName.toLowerCase();

                while (ancestor && ancestor.tagName.toLowerCase() !== 'body') {
                    const ancestorTag = ancestor.tagName.toLowerCase();
                    
                    if (ancestorTag === 'tr') {
                        const tds = Array.from(ancestor.getElementsByTagName('td'));
                        for (const td of tds) {
                            const cellText = td.innerText ? td.innerText.trim() : '';
                            if (cellText && cellText.length > 0 && cellText.length < 50 && cellText.indexOf('\\n') === -1) {
                                const escapedCellText = cellText.replace(/"/g, '\\"');
                                const descendants = Array.from(ancestor.getElementsByTagName(elTag));
                                const index = descendants.indexOf(el) + 1;
                                return `//tr[td[text()="${escapedCellText}"]]//${elTag}[${index}]`;
                            }
                        }
                    }
                    
                    const headings = Array.from(ancestor.querySelectorAll('h1, h2, h3, h4, h5, h6, .card-title, .title'));
                    if (headings.length === 1) {
                        const heading = headings[0];
                        const headingText = heading.innerText ? heading.innerText.trim() : '';
                        if (headingText && headingText.length > 0 && headingText.length < 50) {
                            const escapedHeadingText = headingText.replace(/"/g, '\\"');
                            const headingTag = heading.tagName.toLowerCase();
                            const descendants = Array.from(ancestor.getElementsByTagName(elTag));
                            const index = descendants.indexOf(el) + 1;
                            return `//${ancestorTag}[${headingTag}[contains(text(), "${escapedHeadingText}")]]//${elTag}[${index}]`;
                        }
                    }

                    ancestor = ancestor.parentElement;
                }
                return null;
            }

            function getAnchoredXPath(el) {
                try {
                    let xpath = getSiblingAnchoredXPath(el);
                    if (xpath) return xpath;
                    xpath = getParentContainerAnchoredXPath(el);
                    if (xpath) return xpath;
                } catch (e) {
                    console.error('Error generating anchored xpath:', e);
                }
                return '';
            }

            function getAnchorXPathExpr(anchor) {
                if (anchor.id) return '//' + anchor.tagName.toLowerCase() + '[@id="' + anchor.id + '"]';
                const text = anchor.innerText ? anchor.innerText.trim().substring(0, 50) : '';
                if (text && text.indexOf('\\n') === -1 && text.length < 50) {
                    return '//' + anchor.tagName.toLowerCase() + '[contains(text(), "' + text.replace(/"/g, '\\"') + '")]';
                }
                const classes = Array.from(anchor.classList).slice(0, 2);
                if (classes.length > 0) {
                    return '//' + anchor.tagName.toLowerCase() + '[contains(@class, "' + classes[0].replace(/"/g, '\\"') + '")]';
                }
                return null;
            }

            function getUserAnchoredXPath(anchor, target) {
                try {
                    if (!anchor || anchor === target || !anchor.contains(target)) return null;
                    const anchorExpr = getAnchorXPathExpr(anchor);
                    if (!anchorExpr) return null;
                    let parts = [];
                    let el = target;
                    while (el && el !== anchor) {
                        const tag = el.tagName.toLowerCase();
                        if (el.id) {
                            parts.unshift(tag + '[@id="' + el.id + '"]');
                            break;
                        }
                        const parent = el.parentElement;
                        if (!parent) break;
                        const siblings = Array.from(parent.children).filter(function(c) { return c.tagName === el.tagName; });
                        if (siblings.length > 1) {
                            parts.unshift(tag + '[' + (siblings.indexOf(el) + 1) + ']');
                        } else {
                            parts.unshift(tag);
                        }
                        el = parent;
                    }
                    if (parts.length === 0) return null;
                    return anchorExpr + '//' + parts.join('/');
                } catch (e) {
                    console.error('Error generating user-anchored xpath:', e);
                    return null;
                }
            }

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
                    anchoredXpath: getAnchoredXPath(el),
                    userAnchoredXpath: getUserAnchoredXPath(lixionaryAnchor, el) || '',
                    classes: el.className || '',
                    rect: {
                        top: rect.top + window.scrollY,
                        left: rect.left + window.scrollX,
                        width: rect.width,
                        height: rect.height
                    }
                };
            }

            // Universal event blocker
            function blockEvent(e) {
                if (!inspectMode) return;
                const el = e.target;
                if (el.id === 'lixionary-hover-overlay') return;
                e.preventDefault();
                e.stopPropagation();
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

                // Store last clicked element for anchor-setting
                lixionaryLastClickedEl = el;

                // Build metadata and send to python backend
                const metadata = getElementMetadata(el);
                if (window.pythonOnElementSelected) {
                    window.pythonOnElementSelected(JSON.stringify(metadata));
                }
            }, true);

            // Block other pointer/mouse/touch events to prevent dropdowns/buttons from opening/reacting
            document.addEventListener('mousedown', blockEvent, true);
            document.addEventListener('mouseup', blockEvent, true);
            document.addEventListener('pointerdown', blockEvent, true);
            document.addEventListener('pointerup', blockEvent, true);
            document.addEventListener('touchstart', blockEvent, true);
            document.addEventListener('touchend', blockEvent, true);
        })();
        """

    @classmethod
    async def set_inspect_mode(cls, session_id: str, enabled: bool):
        session = cls._sessions.get(session_id)
        if session:
            session["inspect_enabled"] = enabled
            # Evaluate control command on page
            try:
                # Dynamically verify and inject if inspector JS runtime is missing
                eval_script = (
                    "(function() {\n"
                    "    if (typeof window.__setLixionaryInspectMode !== 'function') {\n"
                    f"        {cls.get_inspector_js()}\n"
                    "    }\n"
                    "    if (typeof window.__setLixionaryInspectMode === 'function') {\n"
                    f"        window.__setLixionaryInspectMode({json.dumps(enabled)});\n"
                    "        return true;\n"
                    "    }\n"
                    "    return false;\n"
                    "})()"
                )
                for frame in cls._active_page(session).frames:
                    try:
                        await frame.evaluate(eval_script)
                    except Exception as fe:
                        print(f"Warning: Failed to evaluate inspect mode on frame {frame.url}: {fe}")
            except Exception as e:
                print(f"Error setting inspect mode: {e}")

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

    # 7. Anchored XPath
    anchored_xpath = metadata.get("anchoredXpath", "")
    if anchored_xpath:
        expr = f'page.locator("xpath={anchored_xpath}")'
        # Priority Weight = 110 (stable sibling/parent container anchored selectors)
        score = 110 - len(expr)
        locators.append({
            "strategy": "locator (Anchored XPath)",
            "selector": anchored_xpath,
            "statement": expr,
            "score": score
        })

    # 8. User-selected anchor XPath (highest priority — user explicitly chose the anchor)
    user_anchored_xpath = metadata.get("userAnchoredXpath", "")
    if user_anchored_xpath:
        expr = f'page.locator("xpath={user_anchored_xpath}")'
        score = 120 - len(expr)
        locators.append({
            "strategy": "locator (User Anchor XPath)",
            "selector": user_anchored_xpath,
            "statement": expr,
            "score": score
        })

    # Sort locators descending by score
    locators.sort(key=lambda x: x["score"], reverse=True)
    return locators


import threading

_file_locks = {}
_file_locks_lock = threading.Lock()

def get_session_lock(session_id: str) -> threading.Lock:
    with _file_locks_lock:
        if session_id not in _file_locks:
            _file_locks[session_id] = threading.Lock()
        return _file_locks[session_id]


def try_dump_api_call(user_id: str, session_id: str, url: str, method: str, post_data: Optional[str], response_body: Optional[str]):
    import os
    import urllib.parse
    import re
    from routes.workspace import get_workspace_dir
    from services.generator import json_to_pydantic_code

    try:
        parsed = urllib.parse.urlparse(url)
        hostname = parsed.hostname or ""
        # 1. Match host: *.ninjavan.co or *.ninjavan.dev
        if not (hostname.endswith(".ninjavan.co") or hostname.endswith(".ninjavan.dev")):
            return

        # 2. Parse path segments
        path_parts = [p for p in parsed.path.split("/") if p]
        if not path_parts:
            return

        # Check for 2-digit system id (country code) like sg, id, my, ph
        has_country_code = len(path_parts[0]) == 2 and path_parts[0].isalpha()
        
        # 3. Determine method name
        verb = method.lower().capitalize()  # Get, Post, Put, Patch, Delete
        service_idx = 1 if has_country_code else 0
        if len(path_parts) <= service_idx:
            return
            
        service_name = path_parts[service_idx]
        service_clean = "".join(p.capitalize() for p in re.split(r"[^a-zA-Z0-9]", service_name) if p)
        
        rest_parts = path_parts[service_idx+1:]
        rest_clean_parts = []
        for part in rest_parts:
            # Skip numeric segments or hex/UUIDs or curly placeholders
            if part.isdigit() or re.match(r"^[0-9a-fA-F\-]{32,36}$", part) or part.startswith("{"):
                continue
            clean = "".join(p.capitalize() for p in re.split(r"[^a-zA-Z0-9]", part) if p)
            rest_clean_parts.append(clean)
            
        method_name = f"{verb}{service_clean}{''.join(rest_clean_parts)}"
        
        # 4. Read existing file and perform schema edits inside session lock
        workspace_dir = get_workspace_dir(user_id, session_id)
        my_client_path = os.path.join(workspace_dir, "inspection_code", "my_client.py")
        
        os.makedirs(os.path.dirname(my_client_path), exist_ok=True)
        
        lock = get_session_lock(session_id)
        with lock:
            if not os.path.exists(my_client_path):
                with open(my_client_path, "w") as f:
                    f.write('from __future__ import annotations\nimport httpx\nfrom pydantic import BaseModel, Field\nfrom typing import List, Optional, Any\n\n# --- Pydantic Models ---\n\nclass MyClient:\n    def __init__(self, base_url: str = "https://api-qa.ninjavan.co", token: str = None):\n        self.client = httpx.Client(base_url=base_url)\n        if token:\n            self.client.headers.update({"Authorization": f"Bearer {token}"})\n')

            with open(my_client_path, "r") as f:
                content = f.read()

            # If method already exists in MyClient, skip to avoid duplicates
            if f"def {method_name}(" in content:
                return

            # 5. Generate Pydantic Models for request and response
            models_code_map = {}
            req_payload_class = None
            if post_data and method.upper() in ["POST", "PUT", "PATCH"]:
                try:
                    body_json = json.loads(post_data) if isinstance(post_data, str) else post_data
                    model_name = f"{method_name}Request"
                    req_payload_class, _ = json_to_pydantic_code(model_name, body_json, models_code_map)
                except Exception:
                    pass

            resp_payload_class = None
            if response_body:
                try:
                    body_json = json.loads(response_body) if isinstance(response_body, str) else response_body
                    model_name = f"{method_name}Response"
                    resp_payload_class, _ = json_to_pydantic_code(model_name, body_json, models_code_map)
                except Exception:
                    pass

            # 6. Format models code block
            models_code = ""
            for m_name, m_code in models_code_map.items():
                if f"class {m_name}(" not in content:
                    models_code += m_code + "\n"

            # 7. Format method code block with optional params
            params = ["self"]
            if req_payload_class:
                params.append(f"payload: {req_payload_class}")
            params.append("params: dict = None")
            params_str = ", ".join(params)
            
            return_type = resp_payload_class if resp_payload_class else "Any"
            path_url = parsed.path
            
            method_body = f"    def {method_name}({params_str}) -> {return_type}:\n"
            method_body += f'        """{method.upper()} {path_url}"""\n'
            
            # HTTP call with params
            caller_args = [f'"{path_url}"']
            if req_payload_class:
                caller_args.append("json=payload.model_dump()")
            caller_args.append("params=params")
            caller_args_str = ", ".join(caller_args)
            
            method_body += f'        response = self.client.{method.lower()}({caller_args_str})\n'
            method_body += "        response.raise_for_status()\n"
            
            if resp_payload_class:
                if resp_payload_class.startswith("List["):
                    item_model = resp_payload_class[5:-1]
                    method_body += f'        return [{item_model}.model_validate(item) for item in response.json()]\n'
                else:
                    method_body += f'        return {resp_payload_class}.model_validate(response.json())\n'
            else:
                method_body += "        return response.json()\n"

            # 8. Insert Pydantic models before MyClient class
            pydantic_marker = "# --- Pydantic Models ---"
            if pydantic_marker in content:
                parts = content.split(pydantic_marker, 1)
                content = parts[0] + pydantic_marker + "\n\n" + models_code + parts[1]
            elif "class MyClient" in content:
                parts = content.split("class MyClient", 1)
                content = parts[0] + models_code + "\nclass MyClient" + parts[1]

            # 9. Append the client method to the end of the file
            if not content.endswith("\n"):
                content += "\n"
            if not content.endswith("\n\n"):
                content += "\n"
            content += method_body

            with open(my_client_path, "w") as f:
                f.write(content)

    except Exception as e:
        print(f"Error auto-dumping API call to client: {e}")
