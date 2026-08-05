// API Studio V2 streaming orchestrator.
//
// Every node gets its own async worker; every data connection is a FIFO channel
// (streamV2.ts). A worker pulls tuples from its Joiner — which pairs the node's
// connected inputs positionally, latching any that turn out to be a single
// value — does one item's work at a time, and pushes results downstream. Items
// therefore flow through the graph PIPELINED: item 2 can be in one node while
// item 1 is still in the next.
//
// A failed item does not stop the run: it becomes a hole that keeps its
// position in the stream, so branches that fork through a Duplicator and rejoin
// at a Mux stay aligned. Accumulator is the only node that removes holes.
//
// Mirrored by backend/services/flow_runner_v2.py — keep the two in sync; the
// shared fixtures in backend/tests/fixtures/v2_flows are the guard.

import type { InputBinding, RequestItem } from "../context/AppContext";
import {
  cancellableDelay,
  executeResolvedRequest,
  FlowCancelledError,
  lookupRequest,
  makeRecord,
  stringifyValue,
  type ExecutionResult,
  type FlowRunCallbacks,
  type FlowRunDeps,
  type FlowRunSummary,
  type NodeRunStatus,
  type RunHandle,
  type RunRecord,
  type RunState,
} from "./flowRunner";
import { evalJsonPath, verifyTarget } from "./jsonPathV2";
import {
  Channel,
  firstHole,
  hole,
  item as makeItem,
  Joiner,
  type HoleMsg,
  type StreamMsg,
  type ValueMsg,
} from "./streamV2";
import {
  demuxOutName,
  duplicatorOutName,
  edgeKindV2,
  EMIT_MAX_ITEMS,
  emptyStaticInput,
  flowErrorsV2,
  muxInName,
  parseHandle,
  parseStaticInput,
  validateFlowV2,
  verifyCheckPortName,
  type ArrayEmitNodeConfigV2,
  type DelayNodeConfigV2,
  type DemuxNodeConfigV2,
  type DuplicatorNodeConfigV2,
  type FlowEdgeV2,
  type FlowNodeConfigV2,
  type FlowNodeV2,
  type FlowV2,
  type MuxNodeConfigV2,
  type RequestNodeConfigV2,
  type StaticInputV2,
  type VerifyCheckV2,
} from "./flowTypesV2";
import type { ComparisonOperator } from "./flowTypes";

interface ItemCounts {
  ok: number;
  failed: number;
  skipped: number;
}

/** Comparison over already-extracted values (V2 verify checks read through
 * JSONPath, so there is no field-path walking left to do here). */
export const compareValues = (
  operator: ComparisonOperator,
  actual: unknown,
  expected: unknown
): boolean => {
  const bothNumeric =
    actual !== null &&
    actual !== undefined &&
    actual !== "" &&
    Number.isFinite(Number(actual)) &&
    Number.isFinite(Number(expected));
  switch (operator) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "equals":
      return bothNumeric ? Number(actual) === Number(expected) : String(actual) === String(expected);
    case "not_equals":
      return bothNumeric ? Number(actual) !== Number(expected) : String(actual) !== String(expected);
    case "contains":
      return Array.isArray(actual)
        ? actual.some((v) => String(v) === String(expected))
        : String(actual ?? "").includes(String(expected ?? ""));
    case "greater_than":
      return bothNumeric && Number(actual) > Number(expected);
    case "less_than":
      return bothNumeric && Number(actual) < Number(expected);
    default:
      return false;
  }
};

export function runFlowV2(flow: FlowV2, deps: FlowRunDeps, cb: FlowRunCallbacks): RunHandle {
  const state: RunState = { cancelled: false, abort: new AbortController(), wakers: new Set() };

  const channels = new Map<string, Channel>(); // edgeId -> channel

  const cancel = () => {
    if (state.cancelled) return;
    state.cancelled = true;
    state.abort.abort();
    for (const wake of Array.from(state.wakers)) wake();
    // Unpark workers blocked on an input that will never arrive.
    for (const ch of channels.values()) ch.fail(new FlowCancelledError());
  };

  const done = (async (): Promise<FlowRunSummary> => {
    const startedAt = new Date().toISOString();
    const runStart = Date.now();
    const records: RunRecord[] = [];
    const emit = (record: RunRecord) => {
      records.push(record);
      cb.onRecord(record);
    };

    const issues = flowErrorsV2(validateFlowV2(flow, deps.collections));
    if (issues.length) throw new Error(issues.map((i) => i.message).join("; "));

    const nodeStatuses: Record<string, "success" | "failed" | "skipped" | "partial"> = {};
    const nodeItemCounts: Record<string, ItemCounts> = {};
    const emitStatus = (nodeId: string, status: NodeRunStatus) => {
      if (status !== "pending" && status !== "running" && status !== "idle") nodeStatuses[nodeId] = status;
      cb.onNodeStatus(nodeId, status);
    };

    const dataEdges = flow.edges.filter((e) => edgeKindV2(e) === "data");
    const triggerEdges = flow.edges.filter((e) => edgeKindV2(e) === "trigger");
    for (const e of dataEdges) channels.set(e.id, new Channel());

    // ---- trigger gates ------------------------------------------------------
    // A node starts once every incoming `after` connection has fired. An
    // upstream that fails or is skipped resolves the gate as "skip" instead, so
    // nothing waits forever.
    interface Gate {
      remaining: number;
      skipReason: string | null;
      resolve: (() => void) | null;
      promise: Promise<void>;
      settled: boolean;
    }
    const gates = new Map<string, Gate>();
    for (const node of flow.nodes) {
      const remaining = triggerEdges.filter((e) => e.target === node.id).length;
      const gate: Gate = {
        remaining,
        skipReason: null,
        resolve: null,
        promise: Promise.resolve(),
        settled: remaining === 0,
      };
      gate.promise = remaining === 0 ? Promise.resolve() : new Promise<void>((r) => (gate.resolve = r));
      gates.set(node.id, gate);
    }
    const settleGate = (gate: Gate) => {
      if (gate.settled) return;
      gate.settled = true;
      gate.resolve?.();
    };
    const fireDone = (nodeId: string) => {
      for (const e of triggerEdges.filter((t) => t.source === nodeId)) {
        const gate = gates.get(e.target);
        if (!gate || gate.settled) continue;
        gate.remaining -= 1;
        if (gate.remaining <= 0) settleGate(gate);
      }
    };
    const failDone = (nodeId: string, reason: string) => {
      for (const e of triggerEdges.filter((t) => t.source === nodeId)) {
        const gate = gates.get(e.target);
        if (!gate || gate.settled) continue;
        gate.skipReason = reason;
        settleGate(gate);
      }
    };

    // ---- per-node wiring ----------------------------------------------------
    const inputChannelsOf = (nodeId: string): Record<string, Channel> => {
      const map: Record<string, Channel> = {};
      for (const e of dataEdges) {
        if (e.target !== nodeId) continue;
        const parsed = parseHandle(e.targetHandle);
        if (parsed?.kind === "data") map[parsed.name] = channels.get(e.id)!;
      }
      return map;
    };
    const outputEdgesOf = (nodeId: string): Map<string, FlowEdgeV2> => {
      const map = new Map<string, FlowEdgeV2>();
      for (const e of dataEdges) {
        if (e.source !== nodeId) continue;
        const parsed = parseHandle(e.sourceHandle);
        if (parsed?.kind === "data") map.set(parsed.name, e); // one edge per output (validated)
      }
      return map;
    };

    // ---- worker -------------------------------------------------------------
    const runNode = async (node: FlowNodeV2): Promise<void> => {
      const counts: ItemCounts = { ok: 0, failed: 0, skipped: 0 };
      nodeItemCounts[node.id] = counts;
      const nodeStartedAt = new Date().toISOString();
      const nodeStart = Date.now();

      const outEdges = outputEdgesOf(node.id);
      const outCounters = new Map<string, number>();

      const push = (portName: string, build: (index: number) => StreamMsg) => {
        const edge = outEdges.get(portName);
        if (!edge) return; // nothing listening on this port
        const index = outCounters.get(portName) ?? 0;
        outCounters.set(portName, index + 1);
        const msg = build(index);
        // A per-connection JSONPath projection applies to real items only.
        if (msg.kind === "item" && edge.path) {
          const res = evalJsonPath(edge.path, msg.value);
          channels.get(edge.id)!.push(
            res.found
              ? makeItem(index, res.value)
              : hole(index, { nodeId: node.id, nodeName: node.name }, `Connection path "${edge.path}" matched nothing`)
          );
          return;
        }
        channels.get(edge.id)!.push(msg);
      };
      const pushItem = (portName: string, value: unknown) => push(portName, (i) => makeItem(i, value));
      const pushHole = (portName: string, error: string, origin?: HoleMsg) =>
        push(portName, (i) =>
          origin
            ? { ...origin, index: i }
            : hole(i, { nodeId: node.id, nodeName: node.name }, error)
        );
      const closeAll = () => {
        for (const [portName, edge] of outEdges) {
          channels.get(edge.id)!.push({ kind: "eos", count: outCounters.get(portName) ?? 0 });
        }
      };
      const abortAll = (reason: string) => {
        for (const [, edge] of outEdges) channels.get(edge.id)!.push({ kind: "abort", reason });
      };

      // Gate on incoming triggers.
      const gate = gates.get(node.id)!;
      emitStatus(node.id, "pending");
      await gate.promise;
      if (gate.skipReason || state.cancelled) {
        const reason = gate.skipReason || "Skipped: run cancelled";
        emitStatus(node.id, "skipped");
        emit(makeRecord(node, null, "skipped", nodeStartedAt, 0, { error: reason }));
        abortAll(reason);
        failDone(node.id, reason);
        return;
      }
      emitStatus(node.id, "running");

      const inputs = inputChannelsOf(node.id);
      const joiner = new Joiner(inputs);
      const cfg = node.config as FlowNodeConfigV2 & {
        staticInputs?: Record<string, StaticInputV2>;
        rows?: { id: string; path?: string; field?: string }[];
        count?: number;
        ms?: number;
      };

      const finishOk = (summary?: Partial<RunRecord>) => {
        closeAll();
        const status = counts.failed > 0 ? "partial" : "success";
        emitStatus(node.id, status);
        if (summary) emit(makeRecord(node, null, counts.failed > 0 ? "failed" : "success", nodeStartedAt, Date.now() - nodeStart, summary));
        fireDone(node.id);
      };
      const finishHard = (message: string) => {
        emitStatus(node.id, "failed");
        emit(makeRecord(node, null, "failed", nodeStartedAt, Date.now() - nodeStart, { error: message }));
        abortAll(message);
        failDone(node.id, `Skipped: upstream "${node.name}" failed`);
      };
      const finishSkipped = (reason: string) => {
        emitStatus(node.id, "skipped");
        emit(makeRecord(node, null, "skipped", nodeStartedAt, 0, { error: reason }));
        abortAll(reason);
        failDone(node.id, reason);
      };

      // ---- per-node-type item work -----------------------------------------

      const staticValue = (name: string): { present: boolean; value: unknown; error?: string } => {
        const input: StaticInputV2 | undefined = (cfg.staticInputs || {})[name];
        if (!input || input.value === "") return { present: false, value: undefined };
        const parsed = parseStaticInput(input);
        return parsed.ok
          ? { present: true, value: parsed.value }
          : { present: true, value: undefined, error: parsed.error };
      };

      const runRequestItem = async (
        index: number,
        values: Record<string, ValueMsg>
      ): Promise<{ ok: boolean; outputs: Record<string, unknown>; passed?: boolean }> => {
        const rcfg = cfg as RequestNodeConfigV2;
        const request = lookupRequest(deps.collections, rcfg.requestId) as RequestItem;
        const bindings = new Map<string, InputBinding>();
        for (const b of request.inputs || []) bindings.set(b.name, b);
        const resolvedInputs: Record<string, string> = {};

        // hardcoded values first, connected inputs override
        for (const name of Object.keys(rcfg.staticInputs || {})) {
          const sv = staticValue(name);
          if (!sv.present) continue;
          const text = stringifyValue(sv.value);
          bindings.set(name, { name, source: "literal", value: text });
          resolvedInputs[name] = text;
        }
        for (const [name, msg] of Object.entries(values)) {
          if (name.startsWith("cmp:")) continue; // verify expectations, not request inputs
          if (msg.kind !== "item") continue;
          const text = stringifyValue(msg.value);
          bindings.set(name, { name, source: "literal", value: text });
          resolvedInputs[name] = text;
        }

        const verify = rcfg.verify?.enabled ? rcfg.verify : null;
        const maxAttempts = verify ? Math.max(1, verify.maxAttempts || 1) : 1;
        let lastExec: ExecutionResult | null = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const attemptStartedAt = new Date().toISOString();
          const attemptStart = Date.now();
          const exec = await executeResolvedRequest(request, bindings, resolvedInputs, deps, state);
          lastExec = exec;

          let error = exec.error;
          let passed = true;
          if (verify && exec.response) {
            const target = verifyTarget(exec);
            const details: string[] = [];
            for (const check of verify.checks || []) {
              const found = evalJsonPath(check.path, target);
              const expected = expectedFor(check, values);
              const ok = found.found
                ? compareValues(check.operator, found.value, expected)
                : check.operator === "not_equals";
              if (!ok) passed = false;
              details.push(
                `${check.path} ${check.operator}` +
                  (check.operator === "exists" ? "" : ` ${JSON.stringify(String(expected))}`) +
                  ` — actual: ${found.found ? stringifyValue(found.value) : "<missing>"} ${ok ? "✓" : "✗"}`
              );
            }
            error = passed ? undefined : `Verification failed: ${details.join("; ")}`;
          } else if (verify && !exec.response) {
            passed = false;
          }

          const attemptOk = !!exec.ok && passed;
          emit(
            makeRecord(node, { ...exec, error }, attemptOk ? "success" : "failed", attemptStartedAt, Date.now() - attemptStart, {
              iteration: index,
              ...(verify ? { attempt } : {}),
            })
          );
          if (attemptOk) return { ok: true, outputs: exec.outputs, passed: verify ? true : undefined };
          if (attempt < maxAttempts) await cancellableDelay(Math.max(0, verify?.intervalMs || 0), state);
        }
        return { ok: false, outputs: lastExec?.outputs || {} };
      };

      const expectedFor = (check: VerifyCheckV2, values: Record<string, ValueMsg>): unknown => {
        if (check.expectedSource !== "port") return check.expected;
        const msg = values[verifyCheckPortName(check.id)];
        return msg && msg.kind === "item" ? msg.value : undefined;
      };

      // The single value a one-input plumbing node works on.
      const soleValue = (values: Record<string, ValueMsg>, portName: string): ValueMsg | undefined =>
        values[portName];

      try {
        // Nodes with no connected data inputs still do exactly one unit of work
        // (their inputs are all hardcoded), then close.
        const unitOnly = joiner.inputCount === 0;
        let index = 0;
        const accumulated: unknown[] = [];
        let dropped = 0;
        let emitted = 0; // arrayEmit total, capped

        while (true) {
          if (state.cancelled) throw new FlowCancelledError();

          let values: Record<string, ValueMsg> = {};
          if (unitOnly) {
            if (index > 0) break;
          } else {
            const res = await joiner.next();
            if (res.kind === "end") break;
            if (res.kind === "mismatch") return finishHard(res.message);
            if (res.kind === "abort") return finishSkipped(`Skipped: ${res.reason}`);
            values = res.values;
          }

          const incomingHole = firstHole(values);

          switch (node.type) {
            case "request": {
              if (incomingHole) {
                counts.skipped += 1;
                emit(
                  makeRecord(node, null, "skipped", new Date().toISOString(), 0, {
                    iteration: index,
                    error: `Skipped: item failed upstream in "${incomingHole.originNodeName}"`,
                  })
                );
                for (const port of outEdges.keys()) pushHole(port, "", incomingHole);
                break;
              }
              const result = await runRequestItem(index, values);
              if (result.ok) {
                counts.ok += 1;
                for (const port of outEdges.keys()) {
                  if (port === "passed") pushItem(port, true);
                  else pushItem(port, result.outputs[port]);
                }
              } else {
                counts.failed += 1;
                for (const port of outEdges.keys())
                  pushHole(port, `Item ${index} failed in "${node.name}"`);
              }
              break;
            }

            case "delay": {
              const ms = Math.max(0, (cfg as DelayNodeConfigV2).ms || 0);
              const value = soleValue(values, "value");
              if (incomingHole) {
                counts.skipped += 1;
                pushHole("value", "", incomingHole);
                break;
              }
              await cancellableDelay(ms, state);
              counts.ok += 1;
              if (value && value.kind === "item") pushItem("value", value.value);
              break;
            }

            case "arrayEmit": {
              if (incomingHole) {
                counts.skipped += 1;
                pushHole("item", "", incomingHole);
                pushHole("index", "", incomingHole);
                break;
              }
              const src = soleValue(values, "array");
              let raw: unknown;
              if (src && src.kind === "item") {
                raw = src.value;
              } else {
                const parsed = parseStaticInput(
                  (cfg as ArrayEmitNodeConfigV2).staticItems || emptyStaticInput("json")
                );
                raw = parsed.ok ? parsed.value : null;
              }
              if (typeof raw === "string") {
                try {
                  raw = JSON.parse(raw);
                } catch {
                  /* handled below */
                }
              }
              if (!Array.isArray(raw)) {
                counts.failed += 1;
                emit(
                  makeRecord(node, null, "failed", new Date().toISOString(), 0, {
                    iteration: index,
                    error: "Input is not an array",
                  })
                );
                pushHole("item", "Input is not an array");
                pushHole("index", "Input is not an array");
                break;
              }
              if (emitted + raw.length > EMIT_MAX_ITEMS) {
                return finishHard(
                  `Emitting ${emitted + raw.length} items exceeds the maximum of ${EMIT_MAX_ITEMS}`
                );
              }
              for (let k = 0; k < raw.length; k++) {
                pushItem("item", raw[k]);
                pushItem("index", emitted + k);
              }
              emitted += raw.length;
              counts.ok += 1;
              break;
            }

            case "accumulator": {
              const value = soleValue(values, "item");
              if (incomingHole) {
                dropped += 1;
                counts.skipped += 1;
              } else if (value && value.kind === "item") {
                accumulated.push(value.value);
                counts.ok += 1;
              }
              break;
            }

            case "demux": {
              const rows = (cfg as DemuxNodeConfigV2).rows || [];
              const value = soleValue(values, "object");
              if (incomingHole) {
                counts.skipped += 1;
                for (const r of rows) pushHole(demuxOutName(r.id), "", incomingHole);
                break;
              }
              const source = value && value.kind === "item" ? value.value : staticValue("object").value;
              let anyMiss = false;
              for (const r of rows) {
                const res = evalJsonPath(r.path, source);
                if (res.found) pushItem(demuxOutName(r.id), res.value);
                else {
                  anyMiss = true;
                  pushHole(demuxOutName(r.id), `Path "${r.path}" matched nothing`);
                  emit(
                    makeRecord(node, null, "failed", new Date().toISOString(), 0, {
                      iteration: index,
                      error: `Path "${r.path}" matched nothing`,
                    })
                  );
                }
              }
              if (anyMiss) counts.failed += 1;
              else counts.ok += 1;
              break;
            }

            case "mux": {
              const rows = (cfg as MuxNodeConfigV2).rows || [];
              if (incomingHole) {
                counts.skipped += 1;
                pushHole("object", "", incomingHole);
                break;
              }
              const obj: Record<string, unknown> = {};
              for (const r of rows) {
                const msg = values[muxInName(r.id)];
                if (msg && msg.kind === "item") obj[r.field] = msg.value;
                else {
                  const sv = staticValue(muxInName(r.id));
                  if (sv.present) obj[r.field] = sv.value;
                }
              }
              counts.ok += 1;
              pushItem("object", obj);
              break;
            }

            case "duplicator": {
              const count = (cfg as DuplicatorNodeConfigV2).count || 0;
              const value = soleValue(values, "value");
              for (let k = 0; k < count; k++) {
                if (incomingHole) pushHole(duplicatorOutName(k), "", incomingHole);
                else if (value && value.kind === "item") pushItem(duplicatorOutName(k), value.value);
              }
              if (incomingHole) counts.skipped += 1;
              else counts.ok += 1;
              break;
            }
          }

          index += 1;
        }

        // ---- finalize -------------------------------------------------------
        if (node.type === "accumulator") {
          pushItem("array", accumulated);
          pushItem("count", accumulated.length);
          finishOk({ outputs: { items: accumulated, count: accumulated.length, dropped } });
          return;
        }
        if (node.type === "request") {
          finishOk(); // per-item records already emitted
          return;
        }
        finishOk({
          outputs:
            node.type === "arrayEmit"
              ? { emitted }
              : { items: counts.ok + counts.failed + counts.skipped },
        });
      } catch (e) {
        if (e instanceof FlowCancelledError || state.cancelled) {
          emitStatus(node.id, "failed");
          emit(makeRecord(node, null, "failed", nodeStartedAt, Date.now() - nodeStart, { error: "Run cancelled" }));
          abortAll("Run cancelled");
          failDone(node.id, "Skipped: run cancelled");
          return;
        }
        finishHard(e instanceof Error ? e.message : String(e));
      }
    };

    await Promise.all(flow.nodes.map((node) => runNode(node)));

    const failed = Object.values(nodeStatuses).some((s) => s === "failed" || s === "partial");
    return {
      status: state.cancelled ? "cancelled" : failed ? "failed" : "success",
      records,
      startedAt,
      durationMs: Date.now() - runStart,
      nodeStatuses,
      nodeItemCounts,
    };
  })();

  return { cancel, done };
}
