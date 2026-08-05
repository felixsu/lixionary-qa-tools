// Semantics matrix for the streaming core: zip pairing, scalar latch, hole
// propagation, end-of-stream, length mismatch, and abort. This is the contract
// backend/services/flow_runner_v2.py must reproduce exactly.

import { describe, expect, it } from "vitest";
import {
  Channel,
  firstHole,
  hole,
  item,
  Joiner,
  tupleValues,
  type StreamMsg,
  type TupleResult,
} from "./streamV2";

const ORIGIN = { nodeId: "n-bad", nodeName: "bad" };

const feed = (...msgs: StreamMsg[]): Channel => {
  const ch = new Channel();
  for (const m of msgs) ch.push(m);
  return ch;
};

const eos = (count: number): StreamMsg => ({ kind: "eos", count });

// Narrowing helpers: assert the branch, then read it with real types.
const asTuple = (r: TupleResult): Extract<TupleResult, { kind: "tuple" }> => {
  if (r.kind !== "tuple") throw new Error(`expected a tuple, got ${r.kind}`);
  return r;
};
const asMismatch = (r: TupleResult): Extract<TupleResult, { kind: "mismatch" }> => {
  if (r.kind !== "mismatch") throw new Error(`expected a mismatch, got ${r.kind}`);
  return r;
};
const asAbort = (r: TupleResult): Extract<TupleResult, { kind: "abort" }> => {
  if (r.kind !== "abort") throw new Error(`expected an abort, got ${r.kind}`);
  return r;
};

// Drains a joiner to completion (guarded against runaway loops).
const drain = async (joiner: Joiner, max = 50): Promise<TupleResult[]> => {
  const out: TupleResult[] = [];
  for (let i = 0; i < max; i++) {
    const res = await joiner.next();
    out.push(res);
    if (res.kind !== "tuple") return out;
  }
  throw new Error("joiner did not terminate");
};

describe("Channel", () => {
  it("delivers buffered values in FIFO order", async () => {
    const ch = feed(item(0, "a"), item(1, "b"));
    expect(await ch.next()).toEqual(item(0, "a"));
    expect(await ch.next()).toEqual(item(1, "b"));
  });

  it("resolves a waiting consumer when a value arrives later", async () => {
    const ch = new Channel();
    const pending = ch.next();
    ch.push(item(0, "late"));
    expect(await pending).toEqual(item(0, "late"));
  });

  it("fails a parked consumer on cancellation", async () => {
    const ch = new Channel();
    const pending = ch.next();
    ch.fail(new Error("Run cancelled"));
    await expect(pending).rejects.toThrow("Run cancelled");
  });
});

describe("Joiner — single input", () => {
  it("yields one tuple per item then ends with the count", async () => {
    const joiner = new Joiner({ x: feed(item(0, "a"), item(1, "b"), eos(2)) });
    const results = await drain(joiner);
    expect(results.map((r) => r.kind)).toEqual(["tuple", "tuple", "end"]);
    expect(asTuple(results[0]).values.x).toEqual(item(0, "a"));
    expect(asTuple(results[1]).values.x).toEqual(item(1, "b"));
    expect(results[2]).toEqual({ kind: "end", count: 2 });
  });

  it("treats an empty stream as zero tuples", async () => {
    const joiner = new Joiner({ x: feed(eos(0)) });
    expect(await drain(joiner)).toEqual([{ kind: "end", count: 0 }]);
  });

  it("ends after one tuple for a single-item stream", async () => {
    const joiner = new Joiner({ x: feed(item(0, "only"), eos(1)) });
    const results = await drain(joiner);
    expect(results.map((r) => r.kind)).toEqual(["tuple", "end"]);
    expect(results[1]).toEqual({ kind: "end", count: 1 });
  });
});

describe("Joiner — zip", () => {
  it("pairs equal-length streams positionally", async () => {
    const joiner = new Joiner({
      a: feed(item(0, 1), item(1, 2), item(2, 3), eos(3)),
      b: feed(item(0, "x"), item(1, "y"), item(2, "z"), eos(3)),
    });
    const results = await drain(joiner);
    expect(results.map((r) => r.kind)).toEqual(["tuple", "tuple", "tuple", "end"]);
    expect(results.slice(0, 3).map((r) => tupleValues(asTuple(r).values))).toEqual([
      { a: 1, b: "x" },
      { a: 2, b: "y" },
      { a: 3, b: "z" },
    ]);
  });

  it("fails on a genuine length mismatch instead of truncating", async () => {
    const joiner = new Joiner({
      a: feed(item(0, 1), item(1, 2), item(2, 3), eos(3)),
      b: feed(item(0, "x"), item(1, "y"), eos(2)),
    });
    const results = await drain(joiner);
    expect(results.map((r) => r.kind)).toEqual(["tuple", "tuple", "mismatch"]);
    expect(asMismatch(results[2]).message).toContain('"b" ended after 2 items');
    expect(asMismatch(results[2]).message).toContain('"a" is still producing');
  });

  it("treats an empty stream as a mismatch against a producing one", async () => {
    const joiner = new Joiner({
      a: feed(item(0, 1), eos(1)),
      b: feed(eos(0)),
    });
    const results = await drain(joiner);
    expect(results[0].kind).toBe("mismatch");
  });

  it("ends cleanly when every input is empty", async () => {
    const joiner = new Joiner({ a: feed(eos(0)), b: feed(eos(0)) });
    expect(await drain(joiner)).toEqual([{ kind: "end", count: 0 }]);
  });
});

describe("Joiner — scalar latch", () => {
  it("reuses a single-item stream for every tuple", async () => {
    const joiner = new Joiner({
      items: feed(item(0, "a"), item(1, "b"), item(2, "c"), eos(3)),
      token: feed(item(0, "tok"), eos(1)),
    });
    const results = await drain(joiner);
    expect(results.map((r) => r.kind)).toEqual(["tuple", "tuple", "tuple", "end"]);
    expect(results.slice(0, 3).map((r) => tupleValues(asTuple(r).values))).toEqual([
      { items: "a", token: "tok" },
      { items: "b", token: "tok" },
      { items: "c", token: "tok" },
    ]);
    expect(results[3]).toEqual({ kind: "end", count: 3 });
  });

  it("latches a scalar that arrives before the driver's later items", async () => {
    // token's EOS is already buffered; the driver is still producing.
    const joiner = new Joiner({
      token: feed(item(0, "tok"), eos(1)),
      items: feed(item(0, "a"), item(1, "b"), eos(2)),
    });
    const results = await drain(joiner);
    expect(results.slice(0, 2).map((r) => tupleValues(asTuple(r).values))).toEqual([
      { items: "a", token: "tok" },
      { items: "b", token: "tok" },
    ]);
  });

  it("ends after one tuple when every input latches", async () => {
    const joiner = new Joiner({
      a: feed(item(0, 1), eos(1)),
      b: feed(item(0, 2), eos(1)),
    });
    const results = await drain(joiner);
    expect(results.map((r) => r.kind)).toEqual(["tuple", "end"]);
    expect(results[1]).toEqual({ kind: "end", count: 1 });
  });

  it("latches a hole so it poisons every tuple", async () => {
    const joiner = new Joiner({
      items: feed(item(0, "a"), item(1, "b"), eos(2)),
      bad: feed(hole(0, ORIGIN, "boom"), eos(1)),
    });
    const results = await drain(joiner);
    expect(results.map((r) => r.kind)).toEqual(["tuple", "tuple", "end"]);
    for (const r of results.slice(0, 2)) {
      expect(firstHole(asTuple(r).values)?.error).toBe("boom");
    }
  });
});

describe("Joiner — holes", () => {
  it("passes holes through as ordinary positions", async () => {
    const joiner = new Joiner({
      x: feed(item(0, "a"), hole(1, ORIGIN, "item 1 failed"), item(2, "c"), eos(3)),
    });
    const results = await drain(joiner);
    expect(results.map((r) => r.kind)).toEqual(["tuple", "tuple", "tuple", "end"]);
    expect(firstHole(asTuple(results[0]).values)).toBeNull();
    expect(firstHole(asTuple(results[1]).values)?.error).toBe("item 1 failed");
    expect(firstHole(asTuple(results[2]).values)).toBeNull();
  });

  it("keeps positions aligned when one branch of a fork holes", async () => {
    // The load-bearing case: branch A's item 1 failed, branch B's did not.
    // Position 1 must pair with position 1 on both sides, not shift up.
    const joiner = new Joiner({
      a: feed(item(0, "a0"), hole(1, ORIGIN, "failed"), item(2, "a2"), eos(3)),
      b: feed(item(0, "b0"), item(1, "b1"), item(2, "b2"), eos(3)),
    });
    const results = await drain(joiner);
    expect(results.map((r) => r.kind)).toEqual(["tuple", "tuple", "tuple", "end"]);
    expect(tupleValues(asTuple(results[0]).values)).toEqual({ a: "a0", b: "b0" });
    // position 1: a is a hole, b keeps its own item — no cross-pairing
    expect(firstHole(asTuple(results[1]).values)?.error).toBe("failed");
    expect(tupleValues(asTuple(results[1]).values)).toEqual({ b: "b1" });
    expect(tupleValues(asTuple(results[2]).values)).toEqual({ a: "a2", b: "b2" });
  });

  it("blames the first hole in sorted input order", async () => {
    const joiner = new Joiner({
      zeta: feed(hole(0, { nodeId: "z", nodeName: "zeta" }, "z failed"), eos(1)),
      alpha: feed(hole(0, { nodeId: "a", nodeName: "alpha" }, "a failed"), eos(1)),
    });
    const results = await drain(joiner);
    expect(firstHole(asTuple(results[0]).values)?.error).toBe("a failed");
  });
});

describe("Joiner — abort", () => {
  it("surfaces an upstream abort immediately", async () => {
    const joiner = new Joiner({
      a: feed(item(0, 1), { kind: "abort", reason: "upstream exploded" }),
    });
    const results = await drain(joiner);
    expect(results.map((r) => r.kind)).toEqual(["tuple", "abort"]);
    expect(asAbort(results[1]).reason).toBe("upstream exploded");
  });
});
