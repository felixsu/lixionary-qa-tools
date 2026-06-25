# Product Requirement Document (PRD) & Technical Design: Lixionary Web Explorer

---

## Part 1: Product Requirement Document (PRD)

### 1. Executive Summary

Building and maintaining Web Page Object Models (POMs) and API clients is one of the most tedious, time-consuming bottlenecks in automation engineering. **Lixionary Web Explorer** solves this by offering an interactive web interface featuring an embedded chromium browser that records network traffic and inspects DOM structure in real-time, automatically generating production-ready Python Playwright POMs and Python HTTP API clients.

### 2. User Persona & Problem Statement

* **Persona:** QA Automation Engineers, SDETs, and Developers building E2E tests.
* **Problem:** Manually digging through DevTools to find unique elements (`get_by_test_id`, CSS selectors, XPaths), writing boilerplates for Python page classes, and hand-crafting API client data models for backend interaction.

---

### 3. Functional Requirements

#### FR-1: Authentication Pre-Hook Injection

* **Description:** Users must be able to configure initial browser state before navigating to the target URL.
* **Capabilities:** Input forms for explicit JSON objects representing `Cookies` and `LocalStorage` keys/values.
* **Outcome:** Browser initializes and launches with these sessions pre-injected.

#### FR-2: Network Traffic Recorder & Filter Panel

* **Description:** Capture all HTTP/HTTPS requests triggered by the embedded browser session.
* **Capabilities:**
* **Filtering:** Live filtering of network logs using standard string contains or Regular Expressions (Regex) against the URL.
* **Details Inspector:** Clicking a network log line opens a side-drawer showing absolute Request/Response headers, Query Params, Payload, and Response bodies.



#### FR-3: Embedded Interactive Browser (Canvas/Stream)

* **Description:** A live Chromium instance rendered directly inside the Lixionary web application UI.
* **Capabilities:** Full interaction capabilities (click, type, scroll, navigate) mirroring a real desktop browser.

#### FR-4: AI/Heuristic Playwright POM Generator

* **Description:** Inspect elements and auto-generate clean Python code based on the Playwright object model framework.
* **Capabilities:**
* **Element Extraction:** Automatically map interactable elements (buttons, inputs, links, select dropdowns).
* **Locator Ranker:** Prioritize locators using best practices (e.g., `get_by_test_id` > `get_by_label` > `get_by_role` > CSS > XPath).
* **Visual Feedback:** Hovering over generated code highlights the target element in the embedded browser (and vice-versa).
* **Parent Scope Selection:** Ability to lock onto a parent node (like an `iframe` or a specific wrapper container `div`) to scope child locators.
* **Multi-Class Architecture:** Users can name classes (e.g., `LoginPage`), click a button to spawn a new clean class tab (e.g., `DashboardPage`), and step through flows continuously.



#### FR-5: Export & Python Client Synthesis

* **Description:** Turn data into downloadable assets.
* **Capabilities:**
* Download complete `.py` files containing the structured Playwright Page Objects.
* Synthesize recorded HTTP traffic into grouped endpoints, generating Python Data Models (using Pydantic) and an asynchronous/synchronous HTTP Client wrapper.



---

## Part 2: Technical Design Document (TDD)

### 1. System Architecture Diagram

To accomplish rendering a fully interactive Chromium browser inside a web application UI, we use an architecture leveraging **Playwright Server** on the backend and **VNC/WebRTC or Remote Debugging CDP (Chrome DevTools Protocol)** mirrored via WebSockets to a frontend renderer.

```
+-----------------------------------------------------------------------------------+
|                              Frontend Client (React)                              |
|                                                                                   |
|  +---------------------------+  +--------------------------+  +-----------------+  |
|  |  Embedded Browser Panel  |  |   Network Record Panel   |  | Code Gen Panel  |  |
|  |  (novnc / CDP Screen-cap) |  |   (Filter, Details)      |  | (POM Editor)    |  |
|  +--------------+------------+  +------------+-------------+  +--------+--------+  |
+-----------------|----------------------------|-------------------------|----------+
                  | Websocket                  | Events                  | JSON Schema
                  v                            v                         v
+-----------------------------------------------------------------------------------+
|                            Backend Engine (FastAPI)                               |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | Playwright Session Orchestrator (CDP Client)                                |  |
|  |  - Injects Auth hooks (Cookies/Local Storage)                               |  |
|  |  - Tracks DOM mutation / Click events via page.expose_function              |  |
|  |  - Captures page.on("request") and page.on("response") logs                 |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+

```

### 2. Technical Stack Recommendation

* **Frontend:** React, TypeScript, TailwindCSS (for UI components), `monaco-editor` (for syntax-highlighted code output panels).
* **Backend:** Python (FastAPI), Async Playwright (`playwright.async_api`).
* **Inter-communication:** WebSockets for streaming DOM node highlights, click triggers, and network streams in real-time.

---

### 3. Component Deep Dive

#### A. Embedded Browser Interaction (FR-4, FR-5)

Instead of a heavy VNC implementation, we can use Playwright's native capability to hook into a Chromium instance. We can launch Chromium in **headless** mode on the server, utilize `page.screenshot({ type: "jpeg" })` or a continuous stream loop, or run Chromium in a container and expose the VNC display via an `rfb` player inside an iframe.

For maximum accuracy with element selectors, we will inject an **Inspection Overlay Script** into the page container using `page.add_init_script()`.

#### B. The Locator Priority Engine Algorithm

When evaluating a targeted DOM element node ($E$), the backend evaluates and assigns a stability weight to calculate the optimized Playwright locator strategy string:

$$Score(L) = \text{PriorityWeight}(Strategy) - \text{Penalty}(Length)$$

| Strategy | Priority Weight | Format Example |
| --- | --- | --- |
| **Test ID** | 100 | `page.get_by_test_id("...")` |
| **Label Text** | 90 | `page.get_by_label("...")` |
| **Role Selector** | 80 | `page.get_by_role("button", name="...")` |
| **CSS Selector** | 40 | `page.locator("div.submit-btn")` |
| **XPath** | 10 | `page.locator("//div[2]/button")` |

#### C. Network Traffic Capture & Code Gen (FR-6)

Using Playwright’s backend event loops:

```python
from playwright.async_api import Request, Response

async def handle_request(request: Request):
    # Log requests data, headers, payloads, curl formatting
    pass

async def handle_response(response: Response):
    # Capture response JSON to dynamically generate Pydantic schemas
    pass

# Attach listeners
page.on("request", handle_request)
page.on("response", handle_response)

```

---

### 4. Database & Storage Schema (Ephemeral Sessions)

Because state resides in active server processes, we use **Redis** to temporarily hold structural configurations, parsed requests, and generated metadata during active developer explorer sessions.

```json
{
  "session_id": "usr_94f82a1bc",
  "current_page_class": "OperatorDpAdministrationPage",
  "parent_locator": "iframe[src*='dp-administration.html']",
  "elements": [
    {
      "element_id": "el_001",
      "method_name": "click_add_partner",
      "strategy": "get_by_test_id",
      "selector": "button_add_partner",
      "action": "click"
    }
  ]
}

```

---

### 5. Automated Python Code Generation Templates

#### POM Code Generation Template Engine (Jinja2)

```python
from jinja2 import Template

pom_template = """
from playwright.sync_api import Page

class {{ class_name }}:
    \"\"\"Page object for {{ url }}.\"\"\"

    def __init__(self, page: Page):
        self.page = page
        {% if parent_locator %}self._frame = self.page.frame_locator('{{ parent_locator }}'){% endif %}

    {% for method in methods %}
    def {{ method.name }}(self, {% if method.action == 'fill' %}value: str{% endif %}) -> None:
        \"\"\"{{ method.docstring }}\"\"\"
        {% set target = "self._frame" if parent_locator else "self.page" %}
        {{ target }}.{{ method.strategy }}("{{ method.selector }}").{{ method.action }}({% if method.action == 'fill' %}value{% endif %})
    {% endfor %}
"""

```

#### HTTP Client Generator Target Mock Design

When network calls are exported, endpoints hitting identical base URLs are aggregated. Payloads are translated into Typed Data Models via a base client architecture matching this structural output:

```python
import httpx
from pydantic import BaseModel
from typing import List, Optional

# 1. Auto-generated Data Models from JSON Payloads
class SearchFilter(BaseModel):
    field: str
    values: List[str]

class OrderSearchRequest(BaseModel):
    search_field: Optional[str] = None
    search_range: Optional[str] = None
    search_filters: List[SearchFilter]

# 2. Synthesized API Client
class NinjaVanApiClient:
    def __init__(self, base_url: str = "https://api-qa.ninjavan.co", token: str = None):
        self.client = httpx.Client(base_url=base_url)
        self.client.headers.update({"Authorization": f"Bearer {token}"})

    def search_masked_orders(self, payload: OrderSearchRequest) -> dict:
        """POST /sg/order-search/search/masked"""
        response = self.client.post("/sg/order-search/search/masked", json=payload.model_dump())
        response.raise_for_status()
        return response.json()

```

---

### 6. Key Risks & Mitigation Strategies

* **Canvas Interaction Latency:** Mirroring the browser window frame-by-frame can feel sluggish.
* *Mitigation:* Use Playwright's local CDP endpoint directly, rendering the real page inside a local Chromium window if run locally, or proxy lightweight interactive DOM snapshots over a standard high-speed secure WebSocket if hosted in the cloud.


* **Shadow DOM / Nested Iframes:** Elements hidden inside multiple cross-origin frames fail standard CSS selection.
* *Mitigation:* Implement a recursive parent frame traversal utility inside our Playwright locator lookup algorithm to automatically generate nested `.frame_locator()` calls.
