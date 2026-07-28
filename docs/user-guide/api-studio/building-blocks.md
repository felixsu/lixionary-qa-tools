# **Building Blocks & Canvas**

## **Adding Nodes**

The left **Building blocks** panel lists the four node types. Drag a card onto the canvas — or double-click it — to add a node:

| Block | What it does | Publishes downstream |
| :---- | :---- | :---- |
| **Request** | Runs a saved API Explorer request | The request's declared outputs |
| **Looper** | Repeats its inner request once per item of an array | `results` (array of per-iteration outputs), `count` |
| **Delay** | Waits a fixed number of milliseconds | — |
| **Verifier** | Runs its inner request and asserts on the response, retrying up to *Max attempts* | Inner request's outputs + `passed` |

New nodes are auto-named after their type (`request`, `looper`, `request_2`, …); rename them in the inspector.

## **Node Names**

The node name is an identifier that **namespaces the node's outputs** for downstream references (`orderSearch.order_id`). Edit it in the inspector's **Name** field. Rules:

* Must match `^[A-Za-z_][A-Za-z0-9_]*$` (letters, digits, underscore; not starting with a digit).
* Must be unique within the flow.
* `env` and `item` are reserved.

Violations show inline in red and in the toolbar's validation banner (e.g. *Node "x": Name already used in this flow*), and block **Run**.

## **Edges & Execution Order**

* Draw an edge by dragging from a node's right (source) handle to another node's left (target) handle.
* **Edges define execution order only** — no data travels along a specific edge. Any *upstream* (edge-ancestor) node's outputs are referenceable.
* Self-edges, duplicate edges, and edges that would create a cycle are silently refused while connecting.

## **Canvas Interactions & Shortcuts**

* **Select / inspect**: Click a node to open the inspector; click empty canvas to close it.
* **Multi-select**: Drag with the left mouse button to draw a selection box. Pan with the middle or right mouse button; zoom / fit-view buttons sit in the corner controls.
* **Delete**: Press **Backspace** or **Delete** to remove selected nodes/edges; the inspector also has a **Delete node** button.
* **Undo delete**: **Cmd/Ctrl+Z** restores the last deletion (up to 20 steps; deletions only — the stack clears when you switch flows).
* **Copy / paste**: **Cmd/Ctrl+C** copies the selected blocks (and the edges between them); **Cmd/Ctrl+V** pastes them offset, auto-renaming clashes to `name_2` and rewriting internal references and `{{tokens}}` to the new names.
* **Save**: **Cmd/Ctrl+S**.

## **Configuring Each Block (Inspector)**

### **Request**

* **Request**: Pick a saved API Explorer request via the searchable picker (**Select a request…**; type ≥2 characters to search by name, endpoint, or description — same engine as the API Explorer sidebar search). If the linked request was later deleted, the node shows *Request not found*.
* **Input mappings**: Wire each of the request's `{{inputs}}` — see [Input Mappings & References](input-mapping-and-references.md). Changing the selected request clears existing mappings.

### **Looper**

* **Items (array to iterate)**: Choose **Static JSON array** (edited inline as JSON) or **Reference an upstream output** (`nodeName.output` — must resolve to an array; a JSON-stringified array is parsed automatically).
* The inner request is configured exactly like a Request node below the items field. Inside its mappings, reference the current element as `item` (the whole element) or `item.field`.

### **Delay**

* **Delay (ms)**: A single number field (default 1000).

### **Verifier**

* Configure the inner request first (picker + input mappings).
* **Verifications (all must pass)**: Add rows via **Add verification**. Each row has:
  * **Field** — `status`, `body.<path>`, or `outputs.<path>` (a bare path is treated as an outputs path).
  * **Operator** — `equals`, `not equals`, `contains`, `exists`, `greater than`, `less than`. Numeric comparison is used when both sides are numbers; `contains` checks array membership or substring; `exists` needs no expected value.
  * **Expected** — a **Static** value or a **Reference** to an upstream node's output.
* **Max attempts** (default 3) and **Retry interval (ms)** (default 1000) control the retry loop: the verifier re-runs its request until an attempt passes or attempts are exhausted.
* Verifications are evaluated even when the response has an error status — so you can assert an expected 4xx.

> **Warning**: A verifier with zero verifications **always fails** (the inspector shows an amber reminder). Also note that since a verifier only publishes its outputs when it passes, downstream references to `<verifier>.passed` will always see `true`.
