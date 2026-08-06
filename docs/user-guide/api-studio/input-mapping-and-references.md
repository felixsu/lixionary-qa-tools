# **Connecting Data — Streams, Ports & JSONPath**

## **Overview**

Data flows along **connections**: dragging from an output dot to an input dot binds that value. There is no separate mapping panel — the graph *is* the mapping. Per input, the value is resolved in this order:

1. **Incoming connection** — the item arriving on that connection (after the connection's optional JSONPath). If a connected input receives nothing for an item, that item fails and drops out of the stream.
2. **Inline value** — the box shown on the block for unconnected inputs, with its own **type** (`string`, `number`, `boolean`, `json`). May contain `{{env.X}}` and `{{$...}}` tokens, which the backend resolves.
3. **Request default** — the binding saved on the request itself in API Explorer.

## **Streams and the done signal**

Every connection carries an ordered stream of items terminated by a *done* signal. A plain value is a stream of one. That single idea replaces looping:

| To… | Wire… |
| :---- | :---- |
| Repeat a request per array element | `Array Emit.item → Request.<input>` |
| Repeat a request that takes no inputs | `Array Emit.index → Request.each` (set a repeat count) |
| Collect the results | `Request.<output> → Accumulator.item` |
| Send one value to two places | a second connection from the same output |
| Build an object from several values | `Mixer` |
| Take an object apart | `Splitter` |
| Use one generated value in several requests | `Generator.value → …` (a date, random number, name, email or location) |

The `done` diamond fires once, when a block's whole stream has finished. Wiring `done → after` makes the next block wait for the entire stream (a barrier) — but you never need it just to close a loop, because the data connection already carries the end of the stream.

## **What each block's outputs carry**

| Block | Outputs |
| :---- | :---- |
| Request | The request's declared outputs |
| Array Emit | `item` (one at a time), `index` (its 0-based position) |
| Accumulator | `array` (everything collected), `count` |
| Splitter | One output per configured JSONPath |
| Mixer | `object` |
| Generator | `value` (one generated value, or one per item with `each` on) |
| Delay | `value` (whatever it was given, after the wait) |

## **JSONPath**

Paths are real JSONPath, used in three places: a **connection's** optional projection, **Splitter** rows, and **Request verify** checks.

| Expression | Result on `{"name":"apple","items":[{"id":"a"},{"id":"b"}]}` |
| :---- | :---- |
| `$.name` | `apple` |
| `$.items[0].id` | `a` |
| `$.items[*].id` | `["a","b"]` |
| `$..id` | `["a","b"]` |
| `$.missing` | no match — the item fails and drops out |

A path matching exactly one value yields that value; several matches yield the list; no match is a miss. Verify checks read against a response shaped as `$.status`, `$.statusText`, `$.headers…`, `$.body…`, and `$.outputs…`.

## **How multiple inputs pair (zip + latch)**

Items pair positionally, and any input whose stream is a single value is **latched** and reused for every item. That makes the common "fetch a token once, use it for every item" case work with no special configuration. Two different-length streams meeting at one block is an error, not a silent truncation.

## **When an item fails**

The failed item leaves the stream but **keeps its position**, so parallel branches stay aligned when they rejoin. Remaining items keep flowing; the block ends with a *partial* status listing how many items failed; the run is reported as failed. An Accumulator drops failed positions from its array and reports the count. A Request that is handed a failed upstream item records a *skipped* step instead of firing a pointless HTTP call.

## **Environment variables in flows**

* The **Active env** in the top navbar applies to every block, item, and attempt — `{{env.NAME}}` tokens in requests and inline values resolve against it. There is no per-flow override.
* Before a run, the toolbar warns (non-blocking) about `{{env.*}}` variables the flow uses that aren't defined.
* A request whose Output parser calls `env.set(key, value)` writes into the active environment mid-run, so later blocks see it.

## **Legacy flows (V1 references)**

Flows made in the pre-ports editor bound inputs with text references (`nodeName.output`, `item.field`). Those flows still **run** unchanged in view/run-only mode, but the reference system is retired for new flows — connections, streams, and JSONPath replace it.
