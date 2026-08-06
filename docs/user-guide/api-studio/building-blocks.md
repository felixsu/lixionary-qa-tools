# **Building Blocks & Canvas**

## **Adding Blocks**

The left **Building blocks** panel lists the block types. Drag a card onto the canvas — or double-click it — to add it.

| Block | What it does | Outputs |
| :---- | :---- | :---- |
| **Request** | Runs a saved API Explorer request, optionally verifying and retrying the response | One dot per declared output |
| **Array Emit** | Turns an array — or a plain repeat count — into a stream, one at a time | `item`, `index` |
| **Accumulator** | Collects a whole stream back into a single array | `array`, `count` |
| **Splitter** | Splits one object into several outputs, each with its own JSONPath | One dot per configured path |
| **Mixer** | Combines several inputs into one object | `object` |
| **Generator** | Emits a generated value — date, random number, name, email, or location | `value` |
| **Delay** | Waits a fixed number of milliseconds | `value` (passthrough) |

New blocks are auto-named after their type (`request`, `arrayEmit`, `request_2`, …); rename them in the inspector. Names appear on the block and in run records; duplicates are auto-suffixed when you save.

## **Streams: the core idea**

A connection does **not** carry one value — it carries an ordered **stream** of items ending with a *done* signal. A single value is simply a stream of length one.

This is why there is no loop block. A loop is just composition:

```
Array Emit ●──● Request ●──● Accumulator ●──● …
   3 items      runs 3×        one array out
```

The end-of-stream travels with the data, so nothing extra needs wiring — the accumulator flushes automatically when the stream finishes.

## **Ports: input & output dots**

Every block renders its ports directly on the card, ComfyUI-style:

* **Input dots** (left) — one per `{{input}}` the linked request declares, or per configured row on a Mixer. An **unconnected** input shows an inline value box with a **type** (`string`, `number`, `boolean`, `json`); a **connected** input shows a chip naming its source.
* **`each`** (on Request blocks, off by default) — tick **Repeat with an `each` input** in the inspector to add it. Connect any stream and the request runs **once per item**, ignoring the value. This is how you repeat a request that declares no inputs of its own.
* **Output dots** (right) — one per declared output / configured row.
* **Trigger diamonds** (header corners) — `after` and `done`. Connect `done → after` to order two blocks **without** passing data. Because `done` only fires when a whole stream has finished, this doubles as a "wait for all of it" barrier.

Port lists are derived live from your collections: editing a saved request updates its blocks immediately. If a port that has connections disappears, the block shows a red struck-through **ghost port** so the connection stays visible; the inspector lists these under **Port problems**, and runs are blocked until they're resolved.

## **How connections work**

* Each data input accepts **exactly one** connection — a second wire onto it is refused with a hint, so a value is never ambiguously merged. An **output** has no such limit: it may feed as many inputs as you like.
* To send one value to several places, just drag a second connection from the same output. To combine several values into one, add a **Mixer** — values are never implicitly merged, so every input has one unambiguous source.
* Trigger diamonds are the exception — they're events, not data, so they may fan in and out freely.
* Data dots only connect to data dots, diamonds only to diamonds; cycles are refused while dragging.
* Click a connection to give it an optional **JSONPath** applied to every item (e.g. `$.id` to pass just the id), or to delete it.

## **How several inputs pair up**

When a block has more than one connected input, items pair **positionally**: item 1 with item 1, item 2 with item 2. An input whose stream turns out to be a **single value is latched** and reused for every item — which is exactly what you want for an auth token:

```
Array Emit ●──────● Request     →  runs 3×:
Get Token  ●─(latched)─┘           (item1, token) (item2, token) (item3, token)
```

If two genuinely different-length streams meet at one block, the run fails with an explicit error rather than pairing unrelated items. The toolbar warns at edit time when two inputs are driven by different emitters.

After a run, a latched input carries a **reused** tag on the block, and the inspector names it under *Last run* — so you can see which value was shared rather than having to infer it.

This is what lets one value fan out across a stream without any extra block:

```
create route  ──────────────● route_id  ┐
                                        ├─● assign ●── (runs 3×, same route_id)
Array Emit ●──● create order ●─ tracking_id ┘
   3 items         runs 3×
```

**Worked example — one route, three orders.** The assignment API takes one tracking id per call, so:

1. **Request** *create route* — no inputs, so it runs once and emits a single `route_id`.
2. **Array Emit** in repeat-count mode (3) wired into **Request** *create order*'s `each` input, so it runs three times and emits three `tracking_id`s.
3. **Request** *assign* takes both: `route_id` from step 1, `tracking_id` from step 2.

The assign block runs three times — once per tracking id — with the same `route_id` each time, because that input was a single value. No broadcast or copy block is involved.

## **Failures don't stop the stream**

If one item fails — an HTTP error that exhausts its retries, a JSONPath that matches nothing — that item drops out and **the remaining items keep flowing**. The block finishes with a *partial* status showing how many items failed, and the run is reported as failed.

The failed item keeps its **position** as it travels, so branches that fork from one output and rejoin at a Mixer stay aligned — item 3 on one branch can never end up paired with item 2 on the other. An Accumulator simply leaves failed positions out of its array (and reports how many it dropped).

## **Canvas interactions & shortcuts**

* **Select / inspect**: click a block for the inspector, a connection for its panel, empty canvas to close.
* **Multi-select**: drag with the left mouse button. Pan with middle/right button; zoom and fit-view sit in the corner controls.
* **Delete**: **Backspace** / **Delete**, or the inspector's trash button.
* **Undo delete**: **Cmd/Ctrl+Z** (up to 20 steps; deletions only, cleared on flow switch).
* **Copy / paste**: **Cmd/Ctrl+C** copies the selected blocks and the connections between them; **Cmd/Ctrl+V** pastes them offset, auto-renaming clashes.
* **Save**: **Cmd/Ctrl+S**.

## **Configuring each block (inspector)**

### **Request**

* **Request**: pick a saved API Explorer request (type ≥2 characters to search by name, endpoint, or description).
* **Repeat with an `each` input** (optional): adds an extra **`each`** input dot. Connect a stream to it and the request fires once per item, discarding the value — the way to repeat a request that declares no inputs of its own. Left off, the block shows only the ports its request actually needs. Flows saved before this toggle existed open with it already on wherever `each` was wired.
* **Verify the response** (optional): add checks that each read a value with **JSONPath** over `$.status`, `$.body…`, `$.headers…`, or `$.outputs…` and compare it with `equals`, `not equals`, `contains`, `exists`, `greater than`, or `less than`. All checks must pass; otherwise the item is retried up to **Max attempts** every **Retry interval**. An expected value can be **Static** or come from a **Port** — the check grows its own input dot to receive it. Every item of a stream is verified independently.

### **Array Emit**

* **Items**: when the `array` input is unconnected, pick either a **repeat count** — a plain number N, emitting `0…N-1` — or a **static JSON array**. When it *is* connected, whatever arrives wins, and a stream of several arrays is flattened in order. An emitter may release at most **100 items** per run.
* To run something a fixed number of times, set a repeat count, enable **Repeat with an `each` input** on the target request, and wire `index` into its `each` input.

### **Accumulator**

No configuration. It collects its input stream and emits one array plus a count when the stream ends.

### **Splitter / Mixer**

* **Splitter**: add one output row per **JSONPath** (`$.name`, `$.color`). Each output emits its own extraction from the same object, so one object in becomes several values out. A path that matches nothing holes only *that* output.
* **Mixer**: add one input row per **field name**; each item becomes one object using those names as keys.

### **Generator**

* **Value**: pick from the same catalog API Explorer offers — **date** (with an offset, a format, or epoch seconds/milliseconds), **random number** (a digit count or a range), **random email / first / last / full name**, and **location** (the point you chose on the map). It is stored as a token such as `$date:+1d:YYYY-MM-DD`.
* Emits on **`value`**. Because one output can feed many inputs, every consumer receives the **same** generated value — which is the thing typing `{{$randomEmail}}` into two requests separately cannot do, since each request would interpolate its own.
* **Repeat with an `each` input** (optional): off, the block emits one value that gets reused everywhere it is wired; on, it produces a fresh value per item of the stream you connect — a unique email per order, say.
* You can still type a token like `{{$randomInt:4}}` directly into a hardcoded input when the value only matters to that one request; the picker is available there too.

### **Delay**

* **Delay (ms)**. Connect `value` straight through it to pace a stream (one wait per item — handy for rate-limited APIs), or leave it unconnected to simply pause between blocks.
