// Stream primitives for the API Studio V2 streaming engine.
//
// Every data edge is an ordered FIFO carrying positional messages followed by
// exactly one terminator:
//
//   Item  { index, value }            payload at a position
//   Hole  { index, origin…, error }   a FAILED position — still occupies the slot
//   Eos   { count }                   normal end of stream
//   Abort { reason }                  hard upstream failure (replaces Eos)
//
// Holes are what make "continue on error" safe: a failed item keeps its
// position, so when a stream forks (duplicator) and rejoins (mux) the two
// branches stay aligned instead of silently pairing item 3 with item 2.
//
// The Joiner turns N input channels into a sequence of tuples using
// zip + scalar latch: streaming inputs pair positionally, while an input whose
// whole stream turned out to be a single value is latched and reused for every
// tuple. This module is pure (no HTTP, no React) so both the semantics and its
// edge cases are unit-testable in isolation; backend/services/flow_runner_v2.py
// mirrors it — keep the two in sync.

// ---- messages ----------------------------------------------------------------

export interface ItemMsg {
  kind: "item";
  index: number;
  // Opaque payload: whatever the upstream node produced.
  value: unknown;
}

export interface HoleMsg {
  kind: "hole";
  index: number;
  originNodeId: string;
  originNodeName: string;
  error: string;
}

export interface EosMsg {
  kind: "eos";
  count: number; // positions sent before this terminator (items + holes)
}

export interface AbortMsg {
  kind: "abort";
  reason: string;
}

export type StreamMsg = ItemMsg | HoleMsg | EosMsg | AbortMsg;
export type ValueMsg = ItemMsg | HoleMsg;

export const isValueMsg = (m: StreamMsg): m is ValueMsg => m.kind === "item" || m.kind === "hole";

export const item = (index: number, value: unknown): ItemMsg => ({ kind: "item", index, value });

export const hole = (
  index: number,
  origin: { nodeId: string; nodeName: string },
  error: string
): HoleMsg => ({
  kind: "hole",
  index,
  originNodeId: origin.nodeId,
  originNodeName: origin.nodeName,
  error,
});

// ---- channel -----------------------------------------------------------------

/** Unbounded async FIFO. Unbounded is deliberate: a `done → after` trigger
 * barrier alongside a data edge requires buffering the upstream stream in full,
 * so a bounded queue could deadlock. Emitters cap streams (EMIT_MAX_ITEMS), so
 * memory is bounded in practice.
 *
 * Exactly one consumer per channel — guaranteed by the one-edge-per-port rule. */
export class Channel<T = StreamMsg> {
  private buffer: T[] = [];
  private pending: ((value: T) => void) | null = null;
  private rejectPending: ((reason: unknown) => void) | null = null;

  push(value: T): void {
    if (this.pending) {
      const resolve = this.pending;
      this.pending = null;
      this.rejectPending = null;
      resolve(value);
      return;
    }
    this.buffer.push(value);
  }

  next(): Promise<T> {
    if (this.buffer.length) return Promise.resolve(this.buffer.shift()!);
    return new Promise<T>((resolve, reject) => {
      this.pending = resolve;
      this.rejectPending = reject;
    });
  }

  /** Wakes a blocked consumer with an error — used by run cancellation so
   * workers parked on next() unwind instead of hanging forever. */
  fail(reason: unknown): void {
    const reject = this.rejectPending;
    this.pending = null;
    this.rejectPending = null;
    if (reject) reject(reason);
  }

  get buffered(): number {
    return this.buffer.length;
  }
}

// ---- joiner ------------------------------------------------------------------

export type TupleResult =
  | { kind: "tuple"; index: number; values: Record<string, ValueMsg> }
  | { kind: "end"; count: number }
  | { kind: "mismatch"; message: string }
  | { kind: "abort"; reason: string };

interface InputState {
  name: string;
  channel: Channel;
  firstMsg: ValueMsg | null; // position 0, kept in case the stream turns out to be scalar
  latched: ValueMsg | null; // set once EOS confirms length 1
  endedAt: number | null; // EOS count, once seen
}

/** Consumes N input channels and yields tuples per the zip + scalar latch rule.
 *
 * For tuple i, every connected input either contributes its position-i message,
 * or contributes its latched value (streams of length 1 repeat forever), or is
 * exhausted. All exhausted ⇒ the node's stream ends. Some exhausted while
 * others still produce ⇒ a length mismatch, which is a hard node failure
 * (silently truncating would pair up unrelated items).
 *
 * Inputs are processed in sorted-name order so a tuple built from several holes
 * always blames the same one. */
export class Joiner {
  private inputs: InputState[];
  private index = 0;

  constructor(channels: Record<string, Channel>) {
    this.inputs = Object.keys(channels)
      .sort()
      .map((name) => ({
        name,
        channel: channels[name],
        firstMsg: null,
        latched: null,
        endedAt: null,
      }));
  }

  get inputCount(): number {
    return this.inputs.length;
  }

  /** Inputs that turned out to carry a single value and are being reused for
   * every tuple. Only meaningful once the stream has been consumed — latching
   * is discovered when an input ends, not when it starts. The editor surfaces
   * this so "one route_id across three orders" is visible rather than inferred. */
  latchedInputs(): string[] {
    return this.inputs.filter((s) => s.latched).map((s) => s.name);
  }

  async next(): Promise<TupleResult> {
    const i = this.index;
    const values: Record<string, ValueMsg> = {};
    let freshDrivers = 0;
    let exhausted = 0;

    for (const input of this.inputs) {
      if (input.latched) {
        values[input.name] = input.latched;
        continue;
      }
      if (input.endedAt !== null) {
        exhausted += 1;
        continue;
      }

      const msg = await input.channel.next();
      if (msg.kind === "abort") {
        input.endedAt = i;
        return { kind: "abort", reason: msg.reason };
      }
      if (isValueMsg(msg)) {
        if (input.firstMsg === null) input.firstMsg = msg;
        values[input.name] = msg;
        freshDrivers += 1;
        continue;
      }
      // EOS: a single-message stream latches and keeps contributing.
      input.endedAt = msg.count;
      if (msg.count === 1 && input.firstMsg) {
        input.latched = input.firstMsg;
        values[input.name] = input.latched;
      } else {
        exhausted += 1;
      }
    }

    if (exhausted > 0 && freshDrivers > 0) {
      const ended = this.inputs.find((s) => s.endedAt !== null && !s.latched)!;
      const producing = this.inputs.find((s) => values[s.name] && !s.latched)!;
      return {
        kind: "mismatch",
        message:
          `Input "${ended.name}" ended after ${ended.endedAt} item${ended.endedAt === 1 ? "" : "s"} ` +
          `but "${producing.name}" is still producing (position ${i})`,
      };
    }
    // Nothing fresh means no driver is left: either everything is exhausted, or
    // every remaining input is latched (a stream of scalars is length 1).
    if (freshDrivers === 0) return { kind: "end", count: i };

    this.index += 1;
    return { kind: "tuple", index: i, values };
  }
}

/** First hole among a tuple's contributions (inputs already in sorted order),
 * or null when every contribution is a real value. A node with a holed input
 * does no work and passes the hole along, preserving positions. */
export const firstHole = (values: Record<string, ValueMsg>): HoleMsg | null => {
  for (const name of Object.keys(values).sort()) {
    const msg = values[name];
    if (msg.kind === "hole") return msg;
  }
  return null;
};

/** Plain values of a tuple, for nodes that only care about payloads. */
export const tupleValues = (values: Record<string, ValueMsg>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [name, msg] of Object.entries(values)) {
    if (msg.kind === "item") out[name] = msg.value;
  }
  return out;
};
