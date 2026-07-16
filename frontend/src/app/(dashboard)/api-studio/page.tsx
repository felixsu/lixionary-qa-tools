"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Plus, Play, Square, Save, Download, Trash2, Pencil, Send, Repeat2, Timer,
  ShieldCheck, CheckCircle2, AlertCircle, X,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { useAppContext, findRequestInTree } from "../../context/AppContext";
import type { Collection } from "../../context/AppContext";
import Dropdown from "../../components/Dropdown";
import { Modal, ModalFooter } from "../../components/Modal";
import { confirmDialog } from "../../utils/confirmDialog";
import { scanInputNames, scanEnvNames } from "../../utils/requestTokens";
import {
  type Flow, type FlowNode, type FlowEdge, type FlowNodeType,
  type RequestNodeConfig, type LooperNodeConfig, type DelayNodeConfig, type VerifierNodeConfig,
  type FlowInputMapping, type VerifierComparison, type ComparisonOperator,
  validateNodeName, autoNodeName, defaultConfigForType,
} from "../../utils/flowTypes";
import {
  runFlow, topoSort, publishedOutputs, ancestorNodeIds, lookupRequest,
  type NodeRunStatus, type RunRecord, type FlowRunSummary, type RunHandle,
} from "../../utils/flowRunner";
import { buildRunCsv, downloadCsv, runCsvFilename, persistLastRun, loadLastRun } from "../../utils/flowReport";
import { studioNodeTypes, type StudioNode, type StudioNodeData } from "./components/nodes";

const PALETTE: { type: FlowNodeType; label: string; icon: typeof Send; hint: string }[] = [
  { type: "request", label: "Request", icon: Send, hint: "Run a saved API Explorer request" },
  { type: "looper", label: "Looper", icon: Repeat2, hint: "Repeat a request per array item" },
  { type: "delay", label: "Delay", icon: Timer, hint: "Wait a fixed number of ms" },
  { type: "verifier", label: "Verifier", icon: ShieldCheck, hint: "Assert on a response, retry n times" },
];

const inputCls =
  "h-[30px] bg-cream border border-line rounded-md px-2.5 font-mono text-xs text-graphite outline-none focus:border-clay";

// ---- helpers ----------------------------------------------------------------

interface RequestOption {
  value: string;
  label: string;
}

const collectRequestOptions = (collections: Collection[]): RequestOption[] => {
  const options: RequestOption[] = [];
  const walk = (col: Collection, prefix: string) => {
    const path = prefix ? `${prefix} / ${col.name}` : col.name;
    for (const req of col.requests || []) {
      options.push({ value: req.id, label: `${path} / ${req.method} ${req.name}` });
    }
    for (const child of col.children || []) walk(child, path);
  };
  for (const col of collections) walk(col, "");
  return options;
};

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

const flowSignature = (nodes: FlowNode[], edges: FlowEdge[]) =>
  JSON.stringify({ nodes: nodes.map((n) => ({ ...n, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } })), edges });

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

// ---- page -------------------------------------------------------------------

export default function ApiStudioPage() {
  return (
    <ReactFlowProvider>
      <StudioEditor />
    </ReactFlowProvider>
  );
}

function StudioEditor() {
  const {
    flows, createFlow, updateFlow, deleteFlow,
    collections,
    apiCall, selectedEnvCloudId, resolveAuthFunctionCloudId,
    environments, selectedEnvId,
  } = useAppContext();

  const [selectedFlowId, setSelectedFlowId] = useState<string>("");
  const [nodes, setNodes, onNodesChange] = useNodesState<StudioNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [savedSignature, setSavedSignature] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [lastSummary, setLastSummary] = useState<FlowRunSummary | null>(null);
  const runHandleRef = useRef<RunHandle | null>(null);

  const [showNewFlowModal, setShowNewFlowModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [flowNameDraft, setFlowNameDraft] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const { screenToFlowPosition } = useReactFlow();

  const selectedFlow = flows.find((f) => f.id === selectedFlowId) || null;
  const requestOptions = useMemo(() => collectRequestOptions(collections), [collections]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const dirty = useMemo(() => {
    if (!selectedFlow) return false;
    return flowSignature(serializeNodes(nodes), serializeEdges(edges)) !== savedSignature;
  }, [nodes, edges, savedSignature, selectedFlow]);

  // Load a flow into the canvas (statuses from its stored last run, dimmed as "idle").
  const loadFlow = useCallback((flow: Flow) => {
    const lastRun = loadLastRun(flow.id);
    const statusByNode = new Map<string, NodeRunStatus>();
    if (lastRun) {
      for (const r of lastRun.records) statusByNode.set(r.nodeId, r.status);
    }
    setNodes(flow.nodes.map((fn) => toStudioNode(fn, statusByNode.get(fn.id) || "idle", collections)));
    setEdges(flow.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
    setSavedSignature(flowSignature(flow.nodes, flow.edges));
    setSelectedNodeId(null);
    setRecords(lastRun?.records || []);
    setLastSummary(lastRun);
  }, [collections, setNodes, setEdges]);

  // Initial selection + reload when the selected flow record changes (sync pull).
  useEffect(() => {
    if (!flows.length) {
      setSelectedFlowId("");
      setNodes([]);
      setEdges([]);
      return;
    }
    if (!selectedFlowId || !flows.some((f) => f.id === selectedFlowId)) {
      setSelectedFlowId(flows[0].id);
      loadFlow(flows[0]);
    }
  }, [flows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh request labels when collections change (e.g. a request was renamed).
  useEffect(() => {
    setNodes((prev) => prev.map((n) => ({ ...n, data: decorate(n.data.flowNode, n.data.status, collections) })));
  }, [collections, setNodes]);

  const switchFlow = async (flowId: string) => {
    if (flowId === selectedFlowId) return;
    if (dirty) {
      const ok = await confirmDialog("You have unsaved changes on this flow. Discard them?");
      if (!ok) return;
    }
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) return;
    setSelectedFlowId(flowId);
    loadFlow(flow);
  };

  // ---- node/edge editing ----

  const updateFlowNode = useCallback((nodeId: string, patch: Partial<FlowNode>) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;
        const updated = { ...n.data.flowNode, ...patch };
        return { ...n, data: decorate(updated, n.data.status, collections) };
      })
    );
  }, [collections, setNodes]);

  const setNodeStatus = useCallback((nodeId: string, status: NodeRunStatus) => {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n)));
  }, [setNodes]);

  const resetStatuses = useCallback(() => {
    setNodes((prev) => prev.map((n) => ({ ...n, data: { ...n.data, status: "idle" as NodeRunStatus } })));
  }, [setNodes]);

  const addNode = (type: FlowNodeType, position: { x: number; y: number }) => {
    const existing = serializeNodes(nodes);
    const fn: FlowNode = {
      id: crypto.randomUUID(),
      name: autoNodeName(type, existing),
      type,
      position,
      config: defaultConfigForType(type),
    };
    setNodes((prev) => [...prev, toStudioNode(fn, "idle", collections)]);
    setSelectedNodeId(fn.id);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-studio-node") as FlowNodeType;
    if (!type) return;
    addNode(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  // Reject self-edges, duplicates, and cycles.
  const isValidConnection = useCallback((conn: Connection | Edge) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return false;
    if (edges.some((e) => e.source === conn.source && e.target === conn.target)) return false;
    // Would adding source->target create a cycle? Only if source is reachable from target.
    const reachable = ancestorNodeIds(conn.source, serializeEdges(edges));
    return !reachable.has(conn.target);
  }, [edges]);

  const onConnect = useCallback((conn: Connection) => {
    setEdges((prev) => addEdge({ ...conn, id: crypto.randomUUID() }, prev));
  }, [setEdges]);

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

  // ---- toolbar actions ----

  const onSave = async () => {
    if (!selectedFlow) return;
    setIsSaving(true);
    try {
      const flowNodes = serializeNodes(nodes);
      const flowEdges = serializeEdges(edges);
      await updateFlow(selectedFlow.id, { nodes: flowNodes, edges: flowEdges });
      setSavedSignature(flowSignature(flowNodes, flowEdges));
      showToast(validationError ? `Saved (warning: ${validationError})` : "Flow saved");
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const onRun = async () => {
    if (!selectedFlow || isRunning) return;
    if (validationError) {
      alert(`Cannot run: ${validationError}`);
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
      { apiCall, collections, environmentId: selectedEnvCloudId, resolveAuthFunctionCloudId },
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
      showToast(
        summary.status === "success"
          ? `Run finished — ${summary.records.length} steps in ${summary.durationMs} ms`
          : summary.status === "cancelled"
            ? "Run cancelled"
            : "Run failed — see node statuses"
      );
    } catch (e: any) {
      alert(`Run error: ${e.message}`);
    } finally {
      setIsRunning(false);
      runHandleRef.current = null;
    }
  };

  const onStop = () => runHandleRef.current?.cancel();

  const onDownloadReport = () => {
    if (!records.length || !selectedFlow) return;
    downloadCsv(buildRunCsv(records), runCsvFilename(selectedFlow.name));
  };

  const onCreateFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flowNameDraft.trim()) return;
    try {
      const flow = await createFlow(flowNameDraft.trim());
      setShowNewFlowModal(false);
      setFlowNameDraft("");
      setSelectedFlowId(flow.id);
      loadFlow(flow);
      showToast("Flow created");
    } catch (err: any) {
      alert(err.message);
    }
  };

  const onRenameFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFlow || !flowNameDraft.trim()) return;
    try {
      await updateFlow(selectedFlow.id, { name: flowNameDraft.trim() });
      setShowRenameModal(false);
      showToast("Flow renamed");
    } catch (err: any) {
      alert(err.message);
    }
  };

  const onDeleteFlow = async () => {
    if (!selectedFlow) return;
    const ok = await confirmDialog(`Delete flow "${selectedFlow.name}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await deleteFlow(selectedFlow.id);
      setSelectedFlowId("");
      showToast("Flow deleted");
    } catch (err: any) {
      alert(err.message);
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
          onChange={switchFlow}
          placeholder={flows.length ? "Select flow…" : "No flows yet"}
          widthClass="w-[240px]"
          options={flows.map((f) => ({ value: f.id, label: f.name }))}
        />
        {dirty && <span className="h-2 w-2 rounded-full bg-clay flex-shrink-0" title="Unsaved changes" />}
        <button
          onClick={() => { setFlowNameDraft(""); setShowNewFlowModal(true); }}
          className="h-8 px-2.5 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
        {selectedFlow && (
          <>
            <button
              onClick={() => { setFlowNameDraft(selectedFlow.name); setShowRenameModal(true); }}
              title="Rename flow"
              className="h-8 w-8 flex items-center justify-center bg-cream border border-line rounded-md text-graphite hover:bg-panel transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDeleteFlow}
              title="Delete flow"
              className="h-8 w-8 flex items-center justify-center bg-cream border border-line rounded-md text-stone hover:bg-danger-soft hover:text-danger transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        <div className="flex-1" />

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
        <button
          onClick={onSave}
          disabled={!selectedFlow || !dirty || isSaving}
          className="h-8 px-3 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" /> {isSaving ? "Saving…" : "Save"}
        </button>
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
        {/* Palette */}
        <div className="w-[220px] flex-shrink-0 bg-panel border-r border-line p-3 flex flex-col gap-2 overflow-y-auto">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-stone px-1">Building blocks</span>
          {PALETTE.map((item) => (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-studio-node", item.type);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDoubleClick={() => addNode(item.type, { x: 120 + Math.random() * 120, y: 120 + Math.random() * 120 })}
              className="p-3 bg-cream border border-line rounded-lg cursor-grab hover:border-clay transition-colors"
              title="Drag onto the canvas (or double-click)"
            >
              <div className="flex items-center gap-2">
                <item.icon className="h-4 w-4 text-clay" />
                <span className="text-xs font-medium text-ink">{item.label}</span>
              </div>
              <p className="m-0 mt-1 text-[11px] text-mute leading-snug">{item.hint}</p>
            </div>
          ))}
          <p className="text-[11px] text-mute px-1 mt-2 leading-relaxed">
            Connect nodes to define execution order. A node can reference any upstream node&apos;s outputs as{" "}
            <code className="font-mono">nodeName.output</code>. Use a <code className="font-mono">*</code> segment
            to flatten arrays, e.g. <code className="font-mono">loop.results.*.uuid</code>.
          </p>
        </div>

        {/* Canvas */}
        {selectedFlow ? (
          <div className="flex-1 min-w-0 min-h-0 relative" onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={studioNodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              deleteKeyCode={["Backspace", "Delete"]}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
            {!nodes.length && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-sm text-mute">Drag a building block from the left to start this flow.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-mute">
            {flows.length ? "Select a flow to edit." : "Create your first flow with the New button."}
          </div>
        )}

        {/* Inspector */}
        {selectedFlow && selectedNode && (
          <NodeInspector
            key={selectedNode.id}
            node={selectedNode}
            allNodes={nodes}
            edges={edges}
            collections={collections}
            requestOptions={requestOptions}
            records={selectedNodeRecords}
            onChange={(patch) => updateFlowNode(selectedNode.id, patch)}
            onClose={() => setSelectedNodeId(null)}
            onDelete={() => {
              setNodes((prev) => prev.filter((n) => n.id !== selectedNode.id));
              setEdges((prev) => prev.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
              setSelectedNodeId(null);
            }}
          />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 bg-ink-900 text-cream px-4 py-3 rounded-lg border-l-4 border-sage text-[13px] shadow-[0_4px_16px_rgba(20,20,19,0.24)] max-w-[360px]"
          style={{ animation: "fadeUp 0.2s ease-out" }}
        >
          <CheckCircle2 className="h-4 w-4 text-sage flex-shrink-0" />
          <span>{toast}</span>
        </div>
      )}

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
  requestOptions,
  records,
  onChange,
  onClose,
  onDelete,
}: {
  node: StudioNode;
  allNodes: StudioNode[];
  edges: Edge[];
  collections: Collection[];
  requestOptions: RequestOption[];
  records: RunRecord[];
  onChange: (patch: Partial<FlowNode>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const fn = node.data.flowNode;
  const flowNodes = allNodes.map((n) => n.data.flowNode);
  const nameError = validateNodeName(fn.name, flowNodes, fn.id);

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
          {fn.type} node
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onDelete}
            title="Delete node"
            className="h-7 w-7 rounded-md border border-line flex items-center justify-center text-stone hover:bg-danger-soft hover:text-danger transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-md border border-line flex items-center justify-center text-graphite hover:bg-hover transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
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
            requestOptions={requestOptions}
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
                      options={{ minimap: { enabled: false }, fontSize: 12, lineNumbers: "off", scrollbar: { vertical: "auto", horizontal: "hidden" } }}
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
                requestOptions={requestOptions}
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
                requestOptions={requestOptions}
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
    </div>
  );
}

// ---- config sub-editors ----------------------------------------------------

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
  const listId = React.useId();
  return (
    <>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={listId}
        placeholder={placeholder || "nodeName.output"}
        className={`${inputCls} w-full`}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

function RequestConfigEditor({
  cfg,
  onChange,
  collections,
  requestOptions,
  referenceOptions,
  allowItem,
}: {
  cfg: RequestNodeConfig;
  onChange: (cfg: RequestNodeConfig) => void;
  collections: Collection[];
  requestOptions: RequestOption[];
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
        <Dropdown
          value={cfg.requestId}
          onChange={(v) => onChange({ ...cfg, requestId: v, mappings: [] })}
          placeholder="Select a request…"
          widthClass="w-full"
          options={requestOptions}
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
