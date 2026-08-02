# **Web Explorer Overview**

## **Introduction**

**Web Explorer** is Lixionary's web automation and POM-generation workspace. It launches a real Chromium browser on your machine, mirrors it live inside the app, and lets you inspect elements, generate ranked Playwright locators, record Page Object Model methods and interaction scripts, and capture network traffic — turning manual exploration into production-ready Python Playwright code.

┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                  Web Explorer Workspace                                 │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ Control bar: URL / Go · Inspect · Scan · Record · Explore · Sessions · Disconnect       │
├────────────────────────────────────────────┬────────────────────────────────────────────┤
│ Browser preview (live screencast)          │ Workspace (Files · Editor · Console)       │
│ - click / type / scroll the real page      │ - my_page.py (recorded POM)                │
│ - inspect overlay & selector highlights    │ - playground.py, main.py, my_recording.py  │
├────────────────────────────────────────────┴────────────────────────────────────────────┤
│ View modes: Browser · Split · Workspace · Network Activity                              │
└─────────────────────────────────────────────────────────────────────────────────────────┘

## **How the Browser Works**

Unlike an embedded iframe, Web Explorer drives a **real Chromium window** launched locally by the app's sidecar. What you see in the app is a live **screencast** of that window — clicking, typing, scrolling, and pasting in the preview are relayed to the real browser. You can also interact with the actual Chromium window directly at any time — raise it from your OS taskbar/dock; browsing and inspect clicks work there too. Profiles can opt into **Headless** mode, where no visible window opens but the preview and interactions still work.

## **Core Capabilities**

1. **Profile-Seeded Sessions**: Browser profiles inject cookies, localStorage, and auth-hook tokens before navigation, so sessions start already authenticated.
2. **Element Inspection & Locator Ranking**: Click any element to get a ranked list of Playwright locators (test-id, label, role, CSS, XPath and more), each live-checked for uniqueness, with one-click **Verify** against the real page.
3. **POM & Script Recording**: Record inspected elements as methods of a Playwright page object, bulk-scan whole pages, record interaction sessions into runnable scripts, or let the AI **Explore** a page autonomously.
4. **Workspace & Execution**: A built-in Python workspace (Monaco editor + execution console) where recorded code lands and your own scripts run against the live session.
5. **Network Capture**: Every request the page makes is captured; inspect payloads and headers, generate Python `requests` + Pydantic client code, or save a call into an API Explorer collection.

## **View Modes**

* **Browser** — the screencast full-width (with a tab strip when multiple tabs are open).
* **Split** *(default)* — screencast on the left, workspace on the right, with a draggable divider.
* **Workspace** — the file tree, editor, and execution console full-width.
* **Network Activity** — the captured request list and details pane.

> **Note**: The **Active env** dropdown in the top navbar affects Web Explorer only through auth hooks — when a profile is linked to an auth function, its token is resolved against the selected environment.

## **User Guide Navigation (Child Pages)**

* [Child Page 1: Browser Profiles & Sessions](browser-profiles-and-sessions.md)
* [Child Page 2: Element Inspection & POM Generation](element-inspection-and-pom.md)
* [Child Page 3: Workspace, Recording & Script Execution](workspace-and-scripts.md)
* [Child Page 4: Network Capture & API Integration](network-capture.md)
