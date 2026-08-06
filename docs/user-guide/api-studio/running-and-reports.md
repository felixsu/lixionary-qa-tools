# **Running Flows & Reports**

## **Running a Flow**

* Click **Run** in the toolbar. It's disabled while the flow is empty or has a validation error (the error shows in the toolbar banner; clicking anyway toasts *Cannot run: …*).
* **Items are pipelined.** Every block runs as soon as it has an item to work on, so item 2 can be in one block while item 1 is already in the next. Within a single block, items are processed one at a time, in order.
* **Several inputs pair positionally**, latching any input that turns out to be a single value (see [Connecting Data](input-mapping-and-references.md)). Two different-length streams meeting at one block fail that block with an explicit error.
* Live status badges appear on each block: `queued`, `running…`, `success`, `partial`, `failed`, `skipped` — plus an **item counter** while a stream is flowing.
* **A failed item does not stop the run**: it drops out of the stream (keeping its position, so forked branches stay aligned), the rest of the items keep flowing, and the block finishes `partial` with a count of how many failed. The run is reported as failed if anything failed.
* **A block that fails outright** — a length mismatch, an emitter over its cap — marks everything downstream `skipped`.
* While running, **Run** is replaced by a red **Stop** button. Stopping aborts **all** in-flight nodes — each is marked `failed` with error *Run cancelled* — and everything not yet started is skipped.
* Completion toasts: *Run finished — N steps in M ms*, *Run cancelled*, or *Run failed — see node statuses*.

> **Note**: Run executes the **live canvas state**, including unsaved edits. Pressing Run also clears the previous run's results immediately.

## **Retrying a Failed Run**

> **Legacy flows only (for now)**: Retry is currently available when running **legacy (V1)** flows. Port-based (V2) flows re-run in full — partial retry for V2 is planned.

After a failed or cancelled legacy-flow run, a **Retry** button appears next to Run:

* Retry re-executes **only the nodes that did not succeed** — failed nodes and their skipped downstream. Successful nodes (including entire successful parallel branches) are **not** re-executed; their published outputs are reused, so Reference mappings on retried nodes resolve to **exactly the same values** as in the original run.
* Retry is node-level: a node that failed partway restarts from the beginning.
* When the retry finishes, the run results **merge** into one complete record set — the original run's records for successful nodes plus the new records for retried nodes — shown in the inspector, downloadable as one CSV, and persisted as the last run. If the retry fails again, it can itself be retried.
* Retry works after an app reload too (the run and its outputs persist per flow on this device). It is disabled — hover the button for the reason — when:
  * the flow was **edited since the run** (structure: nodes, names, configs, or connections — moving nodes around is fine),
  * the stored run predates the Retry feature, or
  * a successful node's outputs were **too large to persist** (over 20,000 characters) — retrying in the same session still works; only after a reload is the stored context unusable.
* Retry uses the **currently selected environment** and the **current request definitions** from your collections — edits to those are picked up, just like a normal run.
* Stopping mid-retry behaves like stopping a run; the flow stays retryable.

## **Inspecting Results (Last run)**

Click a block after (or during) a run to open the inspector. The **Last run** section shows one card per record — each stream item, and each verification attempt within it, gets its own card — plus a summary of how many items succeeded, failed, or were skipped. Long streams show the most recent 50 cards; the CSV has them all.

* Status (`success` / `failed` / `skipped`), plus `· item N` for streamed items and `· attempt N` for verification retries, and the duration in ms.
* The error message, if any, and the node's outputs as pretty-printed JSON.
* A **Details** button opening the **Request & response** modal: the **Resolved inputs**, the **Request (exact executor payload)** that was sent, and the **Response** with status, collapsible headers, and body. Nodes that failed before dispatch show *"No request was sent — the node failed before executing."*

Request **test scripts** do run during flows, but their results appear only in the CSV report's `test_results` column — they are not shown in the inspector and never affect node status.

## **Failure Semantics per Block**

* **Request**: an item fails on HTTP status ≥ 400, a parser error, missing declared outputs, verification that never passes within *Max attempts*, or a transport error. Other items are unaffected.
* **Array Emit**: fails the run outright if it would emit more than **100 items**, or if what it receives isn't an array.
* **Splitter**: a path that matches nothing fails only *that* output for that item; the other outputs still get their values.
* **Accumulator**: never fails — it simply leaves failed positions out and reports how many it dropped.
* **Verifier**: fails only when no attempt passes within **Max attempts**; each failed attempt's card shows which verifications failed (*Verification failed: status equals "200" — actual: 404 ✗*).
* **Delay**: effectively never fails.

## **CSV Report**

Click **Report** (enabled once a run has records) to download `<flowName>-run-<timestamp>.csv` — one row per record: every request item, every verification attempt, and every skipped step. Plumbing blocks (Splitter, Mixer, Accumulator, Array Emit) contribute one summary row plus a row per failure, so a long stream doesn't bury the report. Rows are ordered by `started_at`. Columns:

| Column | Contents |
| :---- | :---- |
| `node_name`, `node_type` | The flow node and its block type |
| `iteration`, `attempt` | Stream item index (0-based) / verification attempt (1-based), when applicable |
| `scope` | Unused by current flows; kept so older stored runs still render |
| `status` | `success` / `failed` / `skipped` |
| `started_at`, `duration_ms` | ISO timestamp and duration |
| `resolved_inputs` | JSON of the resolved `{{input}}` values |
| `outputs` | JSON of the node's published outputs |
| `request_json` | The exact executor payload that was sent |
| `response_status`, `response_json` | HTTP status and the full response (status, headers, body) |
| `error` | Failure message, if any |
| `test_results` | The request's test script results (`name: PASS; name: FAIL`) |

## **Run History (Home page)**

The Home page's **Flow executions** table lists the most recent runs across all flows — UI-triggered and agent-triggered alike (the **Source** column shows *User* or *Agent*). Each row shows the flow and environment, node count, status, **duration**, the flow's **average duration** (computed over its successful runs only), when it started, and a **report download** button producing the same CSV as the Studio's Report button. Agent runs still executing in the sidecar appear with a pulsing *Running* status (the API Studio toolbar shows an **Agent running** indicator at the same time). The most recent **100 runs** are kept on this device; older ones are pruned automatically.

## **Run Persistence**

* The **last run persists per flow** on this device (browser/app local storage) — after a reload, node badges, the inspector's Last run cards, and the **Report** button are all restored. Only the most recent run is kept, and it is overwritten by the next run.
* Every completed run is also recorded in the device-local **run history** shown on the Home page (see above). Run results are **not synced** to the cloud, and there is no scheduling. UI runs execute entirely in the app; AI agents can additionally run flows headlessly through the sidecar's MCP endpoint — see [MCP Agent Access](mcp-agent-access.md).

> **Caveat**: When persisting, very large payloads/response bodies are truncated at 20,000 characters. A CSV downloaded **after a reload** may therefore contain truncated data; download the report in the same session for the complete record. If a successful node's outputs exceed the limit, the run's resume data is dropped entirely (rather than stored corrupted) and **Retry becomes unavailable after a reload** for that run.

## **Example: Create-and-verify, once per order**

1. `orders` — **Array Emit** with a static array of three payloads.
2. `create` — **Request** for `POST /orders`, its `{{payload}}` input wired from `orders.item`, declaring output `tracking_id`.
3. `poll` — **Request** for `GET /orders/{{tracking_id}}`, wired from `create.tracking_id`, with **Verify the response** on: `$.body.status` `equals` `DELIVERED`, 5 attempts, 2000 ms apart.
4. `collected` — **Accumulator** wired from `poll`'s output.
5. `summary` — **Request** that posts the collected array, wired from `collected.array`.

Wire `orders.item → create.payload`, `create.tracking_id → poll.tracking_id`, `poll.<output> → collected.item`, `collected.array → summary.<input>`, then **Run**. The create-and-poll pair runs once per order, each polling independently until its own check passes; if one order never reaches `DELIVERED`, the other two still complete and the accumulator reports one dropped item.
