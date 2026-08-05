// Replays the shared V2 golden fixtures (backend/tests/fixtures/v2_flows/*)
// against the TS engine. backend/tests/test_flow_runner_v2.py replays the same
// files against the Python engine — a semantic change that lands in only one
// runner breaks exactly one of the two suites.
//
// Records are compared PER NODE, in order. Under pipelining the interleaving of
// records across different nodes is legitimately nondeterministic (item 2 may
// enter node A while item 1 is still in node B), so only each node's own
// sequence is asserted.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runFlowV2 } from "./flowRunnerV2";
import type { FlowRunDeps, RunRecord } from "./flowRunner";

vi.mock("../context/AppContext", () => ({
  findRequestInTree: (col: { requests?: { id: string }[] }, requestId: string) =>
    (col.requests || []).find((r) => r.id === requestId) || null,
}));

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../backend/tests/fixtures/v2_flows"
);

const fixtures = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(path.join(FIXTURES_DIR, f), "utf8")));

describe("V2 golden fixtures", () => {
  it("finds the shared fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    it(fixture.name, async () => {
      const calls = new Map<string, number>();
      const bindingsSeen = new Map<string, Record<string, string>[]>();

      const apiCall = async (p: string, options?: RequestInit) => {
        if (p.startsWith("/api/local-store/pref/")) return { value: null };
        if (p === "/api/executor/run") {
          const payload = JSON.parse(String(options?.body));
          const id = payload.requestId;
          const call = calls.get(id) || 0;
          calls.set(id, call + 1);
          if (!bindingsSeen.has(id)) bindingsSeen.set(id, []);
          bindingsSeen
            .get(id)!
            .push(
              Object.fromEntries(
                (payload.inputs as { name: string; value: string }[]).map((b) => [b.name, b.value])
              )
            );
          const script = fixture.executorScript[id] || [];
          if (call >= script.length)
            throw new Error(`Fixture "${fixture.name}": unscripted call #${call + 1} to ${id}`);
          return script[call];
        }
        throw new Error(`Unexpected apiCall path: ${p}`);
      };

      const records: RunRecord[] = [];
      const deps: FlowRunDeps = { apiCall, collections: fixture.collections, environmentId: null };
      const summary = await runFlowV2(fixture.flow, deps, {
        onNodeStatus: () => {},
        onRecord: (r) => records.push(r),
      }).done;

      expect(summary.status, "run status").toBe(fixture.expected.status);

      // Per-node record sequences (order within a node is deterministic).
      for (const [nodeName, expectedRecords] of Object.entries(fixture.expected.recordsByNode || {})) {
        const actual = records.filter((r) => r.nodeName === nodeName);
        const expected = expectedRecords as Record<string, unknown>[];
        expect(actual.length, `record count for "${nodeName}"`).toBe(expected.length);
        expected.forEach((expectedRecord, i) => {
          for (const [key, value] of Object.entries(expectedRecord)) {
            expect((actual[i] as unknown as Record<string, unknown>)[key], `${nodeName} record[${i}].${key}`).toEqual(value);
          }
        });
      }

      // Executor calls, in order, per saved request.
      for (const [requestId, expectedCalls] of Object.entries(fixture.expected.bindings || {})) {
        const seen = bindingsSeen.get(requestId) || [];
        expect(seen.length, `call count for ${requestId}`).toBe((expectedCalls as unknown[]).length);
        (expectedCalls as Record<string, string>[]).forEach((expectedBindings, call) => {
          for (const [name, value] of Object.entries(expectedBindings)) {
            expect(seen[call]?.[name], `${requestId} call ${call} input ${name}`).toBe(value);
          }
        });
      }

      // Outputs on a node's final record (accumulator arrays, emitter counts…).
      for (const [nodeName, expectedOutputs] of Object.entries(fixture.expected.nodeOutputs || {})) {
        const last = [...records].reverse().find((r) => r.nodeName === nodeName);
        expect(last?.outputs, `outputs of ${nodeName}`).toEqual(expectedOutputs);
      }

      // Per-node item tallies.
      for (const [nodeName, expectedCounts] of Object.entries(fixture.expected.nodeItemCounts || {})) {
        const nodeId = fixture.flow.nodes.find((n: { name: string; id: string }) => n.name === nodeName)?.id;
        expect(summary.nodeItemCounts?.[nodeId], `item counts of ${nodeName}`).toEqual(expectedCounts);
      }
    });
  }
});
