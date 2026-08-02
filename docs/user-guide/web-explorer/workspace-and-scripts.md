# **Workspace, Recording & Script Execution**

## **The Workspace**

The **Workspace** view (also the right half of **Split**) is a small Python project that lives on your machine and is shared by all Web Explorer sessions:

The workspace is split into two folders: **`builder/`** for scripts whose locators you define yourself (by inspecting/scanning), and **`recording/`** for the auto-generated replay script produced by the **Record** feature. Each script runs from its own folder, so imports inside `builder/` are plain sibling imports.

| File | Purpose | Editable? |
| :---- | :---- | :---- |
| `builder/my_page.py` | `class MyPage` — every POM method you record lands here | Read-only |
| `builder/my_client.py` | `class MyClient` — HTTP client boilerplate | Read-only |
| `builder/playground.py` | `class PlaygroundPage(MyPage)` — your editable subclass for custom logic | Yes |
| `builder/main.py` | Entry point that connects to the live session and instantiates `mPage = PlaygroundPage(page)` | Yes |
| `recording/main.py` | Output of the interaction **Record** feature | Yes |

* The **Files** list has a **+** button (*Create Python module*) for additional scripts — new modules are created inside `builder/`. It also has buttons to **open the workspace folder** in your file manager and **copy its path**.
* The Monaco editor auto-saves editable files as you type. Read-only files show a **Read-only** pill and a **Reset** button (*"Reset file content to default boilerplate"*) — resetting `my_page.py` erases **all** recorded methods, after a confirmation.
* Autocomplete understands the workspace: typing `mPage.` suggests your `PlaygroundPage` + `MyPage` methods.

> **Important**: The workspace is shared across sessions, profiles, and target sites — recorded methods accumulate in `MyPage` until you Reset it. That's also why recording a method name that already exists is rejected even if it came from an earlier session. On disk it lives under your AutomationExplorer data directory (`workspaces/default/`).

## **Recording User Interactions**

**Record** in the control bar (*"Record all user interactions on the page"*) captures everything you do in the browser — clicks, typing, navigation — while a red **Recording Session** badge pulses over the preview and the button reads **Recording…**. Stop recording to write the captured steps into `recording/main.py` as a runnable Playwright script you can edit, replay, or fold into your page objects.

> Recording is exclusive with Inspect, Scan, and Explore — they're disabled while a recording is in progress.

## **Running Scripts**

* Open a file and click **Run** to execute it against the live session — `builder/main.py` connects to the same browser you're looking at, so `PlaygroundPage` methods act on the real page; `recording/main.py` replays the recorded steps. **Stop** aborts a running script.
* Output appears in the **Execution console** below the editor (empty state: *"Console output is empty. Run main.py or another script to execute."*), with a **Clear** link.
* Running requires an active session (*"No active session. Start a browser session first."*).

## **Getting Code Out**

There is no download/export button — the workspace files are plain `.py` files on disk in your AutomationExplorer data directory. Use the **open workspace folder** / **copy path** buttons in the Files header (or copy from the editor) to move page objects into your automation repository.
