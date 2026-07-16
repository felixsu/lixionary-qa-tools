# API Studio: Flow Orchestration Guide

API Studio (`/api-studio`) chains saved **API Explorer requests** into a visual flow chart. Each node runs in dependency order, and any node can feed its outputs into a later node's inputs — turning single requests into end-to-end scenarios (create → poll → verify → report).

## Core concepts

- **Flow**: a named canvas of nodes and edges. Flows are synced like collections (local-first SQLite + cloud), so they follow you across devices.
- **Node name**: an identifier (`^[A-Za-z_][A-Za-z0-9_]*$`, unique per flow, `env` and `item` reserved). The name namespaces the node's outputs for downstream references: `orderSearch.order_id`.
- **Edges** define execution order only (no data flows along a specific edge — any *upstream* node's outputs are referenceable). Cycles are rejected while connecting.

## Building blocks

| Block | What it does | Publishes downstream |
| :--- | :--- | :--- |
| **Request** | Runs a saved API Explorer request | The request's declared outputs |
| **Looper** | Runs its inner request once per item of an array (static JSON or an upstream array reference); the current element is `item` / `item.field` | `results` (array of per-iteration outputs), `count` |
| **Delay** | Waits n ms | — |
| **Verifier** | Runs its inner request and checks field comparisons (`status`, `body.<path>`, `outputs.<path>`; equals / not equals / contains / exists / greater / less). Retries up to *max attempts* with an interval | inner request's outputs + `passed` |

## Feeding outputs into inputs

Each request node lists the `{{inputs}}` its linked request declares. Per input choose:

- **Request default** — use the binding saved on the request itself.
- **Static** — free text; may embed `{{nodeName.path}}` (resolved by the Studio), plus `{{env.X}}` / `{{$date}}`-style tokens (resolved by the backend).
- **Reference** — a dot-path into an upstream node's outputs, e.g. `getUuid.uuid`, `loop.results.0.uuid`.

**`*` wildcard**: a `*` segment projects over an array — `loop.results.*.uuid` collects every iteration's `uuid` into a flat array (missing entries dropped; wildcards nest). Arrays/objects are JSON-stringified when injected into an input, so `{"ids": {{loop.results.*.uuid}}}` becomes `{"ids": ["a","b"]}`.

References are resolved once per run and only edge-ancestors are offered, so a referenced value always exists by the time a node runs.

## Running and reports

- **Run** executes nodes sequentially in topological order with live status badges (queued / running / success / failed / skipped). The first failure stops the run; downstream nodes are marked skipped. **Stop** cancels mid-run.
- The **Extracted-style record** for each node (status, outputs, error, timing) shows in the inspector after a run.
- **Report** downloads a CSV with one row per executed module — including every looper iteration and verifier attempt — with resolved inputs, outputs, the raw request payload JSON, and the raw response JSON.
- The last run persists per flow (locally), so the report stays downloadable after a reload.

## Example: chained smoke flow

1. `getUuid` — Request node for `GET /uuid` with declared output `uuid` (parser: `output.uuid = response.body.uuid;`).
2. `wait` — Delay 400 ms.
3. `echo` — Request node whose body contains `{{myId}}`, with the input mapped by Reference to `getUuid.uuid`.
4. `check` — Verifier on any request with `status equals 200`, 3 attempts, 1000 ms interval.

Connect `getUuid → wait → echo → check`, Run, then download the CSV.
