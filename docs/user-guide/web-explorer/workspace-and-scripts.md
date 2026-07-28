# **Workspace, Recording & Script Execution**

## **The Workspace**

The **Workspace** view (also the right half of **Split**) is a small Python project that lives on your machine and is shared by all Web Explorer sessions:

| File | Purpose | Editable? |
| :---- | :---- | :---- |
| `inspection_code/my_page.py` | `class MyPage` — every POM method you record lands here | Read-only |
| `inspection_code/my_client.py` | `class MyClient` — HTTP client boilerplate | Read-only |
| `playground.py` | `class PlaygroundPage(MyPage)` — your editable subclass for custom logic | Yes |
| `main.py` | Entry point that connects to the live session and instantiates `mPage = PlaygroundPage(page)` | Yes |
| `my_recording.py` | Output of the interaction **Record** feature | Yes |

* The **Files** list has a **+** button (*Create Python module*) for additional scripts.
* The Monaco editor auto-saves editable files as you type. Read-only files show a **Read-only** pill and a **Reset** button (*"Reset file content to default boilerplate"*) — resetting `my_page.py` erases **all** recorded methods, after a confirmation.
* Autocomplete understands the workspace: typing `mPage.` suggests your `PlaygroundPage` + `MyPage` methods.

> **Important**: The workspace is shared across sessions, profiles, and target sites — recorded methods accumulate in `MyPage` until you Reset it. That's also why recording a method name that already exists is rejected even if it came from an earlier session. On disk it lives under your AutomationExplorer data directory (`workspaces/default/`).

## **Recording User Interactions**

**Record** in the control bar (*"Record all user interactions on the page"*) captures everything you do in the browser — clicks, typing, navigation — while a red **Recording Session** badge pulses over the preview and the button reads **Recording…**. Stop recording to write the captured steps into `my_recording.py` as a runnable Playwright script you can edit, replay, or fold into your page objects.

> Recording is exclusive with Inspect, Scan, and Explore — they're disabled while a recording is in progress.

## **Running Scripts**

* Open a file and click **Run** to execute it against the live session — `main.py` connects to the same browser you're looking at, so `PlaygroundPage` methods act on the real page. **Stop** aborts a running script.
* Output appears in the **Execution console** below the editor (empty state: *"Console output is empty. Run main.py or another script to execute."*), with a **Clear** link.
* Running requires an active session (*"No active session. Start a browser session first."*).

## **Getting Code Out**

There is no download/export button — the workspace files are plain `.py` files on disk in your AutomationExplorer data directory, so copy them from the editor or open the folder directly to move page objects into your automation repository.
