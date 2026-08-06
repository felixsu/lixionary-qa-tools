# **API Studio Overview**

## **Introduction**

**API Studio** is the flow-orchestration workspace within Lixionary. It chains saved **API Explorer** requests into a visual dataflow graph: each block exposes its inputs and outputs as **dots (ports)**, and you drag connections from an output dot to an input dot — turning single requests into end-to-end scenarios (create → poll → verify → report).

┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                    API Studio Workspace                                │
├──────────────────────┬──────────────────────────────────────────┬──────────────────────┤
│ Building blocks      │ Canvas (React Flow)                      │ Inspector            │
│ - Request            │ - Toolbar: flow selector, New, Save,     │ - Block name         │
│ - Array Emit         │   Report, Run/Stop                       │ - Configuration      │
│ - Accumulator        │ - Blocks with input/output dots          │ - Ports overview     │
│ - Mapper / Mux       │ - Connections carry streams of items     │ - Last run results   │
│ - Generator          │                                          │                      │
│ - Delay              │                                          │                      │
└──────────────────────┴──────────────────────────────────────────┴──────────────────────┘

## **Core Capabilities**

1. **Visual Dataflow Composition**: Every input a request declares appears as an input dot; every declared output appears as an output dot. A connection from `getUuid.uuid` to `echo.myId` *is* the data binding — what you see wired is exactly what runs. Cycles are rejected automatically.
2. **Streams instead of loops**: A connection carries an ordered **stream** of items ending with a *done* signal, so repetition is composition rather than a construct — `Array Emit → Request → Accumulator` runs the request once per element and collects the results. Items are **pipelined**: the next one starts as soon as a block is free.
3. **Unambiguous wiring**: An input takes exactly one connection, so a value is never ambiguously merged; an output may feed as many inputs as you like. Combine values with a **Mux**, take objects apart with a **Mapper**.
4. **Verification built into requests**: A Request can assert on its own response with JSONPath checks and retry until they pass — per item.
5. **Resilient runs**: A failed item drops out while the rest of the stream keeps flowing, and it keeps its position so forked branches stay aligned when they rejoin. Follow per-block status live, inspect the exact request/response of every step, and download a CSV of the whole run.
6. **Synced Flows**: Flows are stored local-first and synced to the cloud like collections, so they follow you across devices.

## **Workspace Layout At a Glance**

* **Toolbar**: Flow selector dropdown, **New** / rename / duplicate / delete flow actions, validation and environment warnings, **Report**, **Save**, and **Run** / **Stop**.
* **Building blocks panel** (left): The block types — drag one onto the canvas (or double-click it).
* **Canvas** (center): The flow graph itself — drag blocks, wire ports, box-select, copy/paste, and undo deletions.
* **Inspector** (right): Opens when you click a block — edit its name and configuration, review its ports, and inspect its **Last run** results. Clicking a connection opens a panel where data connections can take an optional **JSONPath** projection (e.g. `$.id`).

> **Note**: The active environment used by flow runs is selected via the **Active env** dropdown in the global top navbar (shared with API Explorer and Web Explorer).

## **Legacy (V1) Flows**

Flows created before the port-based editor are marked **Legacy** in the flow dropdown and open in a **view/run-only** mode: you can still run them, retry failures, download reports, rename/duplicate/delete them — but their configuration can no longer be edited. Legacy flows expressed data flow as text references (`nodeName.output`) instead of connections; an automatic converter to the new format is planned for a future release. New flows always use the current editor.

## **User Guide Navigation (Child Pages)**

* [Child Page 1: Flow Management](flow-management.md)
* [Child Page 2: Building Blocks & Canvas](building-blocks.md)
* [Child Page 3: Connecting Data — Streams, Ports & JSONPath](input-mapping-and-references.md)
* [Child Page 4: Running Flows & Reports](running-and-reports.md)
