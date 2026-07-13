# Lixionary Explorer — Current UI & Feature Overview

> **Purpose of this doc:** Give designers a clear map of the product as it exists today — every screen, panel, control, and modal currently built — so you can understand the current state before proposing visual or UX improvements. This describes *what is there now*, not aspirations.

---

## 1. What This Product Is

**Lixionary Explorer** is an internal QA automation tool for engineers. It does two main jobs:

1. **API Automation Explorer** — a Postman-like client for building, organizing, executing, and chaining HTTP API requests.
2. **Web Explorer & POM Generator** — an embedded live browser that lets engineers click elements on a real web page and auto-generate Python Playwright "Page Object Model" test code and HTTP client code.

Supporting these are two configuration areas: **Environments** (variable sets) and **Auth Hook Functions** (self-refreshing token scripts).

The audience is QA Automation Engineers / SDETs. It is a developer-facing internal tool, not a consumer product.

---

## 2. Visual Design System (Current State)

The app is built with TailwindCSS. The color palette is intentionally omitted here, as the design system is being reworked.

**Typography & density**
- Heavy use of **very small text** — labels are often `text-[9px]`–`text-[11px]`, uppercase, bold, with wide letter-spacing.
- The UI is **dense and compact**, optimized for power users with lots of controls packed into small panels.
- Code areas use a monospace font via the **Monaco editor** (the VS Code editor engine), themed `vs-dark`.

**Shape language**
- Rounded corners throughout (`rounded-lg`, `rounded-xl`, `rounded-2xl`).
- Soft shadows and glows on primary elements (indigo-tinted shadows).
- Iconography from **lucide-react** (thin line icons): Cpu (logo), Send, Globe, Database, Key, User, LogOut, Plus, Trash, Download, Play, etc.

**Common UI patterns**
- **Modals:** centered cards over a `bg-black/60 backdrop-blur` overlay. Used for create/edit flows (collections, requests, environments, auth functions, page classes, sharing, AI prompts).
- **Side drawers:** slide in from the right (e.g. network request details).
- **Pill/tab switchers:** small segmented button groups with the active tab filled indigo.
- **Confirmation:** destructive deletes use the browser-native `confirm()` dialog (not custom-styled).
- **Toasts/feedback:** currently uses browser-native `alert()` for success and error messages (not custom-styled).

---

## 3. Global Layout & Navigation

### Authentication Gate (Login Screen)
Route: `/login`

A single centered card on a radial-gradient dark background.
- Lixionary logo (Cpu icon in a gradient rounded square) + title "Lixionary Explorer" + tagline.
- One **email input** prefilled with `developer@lixionary.com`.
- **"Sign in via Lixionary Google SSO"** button (outlined style with Globe icon).
- An **"OR"** divider.
- **"Start in Guest Developer Mode"** primary gradient button (developer sandbox bypass).
- Error messages appear in a red alert bar inside the card.
- Loading state shows a spinning icon with "Loading Lixionary Workspace…".

### Authenticated Shell (Dashboard Layout)
Everything after login lives inside a persistent two-part shell: **left sidebar + main area with top header.**

**Left Sidebar** (collapsible — toggles between 256px wide and a 64px icon-only rail)
- **Header:** Lixionary logo + wordmark; a collapse/expand chevron button.
- **Nav section "QA TOOLS":**
  - API Automation Explorer (Send icon) → `/api-explorer`
  - Web Explorer & POM (Globe icon) → `/web-explorer`
- **Nav section "CONFIGURATION":**
  - Environments (Database icon, shows live count e.g. "Environments (3)") → `/environments`
  - Auth Hook Functions (Key icon) → `/auth-functions`
- Active route is highlighted with an indigo-tinted background + border + indigo text.
- **User block (bottom):** avatar, user name + email, and a Logout button. Collapses to just a logout icon when the rail is collapsed.

**Top Header** (inside main area, 64px tall)
- **Left:** a contextual page title that changes per route ("API Automation Engine", "Web Automation & POM Generator", "Workspace Environments", "Dynamic Authentication Hooks").
- **Right:** an **"Active Env:"** dropdown selecting the globally-active environment. This selection is shared across the whole app and drives variable substitution.

---

## 4. Module: API Automation Explorer
Route: `/api-explorer` — the default landing screen after login.

A classic **three-region API client layout**: a collections sidebar, a request builder, and a response panel stacked below.

### 4a. Collections Sidebar (left, ~288px)
- Header "COLLECTIONS" with two icon buttons: **+ (new collection)** and **Share** (share/import).
- **Import bar:** a text field "Import by Collection ID…" + Import button (collections are shared by ID).
- **Collections list:** each collection is a rounded card showing its name + truncated ID + a "Copy ID" button.
  - Selecting a collection expands it to reveal its **requests**, each shown as a row with the request name and a colored **method badge** (GET=green, POST=blue, PUT=amber, others=rose).
  - An "+ Add Request" dashed button at the bottom of the expanded list.

### 4b. Request Builder (main area, top)
- **Request bar:** method dropdown (GET/POST/PUT/DELETE) + URL input (supports `{{VARIABLE}}` placeholders) + **Send** button (shows spinner while executing) + **Save** button.
- **Configuration tabs** (segmented control):
  - **Headers** — editable key/value rows with add/delete; "Add Header" button.
  - **Authentication** — auth-type dropdown with four modes:
    - No Auth
    - Bearer Token (single token field, supports `{{VARIABLE}}`)
    - Header API Key (key + value fields)
    - Dynamic Auth Hook (dropdown to pick a saved Auth Function)
  - **Variables Chaining** — a Monaco JS code editor for a "parser script" that extracts values from the response into variables. Includes an **"AI Agent Parser"** button (enabled once a response exists) that opens an AI generation modal.
- **Payload Body section:** body-type dropdown (None / JSON / Text). When not "None", a Monaco editor (JSON or text syntax) for the request body.

### 4c. Response Panel (bottom, ~288px tall)
- Header shows **status badge** (green <400, red ≥400) + status text + **response time in ms**.
- **Response view tabs:** Pretty / Headers / Raw / Extracted.
  - **Pretty:** formatted JSON (green monospace).
  - **Headers:** key/value list of response headers.
  - **Raw:** the full raw response object as JSON.
  - **Extracted:** variables that the chaining/parser script saved this run, shown as `key = value` chips.
- Empty state: "Send a request to see response details here."

### 4d. Modals in this module
- **Create New Collection** — single name field.
- **Create New Request** — single name field.
- **Share Collection** — email field to add a collaborator by email.
- **AI Prompt Parser Generator** — a textarea where you describe (in plain English) what to extract; an AI agent (Gemini) generates the sandboxed JS parser script. Has a generating/loading state.

---

## 5. Module: Web Explorer & POM Generator
Route: `/web-explorer` — the most complex screen in the app.

### 5a. Inactive / Empty State
Before a session starts, the body shows a centered placeholder: a Globe icon, "Browser Session Inactive", and explanatory text.

**Control bar (always at top):**
- Globe icon + URL input (disabled until connected).
- When disconnected: a **Profile selector** dropdown ("No Profile (Clean Session)" or a saved profile) and a **"Connect VNC Browser"** primary button (Play icon).

### 5b. Active Session — Split Workspace
Once connected, the area splits into two columns:

**Left (2/3 width): Live Embedded Browser**
- A real Chromium browser streamed into the UI via **VNC inside an iframe** (black canvas). Users can click, type, scroll, and navigate the real page.
- Control bar now shows: URL input + **Go** button, an **"Inspect Element"** toggle (changes to "Inspecting" with indigo highlight when active), and a **Disconnect** button.

**Right (1/3 width): Recorder & Tools** — a scrollable stack of panels:

1. **Inspect Selected Node** (appears only after clicking an element in inspect mode)
   - Shows the element tag + text, and a frame breadcrumb if the element is inside iframes (e.g. "Frame: iframe ➔ iframe").
   - **Method Code Name** input (e.g. `click_submit_btn`).
   - **Action Type** dropdown (Click / Fill-Type / Hover / Select Option).
   - **Best Strategy Locator** dropdown — lists candidate locators each with a **stability Score** (Test ID > Label > Role > CSS > XPath). User picks the preferred one.
   - **"Record Node to Page Object Class"** button — adds it to the active class.

2. **Page Objects (POM)**
   - Header with a **+** to create a new Page Class.
   - **Active class dropdown** (switch between e.g. LoginPage, DashboardPage).
   - List of recorded elements for the active class — each shows `method_name()` + its strategy/selector, with a delete (trash) button.
   - Empty state: "No elements recorded yet. Toggle inspect and click elements in the canvas."

3. **Code Output** (fixed-height panel, ~384px)
   - Tab switch: **POM Class** / **HTTP Client**.
   - A read-only Monaco editor (Python syntax) showing the **auto-generated code**, which regenerates live as elements or selected logs change.
   - **Download** button → saves `.py` file (`{ClassName}.py` or `http_client.py`).

4. **Quick Paste Tool**
   - Text input + **Send** button to type/paste a value into the currently focused element in the remote browser (works around VNC clipboard limits). Also supports Ctrl/Cmd+V directly on the canvas.

5. **Intercepted Network Logs**
   - "Recording" badge.
   - **Filter** input (matches URL or method).
   - Scrollable log list — each entry shows a method badge, status (green/red/amber-pending), the URL, an **"Inspect Details"** link, and a **"Client"** checkbox (selects that request to include in HTTP-client code generation).

### 5c. Network Details Drawer
Slides in from the right (~500px). Shows the full request/response for a clicked log: Request URL, Method, Resource Type, Request Headers (key/value), and Response Status + Response Body (formatted). Close button at top.

### 5d. Modals in this module
- **Create New Page Class** — single class-name field.
- **Browser Profiles Manager** — a large two-column modal:
  - **Left:** list of saved profiles (selectable, each with Edit/Delete).
  - **Right:** profile editor form with:
    - Profile Name.
    - **Inject Cookies** (JSON array textarea, green monospace, validated as JSON).
    - **Inject LocalStorage** (JSON textarea, supports an origins-array schema for domain-scoped storage).
    - **Auth Hook Integration:** link a saved Auth Function, choose Injection Type (Cookie / Local Storage), Target Key/Name, and Domain/Origin — so a freshly fetched token gets injected into the browser session on launch.

These profiles are the "Authentication Pre-Hook Injection" feature: they pre-load a browser session with cookies/localStorage/tokens before navigating.

---

## 6. Module: Environments
Route: `/environments`

A simple management page.
- Header: "Variable Environments" + description + **"Create Environment"** button.
- **Responsive card grid** (1–3 columns) of environment cards. Each card shows the env name, Edit/Delete actions, and a list of its variables. **Secret** variables display masked as `••••••••`.
- **Create/Edit modal:** name field + a repeatable list of variable rows (KEY, Value, a **Secret** checkbox, delete). "Add Variable" button.

Environments feed the global "Active Env" selector in the header; their variables substitute into `{{VARIABLE}}` placeholders in API requests.

---

## 7. Module: Auth Hook Functions
Route: `/auth-functions`

Manages reusable, self-refreshing token scripts.
- Header: "Self-Refreshing Auth Functions" + description + **"Create Auth Function"** button.
- **Two-column card grid.** Each card shows: name, Edit/Delete, description, a **read-only code preview** of the script (monospace, scrollable), and a footer showing **Token Status** — "Cached Token Active" (green) or "No Token Cached" (amber) — plus a TTL in seconds if set.
- **Create/Edit modal:** three top fields (Hook Name, Description, Expires-In seconds) + a large **Monaco JS editor** prefilled with a token-fetch template (calls an API, parses the response, returns the access token). These scripts run sandboxed on the backend and their tokens are cached/reused until they expire.

---

## 8. How the Modules Connect (Mental Model for Design)

```
Environments ──(variables)──┐
                            ├──▶ API Explorer requests ({{VARS}} substitution)
Auth Hook Functions ────────┤        └─ auth via Bearer / API Key / Auth Hook
        │                   │
        └──(inject token)──▶ Browser Profiles ──▶ Web Explorer session
                                                      ├─ Inspect → POM code
                                                      └─ Network logs → HTTP Client code
```

- The **Active Environment** (top header) is a global context shared by all modules.
- **Auth Hook Functions** are referenced both by API requests (as an auth type) and by Browser Profiles (to inject live tokens into a browser session).
- **Web Explorer** outputs are downloadable Python files; **API Explorer** persists requests in shareable collections.

---

## 9. Notable UX Characteristics & Current Gaps (for design consideration)

- **Very high information density** with tiny text — readability and visual hierarchy could be a focus area.
- **Native browser dialogs** (`alert()` / `confirm()`) are used for feedback and confirmations — inconsistent with the otherwise polished dark theme; a custom toast/dialog system would unify the experience.
- **Dark theme only** — no light mode, no theming.
- **Monaco editors** appear in several places (request body, chaining script, auth scripts, generated code) — they bring their own styling that differs from the surrounding Tailwind UI.
- **Status/method color coding** is consistent across modules (green/blue/amber/rose) — a reusable badge system worth formalizing in a design library.
- **Modals carry heavy forms** (especially the Browser Profiles manager and Auth Function editor) — candidates for clearer step/section structure.
- Empty states exist for most lists but are plain text — an opportunity for friendlier, more visual empty states.

---

*Generated from a scan of the current frontend implementation (Next.js + React + TailwindCSS) and the product PRDs. Reflects the state of the codebase as built, not planned features.*
