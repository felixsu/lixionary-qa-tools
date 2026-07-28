# **Running Flows & Reports**

## **Running a Flow**

* Click **Run** in the toolbar. It's disabled while the flow is empty or has a validation error (the error shows in the toolbar banner; clicking anyway toasts *Cannot run: …*).
* Nodes execute **strictly sequentially in topological order** — one at a time, even on independent branches. Looper iterations and Verifier attempts are sequential too.
* Live status badges appear on each node: `queued`, `running…`, `success`, `failed`, `skipped`.
* **First failure stops the run**: the failing node turns red and **every node remaining in the run order is marked `skipped`** — including nodes on unrelated parallel branches.
* While running, **Run** is replaced by a red **Stop** button. Stopping aborts the in-flight request; the interrupted node is marked `failed` with error *Run cancelled* and the rest are skipped.
* Completion toasts: *Run finished — N steps in M ms*, *Run cancelled*, or *Run failed — see node statuses*.

> **Note**: Run executes the **live canvas state**, including unsaved edits. Pressing Run also clears the previous run's results immediately.

## **Inspecting Results (Last run)**

Click a node after (or during) a run to open the inspector. The **Last run** section shows one card per record — each Looper iteration and each Verifier attempt gets its own card — with:

* Status (`success` / `failed` / `skipped`), plus `· iteration N` / `· attempt N` where applicable, and the duration in ms.
* The error message, if any, and the node's outputs as pretty-printed JSON.
* A **Details** button opening the **Request & response** modal: the **Resolved inputs**, the **Request (exact executor payload)** that was sent, and the **Response** with status, collapsible headers, and body. Nodes that failed before dispatch show *"No request was sent — the node failed before executing."*

Request **test scripts** do run during flows, but their results appear only in the CSV report's `test_results` column — they are not shown in the inspector and never affect node status.

## **Failure Semantics per Block**

* **Request**: fails on HTTP status ≥ 400 (*HTTP 500 Internal Server Error*), a parser error, missing declared outputs (*Missing declared outputs: a, b*), an unresolvable Reference mapping, or a transport error.
* **Looper**: stops at the **first failing iteration** — later iterations never run, and `results`/`count` are not published. An empty array is a success with `results: []`, `count: 0`. There is no iteration cap.
* **Verifier**: fails only when no attempt passes within **Max attempts**; each failed attempt's card shows which verifications failed (*Verification failed: status equals "200" — actual: 404 ✗*).
* **Delay**: effectively never fails.

## **CSV Report**

Click **Report** (enabled once a run has records) to download `<flowName>-run-<timestamp>.csv` — one row per record, including every Looper iteration, every Verifier attempt, and skipped nodes. Columns:

| Column | Contents |
| :---- | :---- |
| `node_name`, `node_type` | The flow node and its block type |
| `iteration`, `attempt` | Looper iteration (0-based) / Verifier attempt (1-based), when applicable |
| `status` | `success` / `failed` / `skipped` |
| `started_at`, `duration_ms` | ISO timestamp and duration |
| `resolved_inputs` | JSON of the resolved `{{input}}` values |
| `outputs` | JSON of the node's published outputs |
| `request_json` | The exact executor payload that was sent |
| `response_status`, `response_json` | HTTP status and the full response (status, headers, body) |
| `error` | Failure message, if any |
| `test_results` | The request's test script results (`name: PASS; name: FAIL`) |

## **Run Persistence**

* The **last run persists per flow** on this device (browser/app local storage) — after a reload, node badges, the inspector's Last run cards, and the **Report** button are all restored. Only the most recent run is kept, and it is overwritten by the next run.
* Run results are **not synced** to the cloud, and there is no run history, scheduling, or headless/CLI execution — flows run entirely in the app.

> **Caveat**: When persisting, very large payloads/response bodies are truncated at 20,000 characters. A CSV downloaded **after a reload** may therefore contain truncated data; download the report in the same session for the complete record.

## **Example: Chained Smoke Flow**

1. `getUuid` — Request node for `GET /uuid` with declared output `uuid` (parser: `output.uuid = response.body.uuid;`).
2. `wait` — Delay node, 400 ms.
3. `echo` — Request node whose body contains `{{myId}}`, with the input mapped by **Reference** to `getUuid.uuid`.
4. `check` — Verifier on any request with `status equals 200`, 3 attempts, 1000 ms interval.

Connect `getUuid → wait → echo → check`, click **Run**, then download the CSV via **Report**.
