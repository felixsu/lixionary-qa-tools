# **Input Mappings & References**

## **Overview**

Each Request node lists the `{{inputs}}` its linked request declares (the same tokens shown in API Explorer's **Input** tab). The **Input mappings** section decides where each value comes from at flow run time. Requests with no tokens show *"This request declares no {{inputs}}."*

## **Mapping Modes**

Per input, choose one of three modes:

* **Request default** — use the binding saved on the request itself in API Explorer (literal value or generator).
* **Static** — free text (placeholder: *Value ({{node.out}}, {{env.X}}, {{$date}} allowed)*). May embed `{{nodeName.path}}` / `{{item.path}}` tokens resolved by the Studio, plus `{{env.X}}` and `{{$...}}` generator tokens resolved by the backend.
* **Reference** — a dot-path into an upstream node's outputs, e.g. `getUuid.uuid` or `loop.results.0.uuid`. An autocomplete popup suggests each edge-ancestor's published outputs (and `item` when inside a Looper); free text is allowed for deeper paths.

## **What Each Node Publishes**

| Node type | Published outputs |
| :---- | :---- |
| Request | The request's declared outputs (from its Output tab) |
| Looper | `results` (array of each successful iteration's outputs), `count` |
| Verifier | The inner request's outputs, plus `passed` |
| Delay | Nothing |

## **Dot-Paths & the `*` Wildcard**

* Paths traverse objects and arrays: `loop.results.0.uuid`. JSON-stringified leaves are transparently parsed, so a path can continue into a stringified object.
* A `*` segment projects over an array: `loop.results.*.uuid` collects every iteration's `uuid` into a flat array (entries that don't resolve are dropped; wildcards nest).
* When injected into an input, arrays and objects are JSON-stringified — so a Static body value of `{"ids": {{loop.results.*.uuid}}}` becomes `{"ids": ["a","b"]}`; `null`/`undefined` become an empty string.

## **Resolution Rules & Failure Behavior**

References are resolved at each node's execution (for Loopers, once per iteration). The two modes fail differently:

* **Reference** mode: an unresolvable path **fails the node** with *Reference "x" not found for input "y"*.
* **Static** mode: an unresolvable `{{knownNode.badPath}}` token is **left as literal text** in the value — no error is raised.

Pre-run validation checks only that a reference's first segment matches an upstream node (*"reference … does not match any upstream node"*, *"«item» is only available inside a looper"*); typos deeper in the path only surface at run time.

## **Environment Variables in Flows**

* The **Active env** selected in the top navbar applies to **every** node, iteration, and attempt in the run — `{{env.NAME}}` tokens in the underlying requests resolve against it. There is no per-flow or per-node environment override.
* Before a run, the toolbar warns (amber, non-blocking) about `{{env.*}}` variables the flow uses that aren't defined: *"Env vars not defined in «envName»: A, B"* or *"No active environment — {{env.*}} vars unresolved: A, B"*. They may still be set at runtime via `env.set()`.
* A request whose Output parser calls `env.set(key, value)` writes into the active environment **mid-run**, so later nodes in the same flow see the value.
