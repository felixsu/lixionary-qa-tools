# **Element Inspection & POM Generation**

## **Inspect Mode**

Click **Inspect** in the control bar (it reads **Inspecting** while active). The page shows a crosshair cursor, a dashed hover outline, and an *"Inspect mode — click an element"* badge; normal page interactions are suppressed so dropdowns and buttons don't fire while you pick. You can click elements either in the in-app preview or directly in the real Chrome window. Press **Esc** anywhere in the app to exit inspect mode and close the Inspect Element card (Esc also closes dialogs, menus and the scan drawer — it is never forwarded to the page under test).

Picking an element opens the floating **Inspect Element** card showing the element's tag and text (plus its iframe chain, e.g. *Frame: a → b*, when nested), and:

* **Method name** — pre-seeded from the action, tag, and winning locator (e.g. `click_button_get_by_role`); edit freely.
* **Action** — `Click`, `Fill`, `Type`, `Hover`, `Check`, `Select option`, `Get Text`. Fill/Type/Select option add a **Test value** field.
* **Locator strategy** — the ranked candidate list (see below).
* **Custom selector (optional)** — type your own Playwright selector; if it tests as a unique match it becomes the primary strategy (*"✅ Unique match — set as primary strategy"*). The **?** icon next to the label opens a hint popover with clickable syntax examples (`#submit-btn`, `xpath=//button[text()="Submit"]`, `text=Submit`, `role=button[name="Save"]`, `div.modal >> button >> nth=0`) and a reminder to click **Test** first — Verify and Record use the primary strategy, and a selector only becomes primary once it tests unique.
* **Set as Anchor** / **Verify** / **Record** buttons.

> If the page mutates while an element is being analyzed you'll see *"⚠️ Content changed while analyzing… Click the element again once it settles."*

## **Locator Ranking**

Each pick generates candidate Playwright locators, scored by strategy quality minus selector length, then **live-checked against the page** — a candidate matching more than one element is heavily penalized. Ranking order (best first): user-anchored XPath, anchored XPath, `get_by_test_id`, CSS ID, `get_by_label`, `get_by_placeholder`, `get_by_role`, `get_by_text`, CSS name attribute, plain CSS, raw XPath. The dropdown marks each option **✅ (Unique)** or **⚠️ (N matches)**; selecting one makes it the primary strategy used by Verify and Record.

* **Set as Anchor** (*"Set this element as XPath anchor — then click a descendant to get a relative XPath"*): anchor a stable parent (outlined green, with a banner showing the anchor and a clear ✕), then pick descendants — they gain a top-ranked anchor-relative XPath candidate.
* **Verify** actually performs the chosen action against the live page, trying each candidate in order and logging every attempt (`✅ Verified` / `❌ All candidates failed`). If all ranked candidates fail, the AI proposes alternative locators (marked with 🤖 in the log) and those are tried too. A successful verify promotes the winning locator to primary. Verifying while inspect mode is on just works: the inspect overlay (which suppresses page interactions) is automatically suspended for the verify run and restored right after, so the button keeps reading **Inspecting** throughout.

## **Recording to the POM**

**Record** on the Inspect Element card appends the method to the `MyPage` class in `inspection_code/my_page.py` (see [Workspace](workspace-and-scripts.md)). A method that would duplicate an existing name is rejected — rename it first.

Generated methods use the primary locator, chain `.frame_locator(…)` automatically for elements inside iframes, and map actions to Playwright calls (`Type` → `press_sequentially`, `Get Text` → `inner_text`, etc.):

```python
def click_submit(self) -> None:
    """Perform click on get_by_role: button[name="Submit"]"""
    self.page.get_by_role("button", name="Submit").click()
```

## **Scanning a Whole Page**

**Scan** (*"Detect interactive elements and propose POM methods"*) detects interactive elements in bulk. Choose the scope from its menu:

* **Entire page** — all frames, including iframes.
* **Inside selected element** — scoped to the element you last inspected (*"Inspect & click a parent element first"* if none is selected).

Results open in the **Page scan** review drawer: each proposed element has a checkbox, an **editable method name**, an action badge, the element's tag/text, an `iframe` chip when nested, and a **✅ Unique** / **⚠️ N matches** marker. Use **All** / **None**, fix any duplicate or empty names (*"Fix duplicate or empty method names before recording."*), then click **Record N selected** — name clashes with existing methods are auto-suffixed (`_2`, `_3`) and reported in the toast. Scans are capped at 200 elements. Method names are polished by AI when available, with a heuristic fallback.

## **AI Explore**

**Explore** lets the AI drive the page autonomously and harvest elements as it goes. In its dropdown choose the **Scope** (**Entire page** / **Selected element**), optionally describe a goal (*"e.g. explore the checkout flow"*), and click **Start Exploring**. As the disclaimer says: it runs for a few minutes, clicking and filling around the page for real; destructive-looking actions (delete, pay, log out, etc.) are automatically skipped, and it won't leave the site. A live step log shows progress (**Exploring… step N**, with **Stop**), and the discovered elements land in the same review drawer as Scan for you to curate and record.

> **Mutual exclusion**: Inspect, Scan, Record, and Explore disable each other while one is running — the buttons' tooltips explain which activity is blocking.
