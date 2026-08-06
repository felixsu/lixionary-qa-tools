# **Flow Management**

## **Overview**

A **Flow** is a named canvas of nodes and connections. Flows are managed entirely from the toolbar — there is no flow sidebar.

## **Selecting & Creating Flows**

* The toolbar's flow dropdown (placeholder: **Select flow…**, or **No flows yet**) switches between flows. Flows from the pre-ports editor are suffixed **· Legacy** in the list.
* Click **New** to open the **New flow** modal, enter a name, and click **Create**. New flows always use the current port-based editor.
* Empty canvas states guide you: *"Create your first flow with the New button."* when no flows exist, and *"Drag a building block from the left to start this flow."* once a flow is selected.

## **Legacy Flows Are View/Run-Only**

Selecting a legacy flow opens it in a frozen editor with an amber **Legacy · view/run only** badge: Run/Stop/Retry/Report and flow management still work, but nodes can't be added, moved, connected, or reconfigured, and there is no Save. A converter to the port-based format is planned; until then, rebuild the flow in a new (V2) flow if you need to change it.

## **Rename, Duplicate, Delete**

When a flow is selected, four icon buttons appear next to the dropdown:

* **Rename flow** (pencil): Opens the **Rename flow** modal.
* **Duplicate flow** (copy): Clones the flow — including any unsaved canvas edits — as "*Name* 2", "*Name* 3", etc., and selects the copy. Duplicating a legacy flow produces another legacy flow.
* **Export flow** (file-down): Writes the flow to a shareable file — see **Export & Import** below.
* **Delete flow** (trash): Asks for confirmation (*"Delete flow «name»? This cannot be undone."*) before deleting.

## **Saving**

* **There is no auto-save.** Click **Save** in the toolbar (or press **Cmd/Ctrl+S**, which works even while typing in a field). The button shows **Saving…** while in flight.
* A small dot next to the flow dropdown (tooltip: *Unsaved changes*) indicates unsaved edits. Switching to another flow while dirty prompts *"You have unsaved changes on this flow. Discard them?"*.
* A flow with validation problems can still be saved — you'll get *"Saved (warning: …)"* — it just can't be **Run** until the problem is fixed.
* **Run executes the live canvas**, including unsaved edits — you don't have to save before running.

## **Sync**

Flows sync to the cloud exactly like collections: local-first storage, pushed after each save, and pulled on app load, window focus, every 5 minutes, or via the **Sync now** control in the left navigation rail. Concurrent-edit conflicts surface in the same keep-local/keep-cloud dialog.

## **Export & Import**

* **Export** (file-down icon next to Duplicate) writes the current canvas — unsaved edits included — to `<name>.flow.yaml` (recommended) or `.flow.json`. The file carries the graph plus an **interface snapshot** of every referenced request: its name, method, URL, input names, and output names. It never includes headers, bodies, or scripts, so no secret can travel in a shared file.
* **Import** (next to **New**) reads either format and creates a **new** flow (the name is suffixed if taken). Each request block is matched against your collections:
  1. by its exact request id;
  2. failing that, by a **unique name + method** match anywhere in your collections — these are auto-linked and listed in the import summary so you can double-check them;
  3. otherwise the block is marked **missing**. It keeps its full expected interface — the snapshot's inputs and outputs render as real dots, so nothing disconnects — but the flow can't run until resolved. The block's card reads *Missing: POST Create order*, and the inspector shows the expected name, method, URL, inputs, and outputs with a hint: create the request in **API Explorer**, then select it on the block. Picking a request clears the snapshot.
* Two same-name+method candidates are never guessed between — the block is marked missing instead.
* Legacy (V1) flows have no export; only V2 files can be imported.
