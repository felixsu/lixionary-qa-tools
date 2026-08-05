"use client";

// Legacy (V1) API Studio editor — VIEW/RUN ONLY. Rendered by page.tsx for
// flows without schemaVersion: 2. Editing is frozen: no palette, no
// connecting/dragging/deleting, no save, no assistant, config inputs
// disabled. Run/Stop/Retry/Report and flow management (rename/duplicate/
// delete) still work. This file is scheduled for removal once the V1→V2
// converter ships; new flows always open in editorV2/.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  SelectionMode,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Plus, Play, Square, Download, Trash2, Pencil, Copy,
  AlertCircle, X, RotateCcw,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { useAppContext } from "../../../context/AppContext";
import { useFlowRuns } from "../../../context/FlowRunsContext";
import type { Collection } from "../../../context/AppContext";
import { useToast } from "../../../context/ToastContext";
import Dropdown from "../../../components/Dropdown";
import { Modal, ModalFooter } from "../../../components/Modal";
import { confirmDialog } from "../../../utils/confirmDialog";
import { scanInputNames, scanEnvNames } from "../../../utils/requestTokens";
import { generateDuplicateName } from "../../../utils/uniqueName";
import {
  type Flow, type FlowNode, type FlowEdge,
  type RequestNodeConfig, type LooperNodeConfig, type DelayNodeConfig, type VerifierNodeConfig,
  type FlowInputMapping, type VerifierComparison, type ComparisonOperator,
  validateNodeName,
} from "../../../utils/flowTypes";
import {
  runFlow, topoSort, publishedOutputs, ancestorNodeIds, lookupRequest,
  structuralSignature, mergeRetrySummary,
  type NodeRunStatus, type RunRecord, type FlowRunSummary, type RunHandle,
} from "../../../utils/flowRunner";
import { buildRunCsv, downloadCsv, runCsvFilename, persistLastRun, loadLastRun } from "../../../utils/flowReport";
import { studioNodeTypes, type StudioNode, type StudioNodeData } from "../components/nodes";
import RequestPicker from "../RequestPicker";

const asMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const inputCls =
  "h-[30px] bg-cream border border-line rounded-md px-2.5 font-mono text-xs text-graphite outline-none focus:border-clay";

// ---- helpers ----------------------------------------------------------------

const requestNodeConfigOf = (node: FlowNode): RequestNodeConfig | null => {
  if (node.type === "request") return node.config as RequestNodeConfig;
  if (node.type === "looper") return (node.config as LooperNodeConfig).request;
  if (node.type === "verifier") return (node.config as VerifierNodeConfig).request;
  return null;
};

const decorate = (fn: FlowNode, status: NodeRunStatus, collections: Collection[]): StudioNodeData => {
  const cfg = requestNodeConfigOf(fn);
  if (!cfg) return { flowNode: fn, status, requestLabel: null, requestMissing: false };
  if (!cfg.requestId) return { flowNode: fn, status, requestLabel: "No request selected", requestMissing: true };
  const req = lookupRequest(collections, cfg.requestId);
  if (!req) return { flowNode: fn, status, requestLabel: "Linked request not found", requestMissing: true };
  return { flowNode: fn, status, requestLabel: `${req.method} ${req.name}`, requestMissing: false };
};

const toStudioNode = (fn: FlowNode, status: NodeRunStatus, collections: Collection[]): StudioNode => ({
  id: fn.id,
  type: fn.type,
  position: fn.position,
  data: decorate(fn, status, collections),
});

const serializeNodes = (nodes: StudioNode[]): FlowNode[] =>
  nodes.map((n) => ({ ...n.data.flowNode, position: { x: n.position.x, y: n.position.y } }));

const serializeEdges = (edges: Edge[]): FlowEdge[] =>
  edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));

// Declared input names of a request: live token scan ∪ stored bindings.
const requestInputNames = (collections: Collection[], requestId: string): string[] => {
  const req = lookupRequest(collections, requestId);
  if (!req) return [];
  const scanned = scanInputNames({
    url: req.url,
    headers: req.headers || [],
    queryParams: req.queryParams || [],
    body: req.body || "",
    authType: req.authType,
    authConfig: req.authConfig || {},
  });
  const names = [...scanned];
  for (const b of req.inputs || []) if (!names.includes(b.name)) names.push(b.name);
  return names;
};

// ---- editor -----------------------------------------------------------------

export default function LegacyEditor(props: LegacyEditorProps) {
  return (
    <ReactFlowProvider>
      <StudioEditor {...props} />
    </ReactFlowProvider>
  );
}

interface LegacyEditorProps {
  selectedFlow: Flow; // always a V1 flow — page.tsx branches on schemaVersion
  onSelectFlow: (flowId: string) => void; // "" = let the page pick a default
}

function StudioEditor({ selectedFlow, onSelectFlow }: LegacyEditorProps) {
  const {
    flows, createFlow, updateFlow, deleteFlow,
    collections,
    apiCall,
    environments, selectedEnvId,
  } = useAppContext();
  const { activeRuns, registerRun } = useFlowRuns();

  const selectedFlowId = selectedFlow.id;
  const [nodes, setNodes, onNodesChange] = useNodesState<StudioNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [lastSummary, setLastSummary] = useState<FlowRunSummary | null>(null);
  const runHandleRef = useRef<RunHandle | null>(null);

  const [showNewFlowModal, setShowNewFlowModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [flowNameDraft, setFlowNameDraft] = useState("");
  const { showToast } = useToast();

  // MCP-triggered runs execute in the sidecar — surface them here since the
  // canvas has no other trace of an agent run in progress.
  const agentRuns = activeRuns.filter((r) => r.source === "mcp");

  // Load a flow into the canvas (statuses from its stored last run, dimmed as "idle").
  const loadFlow = useCallback((flow: Flow) => {
    const lastRun = loadLastRun(flow.id);
    const statusByNode = new Map<string, NodeRunStatus>();
    if (lastRun?.nodeStatuses) {
      for (const [nodeId, status] of Object.entries(lastRun.nodeStatuses)) statusByNode.set(nodeId, status);
    } else if (lastRun) {
      // Pre-Retry blobs: derive per-node status from records, last one wins.
      for (const r of lastRun.records) statusByNode.set(r.nodeId, r.status);
    }
    setNodes(flow.nodes.map((fn) => toStudioNode(fn, statusByNode.get(fn.id) || "idle", collections)));
    setEdges(flow.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
    setSelectedNodeId(null);
    setRecords(lastRun?.records || []);
    setLastSummary(lastRun);
  }, [collections, setNodes, setEdges]);

  // Load on mount and whenever the page hands us a different flow.
  useEffect(() => {
    loadFlow(selectedFlow);
  }, [selectedFlowId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh request labels when collections change (e.g. a request was renamed).
  useEffect(() => {
    setNodes((prev) => prev.map((n) => ({ ...n, data: decorate(n.data.flowNode, n.data.status, collections) })));
  }, [collections, setNodes]);

  const setNodeStatus = useCallback((nodeId: string, status: NodeRunStatus) => {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n)));
  }, [setNodes]);

  const resetStatuses = useCallback(() => {
    setNodes((prev) => prev.map((n) => ({ ...n, data: { ...n.data, status: "idle" as NodeRunStatus } })));
  }, [setNodes]);

  // ---- validation ----

  const validationError = useMemo((): string | null => {
    const flowNodes = serializeNodes(nodes);
    const flowEdges = serializeEdges(edges);
    for (const n of flowNodes) {
      const nameError = validateNodeName(n.name, flowNodes, n.id);
      if (nameError) return `Node "${n.name || "(unnamed)"}": ${nameError}`;
      const cfg = requestNodeConfigOf(n);
      if (cfg && !cfg.requestId) return `Node "${n.name}": no request selected`;
      if (cfg && !lookupRequest(collections, cfg.requestId)) return `Node "${n.name}": linked request not found`;
    }
    const sorted = topoSort(flowNodes, flowEdges);
    if ("cycle" in sorted) return `Flow contains a cycle involving: ${sorted.cycle.join(", ")}`;
    // Dangling references: mapping/comparison references must point at upstream node names (or item in loopers).
    const nodeById = new Map(flowNodes.map((n) => [n.id, n]));
    for (const n of flowNodes) {
      const upstreamNames = new Set(
        Array.from(ancestorNodeIds(n.id, flowEdges)).map((id) => nodeById.get(id)?.name).filter(Boolean)
      );
      const checkRef = (ref: string, allowItem: boolean, what: string): string | null => {
        const head = ref.split(".")[0]?.trim();
        if (!head) return `Node "${n.name}": empty reference for ${what}`;
        if (head === "item") return allowItem ? null : `Node "${n.name}": "item" is only available inside a looper`;
        if (!upstreamNames.has(head)) return `Node "${n.name}": reference "${ref}" does not match any upstream node`;
        return null;
      };
      const cfg = requestNodeConfigOf(n);
      if (cfg) {
        const allowItem = n.type === "looper";
        for (const m of cfg.mappings || []) {
          if (m.source === "reference") {
            const err = checkRef(m.value, allowItem, `input "${m.inputName}"`);
            if (err) return err;
          }
        }
      }
      if (n.type === "looper") {
        const lc = n.config as LooperNodeConfig;
        if (lc.itemsSource === "reference") {
          const err = checkRef(lc.itemsValue, false, "looper items");
          if (err) return err;
        }
      }
      if (n.type === "verifier") {
        const vc = n.config as VerifierNodeConfig;
        for (const c of vc.comparisons || []) {
          if (c.expectedSource === "reference") {
            const err = checkRef(c.expected, false, `comparison on "${c.field}"`);
            if (err) return err;
          }
        }
      }
    }
    return null;
  }, [nodes, edges, collections]);

  // Non-blocking: {{env.X}} vars referenced by linked requests but absent from
  // the active environment. Not an error — a parser script earlier in the flow
  // may env.set() them at runtime — but the most common cause is running with
  // the wrong environment selected.
  const envWarning = useMemo((): string | null => {
    const activeEnv = environments.find((e) => e.id === selectedEnvId);
    const defined = new Set((activeEnv?.variables || []).map((v) => v.key));
    const missing = new Set<string>();
    for (const n of nodes) {
      const cfg = requestNodeConfigOf(n.data.flowNode);
      if (!cfg?.requestId) continue;
      const req = lookupRequest(collections, cfg.requestId);
      if (!req) continue;
      const referenced = scanEnvNames({
        url: req.url,
        headers: req.headers || [],
        queryParams: req.queryParams || [],
        body: req.body || "",
        authType: req.authType,
        authConfig: req.authConfig || {},
      });
      for (const name of referenced) {
        if (!defined.has(name)) missing.add(name);
      }
    }
    if (!missing.size) return null;
    const list = Array.from(missing).join(", ");
    return activeEnv
      ? `Env vars not defined in "${activeEnv.name}": ${list}`
      : `No active environment — {{env.*}} vars unresolved: ${list}`;
  }, [nodes, collections, environments, selectedEnvId]);

  // Retry is offered after a failed or cancelled run; whether it can actually
  // start is a separate check so the button can explain why it's disabled.
  const retryable =
    !isRunning && !!lastSummary && (lastSummary.status === "failed" || lastSummary.status === "cancelled");

  const retryBlockedReason = useMemo((): string | null => {
    if (!lastSummary) return null;
    // contextTruncated blobs also lack context — check the flag first for the
    // more specific message. A legitimately empty context is {} (truthy).
    if (lastSummary.contextTruncated) return "Run data was truncated when saved — run the full flow again";
    if (!lastSummary.context || !lastSummary.nodeStatuses || !lastSummary.runSignature)
      return "This run was saved before Retry existed — run the flow again";
    if (lastSummary.runSignature !== structuralSignature(serializeNodes(nodes), serializeEdges(edges)))
      return "Flow changed since the last run";
    if (validationError) return validationError;
    return null;
  }, [lastSummary, nodes, edges, validationError]);

  // ---- toolbar actions ----

  const onRun = async () => {
    if (!selectedFlow || isRunning) return;
    if (validationError) {
      showToast(`Cannot run: ${validationError}`, { type: "error" });
      return;
    }
    const flow: Flow = {
      ...selectedFlow,
      nodes: serializeNodes(nodes),
      edges: serializeEdges(edges),
    };
    setIsRunning(true);
    resetStatuses();
    setRecords([]);
    setLastSummary(null);

    const handle = runFlow(
      flow,
      { apiCall, collections, environmentId: selectedEnvId || null },
      {
        onNodeStatus: setNodeStatus,
        onRecord: (record) => setRecords((prev) => [...prev, record]),
      }
    );
    runHandleRef.current = handle;
    try {
      const summary = await handle.done;
      setLastSummary(summary);
      persistLastRun(flow.id, summary);
      void registerRun({
        flowLocalId: flow.id,
        flowName: flow.name,
        environmentLocalId: selectedEnvId || null,
        environmentName: environments.find((e) => e.id === selectedEnvId)?.name ?? null,
        nodeCount: flow.nodes.length,
        summary,
      });
      showToast(
        summary.status === "success"
          ? `Run finished — ${summary.records.length} steps in ${summary.durationMs} ms`
          : summary.status === "cancelled"
            ? "Run cancelled"
            : "Run failed — see node statuses",
        { type: summary.status === "success" ? "success" : summary.status === "cancelled" ? "info" : "error" }
      );
    } catch (e) {
      showToast(`Run error: ${asMessage(e)}`, { type: "error" });
    } finally {
      setIsRunning(false);
      runHandleRef.current = null;
    }
  };

  const onStop = () => runHandleRef.current?.cancel();

  // Re-run only the failed/skipped nodes of the last run, reusing successful
  // nodes' outputs, then persist one merged summary for the whole flow.
  const onRetry = async () => {
    if (!selectedFlow || !retryable) return;
    if (retryBlockedReason) {
      showToast(`Cannot retry: ${retryBlockedReason}`, { type: "error" });
      return;
    }
    const prior = lastSummary!;
    const completedNodeIds = Object.entries(prior.nodeStatuses!)
      .filter(([, status]) => status === "success")
      .map(([nodeId]) => nodeId);
    const completedSet = new Set(completedNodeIds);
    const flow: Flow = {
      ...selectedFlow,
      nodes: serializeNodes(nodes),
      edges: serializeEdges(edges),
    };
    setIsRunning(true);
    // No resetStatuses(): the runner immediately re-emits "success" for
    // completed nodes and "pending" for everything that will re-run. Seed the
    // record list with the retained prior records so the inspector and Report
    // show the merged view while the retry is in flight.
    setRecords(prior.records.filter((r) => completedSet.has(r.nodeId)));

    const handle = runFlow(
      flow,
      { apiCall, collections, environmentId: selectedEnvId || null },
      {
        onNodeStatus: setNodeStatus,
        onRecord: (record) => setRecords((prev) => [...prev, record]),
      },
      { context: prior.context!, completedNodeIds }
    );
    runHandleRef.current = handle;
    try {
      const next = await handle.done;
      const merged = mergeRetrySummary(prior, next);
      setLastSummary(merged);
      persistLastRun(flow.id, merged);
      // A retry lands as one new history entry holding the merged run.
      void registerRun({
        flowLocalId: flow.id,
        flowName: flow.name,
        environmentLocalId: selectedEnvId || null,
        environmentName: environments.find((e) => e.id === selectedEnvId)?.name ?? null,
        nodeCount: flow.nodes.length,
        summary: merged,
      });
      showToast(
        next.status === "success"
          ? `Retry finished — ${next.records.length} steps re-run in ${next.durationMs} ms`
          : next.status === "cancelled"
            ? "Retry cancelled"
            : "Retry failed — see node statuses",
        { type: next.status === "success" ? "success" : next.status === "cancelled" ? "info" : "error" }
      );
    } catch (e) {
      showToast(`Retry error: ${asMessage(e)}`, { type: "error" });
    } finally {
      setIsRunning(false);
      runHandleRef.current = null;
    }
  };

  const onDownloadReport = () => {
    if (!records.length || !selectedFlow) return;
    downloadCsv(buildRunCsv(records), runCsvFilename(selectedFlow.name));
  };

  const onCreateFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flowNameDraft.trim()) return;
    try {
      // New flows are V2 — the page swaps to the V2 editor on selection.
      const flow = await createFlow(flowNameDraft.trim());
      setShowNewFlowModal(false);
      setFlowNameDraft("");
      onSelectFlow(flow.id);
      showToast("Flow created", { type: "success" });
    } catch (err) {
      showToast(asMessage(err), { type: "error" });
    }
  };

  const onRenameFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flowNameDraft.trim()) return;
    try {
      await updateFlow(selectedFlow.id, { name: flowNameDraft.trim() });
      setShowRenameModal(false);
      showToast("Flow renamed", { type: "success" });
    } catch (err) {
      showToast(asMessage(err), { type: "error" });
    }
  };

  const onDeleteFlow = async () => {
    const ok = await confirmDialog(`Delete flow "${selectedFlow.name}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await deleteFlow(selectedFlow.id);
      onSelectFlow("");
      showToast("Flow deleted", { type: "success" });
    } catch (err) {
      showToast(asMessage(err), { type: "error" });
    }
  };

  const onDuplicateFlow = async () => {
    try {
      const flowNodes = serializeNodes(nodes);
      const flowEdges = serializeEdges(edges);
      const newName = generateDuplicateName(selectedFlow.name, flows.map((f) => f.name));

      // schemaVersion null: a duplicated legacy flow stays legacy V1 —
      // stamping it V2 would hand V1-shaped nodes to the V2 editor/runner.
      const created = await createFlow(newName, null);
      // Pass `created` as baseFlow — `flows` state doesn't contain `created`
      // yet at this point (see updateFlow's baseFlow param).
      await updateFlow(created.id, { description: selectedFlow.description, nodes: flowNodes, edges: flowEdges }, created);

      onSelectFlow(created.id);
      showToast("Flow duplicated", { type: "success" });
    } catch (err) {
      showToast(asMessage(err), { type: "error" });
    }
  };

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;
  const selectedNodeRecords = useMemo(
    () => (selectedNode ? records.filter((r) => r.nodeId === selectedNode.id) : []),
    [records, selectedNode]
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="h-14 px-4 border-b border-line bg-cream flex items-center gap-2 flex-shrink-0">
        <Dropdown
          value={selectedFlowId}
          onChange={onSelectFlow}
          placeholder={flows.length ? "Select flow…" : "No flows yet"}
          widthClass="w-[240px]"
          options={flows.map((f) => ({
            value: f.id,
            label: f.schemaVersion === 2 ? f.name : `${f.name} · Legacy`,
          }))}
        />
        <span
          className="h-6 px-2 flex items-center rounded-md bg-amber-50 border border-amber-300 text-[10px] font-semibold uppercase tracking-wide text-amber-700 flex-shrink-0"
          title="V1 flows are view/run-only. Create a new flow to use the V2 editor; conversion is coming in a later release."
        >
          Legacy · view/run only
        </span>
        <button
          onClick={() => { setFlowNameDraft(""); setShowNewFlowModal(true); }}
          className="h-8 px-2.5 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
        <button
          onClick={() => { setFlowNameDraft(selectedFlow.name); setShowRenameModal(true); }}
          title="Rename flow"
          className="h-8 w-8 flex items-center justify-center bg-cream border border-line rounded-md text-graphite hover:bg-panel transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDuplicateFlow}
          title="Duplicate flow (stays a legacy V1 flow)"
          className="h-8 w-8 flex items-center justify-center bg-cream border border-line rounded-md text-graphite hover:bg-panel transition-colors"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDeleteFlow}
          title="Delete flow"
          className="h-8 w-8 flex items-center justify-center bg-cream border border-line rounded-md text-stone hover:bg-danger-soft hover:text-danger transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>

        <div className="flex-1" />

        {agentRuns.length > 0 && (
          <span
            className="flex items-center gap-1.5 h-8 px-3 bg-clay/10 border border-clay/40 rounded-md text-[11px] font-medium text-clay max-w-[280px] truncate"
            title={agentRuns.map((r) => r.flowName).join(", ")}
          >
            <span className="h-2 w-2 rounded-full bg-clay animate-pulse flex-shrink-0" />
            Agent running: {agentRuns[0].flowName}
            {agentRuns.length > 1 ? ` +${agentRuns.length - 1} more` : ""}
          </span>
        )}
        {validationError ? (
          <span className="flex items-center gap-1.5 text-[11px] text-amber-700 max-w-[320px] truncate" title={validationError}>
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" /> {validationError}
          </span>
        ) : envWarning ? (
          <span className="flex items-center gap-1.5 text-[11px] text-amber-700 max-w-[320px] truncate" title={`${envWarning} — they may still be set at runtime via env.set()`}>
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" /> {envWarning}
          </span>
        ) : null}
        <button
          onClick={onDownloadReport}
          disabled={!records.length}
          className="h-8 px-3 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> Report
        </button>
        {retryable && (
          <button
            onClick={onRetry}
            disabled={!!retryBlockedReason}
            title={retryBlockedReason || "Re-run only the failed and skipped nodes, reusing successful outputs"}
            className="h-8 px-3 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Retry
          </button>
        )}
        {isRunning ? (
          <button
            onClick={onStop}
            className="h-8 px-4 flex items-center gap-1.5 bg-red-600 hover:bg-red-700 rounded-md text-xs font-medium text-white transition-colors"
          >
            <Square className="h-3.5 w-3.5" /> Stop
          </button>
        ) : (
          <button
            onClick={onRun}
            disabled={!selectedFlow || !nodes.length || !!validationError}
            className="h-8 px-4 flex items-center gap-1.5 bg-clay hover:bg-clay-dark rounded-md text-xs font-medium text-white transition-colors disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" /> Run
          </button>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Canvas — read-only: no dragging, connecting, or deleting */}
        <div className="flex-1 min-w-0 min-h-0 relative" onContextMenu={(e) => e.preventDefault()}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={studioNodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            deleteKeyCode={null}
            panOnDrag={[1, 2]}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {!nodes.length && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-sm text-mute">This legacy flow has no blocks.</p>
            </div>
          )}
        </div>

        {/* Inspector (config view-only; run records stay interactive) */}
        {selectedNode && (
          <NodeInspector
            key={selectedNode.id}
            node={selectedNode}
            allNodes={nodes}
            edges={edges}
            collections={collections}
            records={selectedNodeRecords}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>

      {/* Modals */}
      {showNewFlowModal && (
        <Modal title="New flow" onClose={() => setShowNewFlowModal(false)}>
          <form onSubmit={onCreateFlow} className="flex flex-col gap-4">
            <input
              autoFocus
              value={flowNameDraft}
              onChange={(e) => setFlowNameDraft(e.target.value)}
              placeholder="Flow name"
              className="h-[38px] bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay"
            />
            <ModalFooter onCancel={() => setShowNewFlowModal(false)} submitLabel="Create" />
          </form>
        </Modal>
      )}
      {showRenameModal && (
        <Modal title="Rename flow" onClose={() => setShowRenameModal(false)}>
          <form onSubmit={onRenameFlow} className="flex flex-col gap-4">
            <input
              autoFocus
              value={flowNameDraft}
              onChange={(e) => setFlowNameDraft(e.target.value)}
              className="h-[38px] bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay"
            />
            <ModalFooter onCancel={() => setShowRenameModal(false)} submitLabel="Rename" />
          </form>
        </Modal>
      )}
    </div>
  );
}

// ---- inspector ----------------------------------------------------------------

function NodeInspector({
  node,
  allNodes,
  edges,
  collections,
  records,
  onClose,
}: {
  node: StudioNode;
  allNodes: StudioNode[];
  edges: Edge[];
  collections: Collection[];
  records: RunRecord[];
  onClose: () => void;
}) {
  // View-only: config inputs are rendered inside a disabled fieldset, so
  // change handlers can never fire.
  const onChange = (_patch: Partial<FlowNode>) => {};
  const fn = node.data.flowNode;
  const flowNodes = allNodes.map((n) => n.data.flowNode);
  const nameError = validateNodeName(fn.name, flowNodes, fn.id);
  const [detailRecord, setDetailRecord] = useState<RunRecord | null>(null);

  // Reference options: only edge-ancestors' published outputs.
  const referenceOptions = useMemo(() => {
    const ancestors = ancestorNodeIds(node.id, edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
    const options: string[] = [];
    for (const n of allNodes) {
      if (!ancestors.has(n.id)) continue;
      for (const out of publishedOutputs(n.data.flowNode, collections)) {
        options.push(`${n.data.flowNode.name}.${out}`);
      }
    }
    return options;
  }, [node.id, allNodes, edges, collections]);

  const updateConfig = (config: FlowNode["config"]) => onChange({ config });

  return (
    <div className="w-[380px] flex-shrink-0 bg-panel border-l border-line flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between flex-shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-stone">
          {fn.type} node · legacy
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-md border border-line flex items-center justify-center text-graphite hover:bg-hover transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* display: contents keeps the column layout while `disabled`
            freezes every config input, dropdown, and picker inside. */}
        <fieldset disabled className="contents">
        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-stone">Name (identifier — namespaces this node&apos;s outputs)</label>
          <input
            value={fn.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className={`${inputCls} ${nameError ? "!border-red-400" : ""}`}
          />
          {nameError && <span className="text-[11px] text-red-600">{nameError}</span>}
        </div>

        {fn.type === "delay" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone">Delay (ms)</label>
            <input
              type="number"
              min={0}
              value={(fn.config as DelayNodeConfig).ms}
              onChange={(e) => updateConfig({ ms: Math.max(0, parseInt(e.target.value, 10) || 0) })}
              className={inputCls}
            />
          </div>
        )}

        {fn.type === "request" && (
          <RequestConfigEditor
            cfg={fn.config as RequestNodeConfig}
            onChange={updateConfig}
            collections={collections}
            referenceOptions={referenceOptions}
            allowItem={false}
          />
        )}

        {fn.type === "looper" && (() => {
          const cfg = fn.config as LooperNodeConfig;
          return (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-stone">Items (array to iterate)</label>
                <Dropdown
                  value={cfg.itemsSource}
                  onChange={(v) => updateConfig({ ...cfg, itemsSource: v as "reference" | "static", itemsValue: v === "static" ? "[]" : "" })}
                  widthClass="w-full"
                  options={[
                    { value: "static", label: "Static JSON array" },
                    { value: "reference", label: "Reference an upstream output" },
                  ]}
                />
                {cfg.itemsSource === "reference" ? (
                  <ReferenceInput
                    value={cfg.itemsValue}
                    onChange={(v) => updateConfig({ ...cfg, itemsValue: v })}
                    options={referenceOptions}
                    placeholder="nodeName.output (must be an array)"
                  />
                ) : (
                  <div className="h-[140px] rounded-lg overflow-hidden border border-line">
                    <Editor
                      height="100%"
                      language="json"
                      theme="vs-dark"
                      value={cfg.itemsValue}
                      onChange={(val) => updateConfig({ ...cfg, itemsValue: val || "[]" })}
                      options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, lineNumbers: "off", scrollbar: { vertical: "auto", horizontal: "hidden" } }}
                    />
                  </div>
                )}
                <span className="text-[11px] text-mute">
                  The inner request runs once per item; reference the current item as{" "}
                  <code className="font-mono">item</code> or <code className="font-mono">item.field</code>.
                </span>
              </div>
              <RequestConfigEditor
                cfg={cfg.request}
                onChange={(request) => updateConfig({ ...cfg, request: request as RequestNodeConfig })}
                collections={collections}
                referenceOptions={referenceOptions}
                allowItem
              />
            </>
          );
        })()}

        {fn.type === "verifier" && (() => {
          const cfg = fn.config as VerifierNodeConfig;
          return (
            <>
              <RequestConfigEditor
                cfg={cfg.request}
                onChange={(request) => updateConfig({ ...cfg, request: request as RequestNodeConfig })}
                collections={collections}
                referenceOptions={referenceOptions}
                allowItem={false}
              />
              <ComparisonEditor
                comparisons={cfg.comparisons}
                onChange={(comparisons) => updateConfig({ ...cfg, comparisons })}
                referenceOptions={referenceOptions}
              />
              <div className="flex gap-2">
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-xs font-medium text-stone">Max attempts</label>
                  <input
                    type="number"
                    min={1}
                    value={cfg.maxAttempts}
                    onChange={(e) => updateConfig({ ...cfg, maxAttempts: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className={inputCls}
                  />
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-xs font-medium text-stone">Retry interval (ms)</label>
                  <input
                    type="number"
                    min={0}
                    value={cfg.intervalMs}
                    onChange={(e) => updateConfig({ ...cfg, intervalMs: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className={inputCls}
                  />
                </div>
              </div>
            </>
          );
        })()}
        </fieldset>

        {/* Last run records for this node */}
        {records.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-3 border-t border-line">
            <label className="text-xs font-medium text-stone">Last run</label>
            {records.map((r, i) => (
              <div key={i} className={`px-3 py-2 rounded-lg border text-[11px] ${r.status === "success" ? "bg-cream border-line" : r.status === "failed" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">
                    {r.status}
                    {r.iteration !== undefined ? ` · iteration ${r.iteration}` : ""}
                    {r.attempt !== undefined ? ` · attempt ${r.attempt}` : ""}
                  </span>
                  <span className="ml-auto text-mute">{r.durationMs} ms</span>
                  {(r.requestPayload || r.response) && (
                    <button
                      onClick={() => setDetailRecord(r)}
                      title="View the exact request and response"
                      className="font-medium text-clay hover:text-clay-dark transition-colors"
                    >
                      Details
                    </button>
                  )}
                </div>
                {r.error && <p className="m-0 mt-1 text-red-700 break-words">{r.error}</p>}
                {r.outputs && Object.keys(r.outputs).length > 0 && (
                  <pre className="m-0 mt-1 font-mono text-[10px] text-graphite whitespace-pre-wrap break-all">
                    {JSON.stringify(r.outputs, null, 1)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {detailRecord && (
        <RunRecordDetailModal record={detailRecord} onClose={() => setDetailRecord(null)} />
      )}
    </div>
  );
}

// ---- run record detail modal -------------------------------------------------

const prettyJson = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const preCls =
  "m-0 p-3 rounded-lg bg-ink-900 text-[#e8e6e1] font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all overflow-y-auto max-h-[280px]";

function RunRecordDetailModal({ record, onClose }: { record: RunRecord; onClose: () => void }) {
  const req = record.requestPayload;
  const res = record.response;
  const meta = [
    record.nodeName,
    record.iteration !== undefined ? `iteration ${record.iteration}` : null,
    record.attempt !== undefined ? `attempt ${record.attempt}` : null,
    record.status,
    `${record.durationMs} ms`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Modal title="Request & response" onClose={onClose} width={720}>
      <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto -mr-3 pr-3">
        <span className="text-xs text-stone">{meta}</span>

        {record.error && (
          <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700 break-words">
            {record.error}
          </div>
        )}

        {Object.keys(record.resolvedInputs || {}).length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone">Resolved inputs</label>
            <pre className={preCls}>{prettyJson(record.resolvedInputs)}</pre>
          </div>
        )}

        {req ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone">Request (exact executor payload)</label>
            <span className="font-mono text-[11px] text-graphite break-all">
              {req.method} {req.url}
            </span>
            <pre className={preCls}>{prettyJson(req)}</pre>
          </div>
        ) : (
          <span className="text-[11px] text-mute">No request was sent — the node failed before executing.</span>
        )}

        {res && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone">
              Response — {res.status} {res.statusText || ""}
            </label>
            {Object.keys(res.headers || {}).length > 0 && (
              <details>
                <summary className="text-[11px] text-mute cursor-pointer select-none">Headers</summary>
                <pre className={`${preCls} mt-1.5`}>{prettyJson(res.headers)}</pre>
              </details>
            )}
            <pre className={preCls}>{prettyJson(res.body)}</pre>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---- config sub-editors ----------------------------------------------------

// Text input with a styled suggestion popup. Replaces the native <datalist>,
// whose popup the Tauri webview renders with unreadable (white-on-white) text.
function ReferenceInput({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [value, options]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setCoords({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (inputRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const commit = (opt: string) => {
    onChange(opt);
    setOpen(false);
    setActiveIdx(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" && filtered.length) {
        e.preventDefault();
        setOpen(true);
        setActiveIdx(0);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        if (activeIdx >= 0 && filtered[activeIdx]) {
          e.preventDefault();
          commit(filtered[activeIdx]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIdx(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder || "nodeName.output"}
        className={`${inputCls} w-full`}
      />
      {open && coords && filtered.length > 0 &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, minWidth: coords.width }}
            className="z-[100] max-h-56 overflow-y-auto rounded-lg border border-line bg-cream py-1 shadow-lg shadow-ink/5 animate-[fadeUp_0.12s_ease-out]"
          >
            {filtered.map((opt, idx) => (
              <div
                key={opt}
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(opt)}
                className={`mx-1 px-2.5 py-1.5 rounded-md font-mono text-[11px] cursor-pointer transition-colors ${
                  idx === activeIdx ? "bg-hover" : ""
                } ${opt === value ? "text-clay font-medium" : "text-ink"}`}
              >
                {opt}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

function RequestConfigEditor({
  cfg,
  onChange,
  collections,
  referenceOptions,
  allowItem,
}: {
  cfg: RequestNodeConfig;
  onChange: (cfg: RequestNodeConfig) => void;
  collections: Collection[];
  referenceOptions: string[];
  allowItem: boolean;
}) {
  const inputNames = useMemo(
    () => (cfg.requestId ? requestInputNames(collections, cfg.requestId) : []),
    [collections, cfg.requestId]
  );
  const refOptions = allowItem ? ["item", ...referenceOptions] : referenceOptions;

  const setMapping = (inputName: string, patch: Partial<FlowInputMapping>) => {
    const mappings = [...(cfg.mappings || [])];
    const idx = mappings.findIndex((m) => m.inputName === inputName);
    if (idx === -1) {
      mappings.push({ inputName, source: "static", value: "", ...patch });
    } else {
      mappings[idx] = { ...mappings[idx], ...patch };
    }
    onChange({ ...cfg, mappings });
  };

  const clearMapping = (inputName: string) => {
    onChange({ ...cfg, mappings: (cfg.mappings || []).filter((m) => m.inputName !== inputName) });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-stone">Request</label>
        <RequestPicker
          value={cfg.requestId}
          onChange={(v) => onChange({ ...cfg, requestId: v, mappings: [] })}
          collections={collections}
          placeholder="Select a request…"
        />
      </div>

      {cfg.requestId && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-stone">Input mappings</label>
          {inputNames.length === 0 && (
            <span className="text-[11px] text-mute">This request declares no {"{{inputs}}"}.</span>
          )}
          {inputNames.map((inputName) => {
            const mapping = (cfg.mappings || []).find((m) => m.inputName === inputName);
            return (
              <div key={inputName} className="flex flex-col gap-1 p-2 bg-cream border border-line rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-medium text-clay flex-1 truncate" title={`{{${inputName}}}`}>
                    {inputName}
                  </span>
                  <Dropdown
                    value={mapping ? mapping.source : "default"}
                    onChange={(v) => {
                      if (v === "default") clearMapping(inputName);
                      else setMapping(inputName, { source: v as "static" | "reference", value: "" });
                    }}
                    widthClass="w-[130px]"
                    className="h-[26px] px-2 rounded-md text-[11px] text-ink"
                    options={[
                      { value: "default", label: "Request default" },
                      { value: "static", label: "Static" },
                      { value: "reference", label: "Reference" },
                    ]}
                  />
                </div>
                {mapping?.source === "static" && (
                  <input
                    value={mapping.value}
                    onChange={(e) => setMapping(inputName, { value: e.target.value })}
                    placeholder="Value ({{node.out}}, {{env.X}}, {{$date}} allowed)"
                    className={`${inputCls} w-full`}
                  />
                )}
                {mapping?.source === "reference" && (
                  <ReferenceInput
                    value={mapping.value}
                    onChange={(v) => setMapping(inputName, { value: v })}
                    options={refOptions}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const OPERATOR_OPTIONS: { value: ComparisonOperator; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "exists", label: "exists" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
];

function ComparisonEditor({
  comparisons,
  onChange,
  referenceOptions,
}: {
  comparisons: VerifierComparison[];
  onChange: (comparisons: VerifierComparison[]) => void;
  referenceOptions: string[];
}) {
  const update = (idx: number, patch: Partial<VerifierComparison>) => {
    const next = [...comparisons];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-stone">Verifications (all must pass)</label>
      {comparisons.length === 0 && (
        <span className="text-[11px] text-amber-700">Add at least one verification — a verifier with none always fails.</span>
      )}
      {comparisons.map((c, idx) => (
        <div key={idx} className="flex flex-col gap-1 p-2 bg-cream border border-line rounded-lg">
          <div className="flex items-center gap-1.5">
            <input
              value={c.field}
              onChange={(e) => update(idx, { field: e.target.value })}
              placeholder="status | body.path | outputs.name"
              className={`${inputCls} flex-1 min-w-0`}
            />
            <button
              onClick={() => onChange(comparisons.filter((_, i) => i !== idx))}
              className="h-7 w-7 rounded-md border border-line flex items-center justify-center text-stone hover:bg-danger-soft hover:text-danger transition-colors flex-shrink-0"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Dropdown
              value={c.operator}
              onChange={(v) => update(idx, { operator: v as ComparisonOperator })}
              widthClass="w-[120px]"
              className="h-[26px] px-2 rounded-md text-[11px] text-ink"
              options={OPERATOR_OPTIONS}
            />
            {c.operator !== "exists" && (
              <>
                <Dropdown
                  value={c.expectedSource}
                  onChange={(v) => update(idx, { expectedSource: v as "static" | "reference", expected: "" })}
                  widthClass="w-[100px]"
                  className="h-[26px] px-2 rounded-md text-[11px] text-ink"
                  options={[
                    { value: "static", label: "Static" },
                    { value: "reference", label: "Reference" },
                  ]}
                />
                {c.expectedSource === "reference" ? (
                  <div className="flex-1 min-w-0">
                    <ReferenceInput value={c.expected} onChange={(v) => update(idx, { expected: v })} options={referenceOptions} />
                  </div>
                ) : (
                  <input
                    value={c.expected}
                    onChange={(e) => update(idx, { expected: e.target.value })}
                    placeholder="Expected"
                    className={`${inputCls} flex-1 min-w-0`}
                  />
                )}
              </>
            )}
          </div>
        </div>
      ))}
      <button
        onClick={() => onChange([...comparisons, { field: "", operator: "equals", expectedSource: "static", expected: "" }])}
        className="flex items-center gap-1.5 px-3 py-1.5 w-fit border border-dashed border-line rounded-md text-xs text-mute hover:border-clay hover:text-clay transition-colors"
      >
        <Plus className="h-3.5 w-3.5" /> Add verification
      </button>
    </div>
  );
}
