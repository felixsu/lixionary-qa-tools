# **API Studio Overview**

## **Introduction**

**API Studio** is the flow-orchestration workspace within Lixionary. It chains saved **API Explorer** requests into a visual flow chart: each node runs in dependency order, and any node can feed its outputs into a later node's inputs — turning single requests into end-to-end scenarios (create → poll → verify → report).

┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                    API Studio Workspace                                │
├──────────────────────┬──────────────────────────────────────────┬──────────────────────┤
│ Building blocks      │ Canvas (React Flow)                      │ Inspector            │
│ - Request            │ - Toolbar: flow selector, New, Save,     │ - Node name          │
│ - Looper             │   Report, Run/Stop                       │ - Node configuration │
│ - Delay              │ - Nodes with live status badges          │ - Input mappings     │
│ - Verifier           │ - Edges define execution order           │ - Last run results   │
└──────────────────────┴──────────────────────────────────────────┴──────────────────────┘

## **Core Capabilities**

1. **Visual Flow Composition**: Drag building blocks onto a canvas and connect them with edges that define execution order. Cycles are rejected automatically.
2. **Output-to-Input Chaining**: Any node can reference an upstream node's outputs as `nodeName.output`, including deep dot-paths and `*` wildcard projections over arrays.
3. **Control-Flow Blocks**: Beyond plain requests — **Looper** (repeat a request per array item), **Delay** (fixed wait), and **Verifier** (assert on a response with automatic retries).
4. **Live Execution & Reporting**: Run flows sequentially with per-node status badges, inspect the exact request/response of every step, and download a CSV report of the entire run.
5. **Synced Flows**: Flows are stored local-first and synced to the cloud like collections, so they follow you across devices.

## **Workspace Layout At a Glance**

* **Toolbar**: Flow selector dropdown, **New** / rename / duplicate / delete flow actions, validation and environment warnings, **Report**, **Save**, and **Run** / **Stop**.
* **Building blocks panel** (left): The four node types — drag one onto the canvas (or double-click it) to add a node.
* **Canvas** (center): The flow chart itself — drag nodes, draw edges between them, box-select, copy/paste, and undo deletions.
* **Inspector** (right): Opens when you click a node — edit its name and configuration, wire **Input mappings**, and review its **Last run** results.

> **Note**: The active environment used by flow runs is selected via the **Active env** dropdown in the global top navbar (shared with API Explorer and Web Explorer).

## **User Guide Navigation (Child Pages)**

* [Child Page 1: Flow Management](flow-management.md)
* [Child Page 2: Building Blocks & Canvas](building-blocks.md)
* [Child Page 3: Input Mappings & References](input-mapping-and-references.md)
* [Child Page 4: Running Flows & Reports](running-and-reports.md)
