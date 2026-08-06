"use client";

// V2 API Studio editor: a streaming dataflow canvas. Connections carry ordered
// item streams (not single values), so a loop is just composition —
// ArrayEmit → Request → Accumulator. Data connections are one-to-one; fan-out
// is explicit via a Duplicator. Engine: utils/flowRunnerV2.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertCircle, Combine, Copy, Download, Layers, Pencil, Play, Plus, Repeat2, Rows3, Save, Send,
  ShieldCheck, Sparkles, Split, Square, Timer, Trash2, Wand2, X,
} from "lucide-react";
import { GeneratorBindingButton } from "../../../components/GeneratorMenu";
import { isKnownGeneratorToken } from "../../../utils/generatorsV2";
import Editor from "@monaco-editor/react";
import { useAppContext, type Collection } from "../../../context/AppContext";
import { useFlowRuns } from "../../../context/FlowRunsContext";
import { useToast } from "../../../context/ToastContext";
import Dropdown from "../../../components/Dropdown";
import { Modal, ModalFooter } from "../../../components/Modal";
import { confirmDialog } from "../../../utils/confirmDialog";
import { generateDuplicateName } from "../../../utils/uniqueName";
import { scanEnvNames } from "../../../utils/requestTokens";
import { autoNodeName, type ComparisonOperator, type Flow, type FlowNode } from "../../../utils/flowTypes";
import {
  lookupRequest,
  type FlowRunSummary,
  type NodeRunStatus,
  type RunHandle,
  type RunRecord,
} from "../../../utils/flowRunner";
import { runFlowV2 } from "../../../utils/flowRunnerV2";
import {
  defaultConfigForTypeV2,
  defaultVerifyConfig,
  EMIT_MAX_ITEMS,
  flowErrorsV2,
  migrateFlowV2,
  parseHandle,
  portById,
  portLabel,
  validateFlowV2,
  type ArrayEmitNodeConfigV2,
  type DelayNodeConfigV2,
  type GeneratorNodeConfigV2,
  type MapperNodeConfigV2,
  type FlowEdgeV2,
  type FlowNodeTypeV2,
  type FlowNodeV2,
  type FlowV2,
  type MuxNodeConfigV2,
  type RequestNodeConfigV2,
  type RequestVerifyConfigV2,
  type StaticInputV2,
  type VerifyCheckV2,
} from "../../../utils/flowTypesV2";
import { buildRunCsv, downloadCsv, loadLastRun, persistLastRun, runCsvFilename } from "../../../utils/flowReport";
import RequestPicker from "../RequestPicker";
import { connectionRejection, isValidConnectionV2 } from "./connectionRules";
import { NodeActionsContext, studioNodeTypesV2, type NodeActions } from "./nodes";
import {
  decorateV2,
  flowSignatureV2,
  serializeEdgesV2,
  serializeNodesV2,
  toRfEdgeV2,
  toStudioNodeV2,
  toStudioNodesV2,
  type StudioNodeV2,
} from "./serialize";

const PALETTE: { type: FlowNodeTypeV2; label: string; icon: typeof Send; hint: string }[] = [
  { type: "request", label: "Request", icon: Send, hint: "Run a saved API request — wire a stream to `each` to repeat it; optionally verify and retry" },
  { type: "arrayEmit", label: "Array Emit", icon: Rows3, hint: "Turn an array — or a repeat count — into a stream, one item at a time" },
  { type: "accumulator", label: "Accumulator", icon: Layers, hint: "Collect a whole stream back into one array" },
  { type: "mapper", label: "Mapper", icon: Split, hint: "Split an object into separate outputs by JSONPath" },
  { type: "mux", label: "Mux", icon: Combine, hint: "Combine several inputs into one object" },
  { type: "generator", label: "Generator", icon: Wand2, hint: "Emit a generated value — date, random number, name, email or location" },
  { type: "delay", label: "Delay", icon: Timer, hint: "Wait a fixed number of ms — pace a stream or just pause" },
];

const inputCls =
  "h-[30px] bg-cream border border-line rounded-md px-2.5 font-mono text-xs text-graphite outline-none focus:border-clay";

interface EditorV2Props {
  selectedFlow: FlowV2 | null;
  onSelectFlow: (flowId: string) => void; // "" = let the page pick a default
}

export default function EditorV2(props: EditorV2Props) {
  return (
    <ReactFlowProvider>
      <StudioEditorV2 {...props} />
    </ReactFlowProvider>
  );
}

function StudioEditorV2({ selectedFlow, onSelectFlow }: EditorV2Props) {
  const { flows, createFlow, updateFlow, deleteFlow, collections, apiCall, environments, selectedEnvId } =
    useAppContext();
  const { activeRuns, registerRun } = useFlowRuns();
  const { showToast } = useToast();
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<StudioNodeV2>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [savedSignature, setSavedSignature] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [lastSummary, setLastSummary] = useState<FlowRunSummary | null>(null);
  const runHandleRef = useRef<RunHandle | null>(null);
  const clipboardRef = useRef<{ nodes: FlowNodeV2[]; edges: FlowEdgeV2[] } | null>(null);
  const pasteCountRef = useRef(0);
  const undoStackRef = useRef<{ nodes: FlowNodeV2[]; edges: FlowEdgeV2[] }[]>([]);
  const onSaveRef = useRef<() => void>(() => {});

  const [showNewFlowModal, setShowNewFlowModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [flowNameDraft, setFlowNameDraft] = useState("");

  const agentRuns = activeRuns.filter((r) => r.source === "mcp");

  // ---- load -----------------------------------------------------------------

  const loadFlow = useCallback(
    (flow: FlowV2) => {
      const lastRun = loadLastRun(flow.id);
      const statusByNode = new Map<string, NodeRunStatus>();
      for (const [nodeId, status] of Object.entries(lastRun?.nodeStatuses || {})) {
        statusByNode.set(nodeId, status as NodeRunStatus);
      }
      // Older shapes are rewritten on the way in: a Duplicator becomes direct
      // fan-out from whatever fed it. Left dirty so the cleanup is saved
      // deliberately; reloading before saving simply rewrites it again.
      const migrated = migrateFlowV2(flow.nodes || [], flow.edges || []);
      if (migrated.changed) {
        showToast(
          `Replaced ${migrated.changed} Duplicator block${migrated.changed === 1 ? "" : "s"} with direct connections — save to keep this`,
          { type: "info" }
        );
      }
      setNodes(toStudioNodesV2(migrated.nodes, (id) => statusByNode.get(id) || "idle", collections));
      setEdges(migrated.edges.map(toRfEdgeV2));
      setSavedSignature(flowSignatureV2(flow.nodes || [], flow.edges || []));
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      undoStackRef.current = [];
      setRecords(lastRun?.records || []);
      setLastSummary(lastRun);
    },
    [collections, setNodes, setEdges, showToast]
  );

  useEffect(() => {
    if (selectedFlow) loadFlow(selectedFlow);
    else {
      setNodes([]);
      setEdges([]);
    }
  }, [selectedFlow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-derive ports/labels when collections change (request edited/renamed).
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => ({ ...n, data: { ...decorateV2(n.data.flowNode, n.data.status, collections), streamBadge: n.data.streamBadge } }))
    );
  }, [collections, setNodes]);

  const dirty = useMemo(() => {
    if (!selectedFlow) return false;
    return flowSignatureV2(serializeNodesV2(nodes), serializeEdgesV2(edges)) !== savedSignature;
  }, [nodes, edges, savedSignature, selectedFlow]);

  // ---- node editing ---------------------------------------------------------

  const updateFlowNodeV2 = useCallback(
    (nodeId: string, patch: Partial<FlowNodeV2>) => {
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n;
          const updated = { ...n.data.flowNode, ...patch };
          return { ...n, data: { ...decorateV2(updated, n.data.status, collections), streamBadge: n.data.streamBadge } };
        })
      );
    },
    [collections, setNodes]
  );

  const nodeActions = useMemo<NodeActions>(
    () => ({
      setStaticInput: (nodeId, inputName, patch) => {
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== nodeId) return n;
            const cfg = n.data.flowNode.config as { staticInputs?: Record<string, StaticInputV2> };
            const current = cfg.staticInputs?.[inputName] || { type: "string" as const, value: "" };
            const updated = {
              ...n.data.flowNode,
              config: { ...cfg, staticInputs: { ...cfg.staticInputs, [inputName]: { ...current, ...patch } } },
            } as FlowNodeV2;
            return { ...n, data: { ...n.data, flowNode: updated } };
          })
        );
      },
    }),
    [setNodes]
  );

  const setNodeStatus = useCallback(
    (nodeId: string, status: NodeRunStatus) => {
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n)));
    },
    [setNodes]
  );

  const resetStatuses = useCallback(() => {
    setNodes((prev) =>
      prev.map((n) => ({ ...n, data: { ...n.data, status: "idle" as NodeRunStatus, streamBadge: null, failedItems: 0 } }))
    );
  }, [setNodes]);

  const addNode = (type: FlowNodeTypeV2, position: { x: number; y: number }) => {
    const existing = nodes.map((n) => n.data.flowNode);
    const fn: FlowNodeV2 = {
      id: crypto.randomUUID(),
      name: autoNodeName(type, existing),
      type,
      position,
      config: defaultConfigForTypeV2(type),
    };
    setNodes((prev) => [...prev, toStudioNodeV2(fn, "idle", collections)]);
    setSelectedNodeId(fn.id);
    setSelectedEdgeId(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-studio-node") as FlowNodeTypeV2;
    if (!type) return;
    addNode(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  // ---- connections ----------------------------------------------------------

  const isValidConnection = useCallback(
    (conn: Connection | Edge) => isValidConnectionV2(conn, nodes, edges),
    [nodes, edges]
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.sourceHandle || !conn.targetHandle) return;
      const flowEdge: FlowEdgeV2 = {
        id: crypto.randomUUID(),
        source: conn.source!,
        target: conn.target!,
        sourceHandle: conn.sourceHandle,
        targetHandle: conn.targetHandle,
      };
      setEdges((prev) => [...prev, toRfEdgeV2(flowEdge)]);
    },
    [setEdges]
  );

  // A rejected drop is silent in React Flow; the one-to-one rule is new enough
  // that it needs to teach its own workaround.
  const onConnectEnd = useCallback(
    (_: unknown, connectionState: ConnectionStateLike) => {
      if (connectionState?.isValid !== false) return;
      const conn = {
        source: connectionState.fromNode?.id,
        sourceHandle: connectionState.fromHandle?.id,
        target: connectionState.toNode?.id,
        targetHandle: connectionState.toHandle?.id,
      };
      if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) return;
      const reason = connectionRejection(conn as Connection, nodes, edges);
      if (reason === "input-taken")
        showToast("That input is already connected — an input takes exactly one connection", { type: "info" });
      else if (reason === "cycle") showToast("That connection would create a loop in the graph", { type: "info" });
    },
    [nodes, edges, showToast]
  );

  // ---- undo / clipboard / shortcuts -----------------------------------------

  const pushUndo = useCallback((deletedNodes: FlowNodeV2[], deletedEdges: FlowEdgeV2[]) => {
    if (!deletedNodes.length && !deletedEdges.length) return;
    undoStackRef.current.push({ nodes: deletedNodes, edges: deletedEdges });
    if (undoStackRef.current.length > 20) undoStackRef.current.shift();
  }, []);

  useEffect(() => {
    const isTypingTarget = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "v" && key !== "z" && key !== "s") return;

      if (key === "s") {
        e.preventDefault();
        if (showNewFlowModal || showRenameModal) return;
        if (selectedFlow && dirty && !isSaving) onSaveRef.current();
        return;
      }
      if (isTypingTarget(document.activeElement) || showNewFlowModal || showRenameModal) return;

      if (key === "z") {
        const entry = undoStackRef.current.pop();
        if (!entry) return;
        e.preventDefault();
        const existingNodeIds = new Set(nodes.map((n) => n.id));
        const restoredNodes = entry.nodes.filter((fn) => !existingNodeIds.has(fn.id));
        const allNodeIds = new Set([...existingNodeIds, ...restoredNodes.map((fn) => fn.id)]);
        const existingEdgeIds = new Set(edges.map((ed) => ed.id));
        const restoredEdges = entry.edges.filter(
          (ed) => !existingEdgeIds.has(ed.id) && allNodeIds.has(ed.source) && allNodeIds.has(ed.target)
        );
        if (!restoredNodes.length && !restoredEdges.length) return;
        if (restoredNodes.length)
          setNodes((prev) => [...prev, ...restoredNodes.map((fn) => toStudioNodeV2(fn, "idle", collections))]);
        if (restoredEdges.length) setEdges((prev) => [...prev, ...restoredEdges.map(toRfEdgeV2)]);
        showToast(
          restoredNodes.length
            ? `Restored ${restoredNodes.length} block${restoredNodes.length === 1 ? "" : "s"}`
            : "Restored connection",
          { type: "success" }
        );
        return;
      }

      if (key === "c") {
        const selected = nodes.filter((n) => n.selected);
        if (!selected.length) return;
        const ids = new Set(selected.map((n) => n.id));
        clipboardRef.current = {
          nodes: serializeNodesV2(selected),
          edges: serializeEdgesV2(edges.filter((ed) => ids.has(ed.source) && ids.has(ed.target))),
        };
        pasteCountRef.current = 0;
        showToast(`Copied ${selected.length} block${selected.length === 1 ? "" : "s"}`, { type: "success" });
        return;
      }

      const clip = clipboardRef.current;
      if (!clip?.nodes.length || !selectedFlow) return;
      e.preventDefault();
      pasteCountRef.current += 1;
      const offset = 40 * pasteCountRef.current;
      const taken = new Set(nodes.map((n) => n.data.flowNode.name));
      const idMap = new Map<string, string>();
      for (const fn of clip.nodes) idMap.set(fn.id, crypto.randomUUID());
      const pasted: FlowNodeV2[] = clip.nodes.map((fn) => {
        const copy: FlowNodeV2 = JSON.parse(JSON.stringify(fn));
        copy.id = idMap.get(fn.id)!;
        copy.name = dedupeName(fn.name, taken);
        taken.add(copy.name);
        copy.position = { x: fn.position.x + offset, y: fn.position.y + offset };
        return copy;
      });
      const pastedEdges: FlowEdgeV2[] = clip.edges.map((ed) => ({
        ...ed,
        id: crypto.randomUUID(),
        source: idMap.get(ed.source)!,
        target: idMap.get(ed.target)!,
      }));

      setNodes((prev) => [
        ...prev.map((n) => ({ ...n, selected: false })),
        ...pasted.map((fn) => ({ ...toStudioNodeV2(fn, "idle", collections), selected: true })),
      ]);
      setEdges((prev) => [
        ...prev.map((ed) => ({ ...ed, selected: false })),
        ...pastedEdges.map((ed) => ({ ...toRfEdgeV2(ed), selected: true })),
      ]);
      setSelectedNodeId(pasted.length === 1 ? pasted[0].id : null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nodes, edges, selectedFlow, showNewFlowModal, showRenameModal, collections, setNodes, setEdges, dirty, isSaving, showToast]);

  // ---- validation -----------------------------------------------------------

  const issues = useMemo(() => {
    if (!selectedFlow) return [];
    return validateFlowV2(
      { ...selectedFlow, nodes: serializeNodesV2(nodes), edges: serializeEdgesV2(edges) },
      collections
    );
  }, [selectedFlow, nodes, edges, collections]);

  const validationError = flowErrorsV2(issues)[0]?.message ?? null;
  const validationWarning = issues.find((i) => i.level === "warning")?.message ?? null;

  const envWarning = useMemo((): string | null => {
    const activeEnv = environments.find((e) => e.id === selectedEnvId);
    const defined = new Set((activeEnv?.variables || []).map((v) => v.key));
    const missing = new Set<string>();
    for (const n of nodes) {
      const cfg = n.data.flowNode.config as { requestId?: string };
      if (!cfg.requestId) continue;
      const request = lookupRequest(collections, cfg.requestId);
      if (!request) continue;
      for (const name of scanEnvNames({
        url: request.url,
        headers: request.headers || [],
        queryParams: request.queryParams || [],
        body: request.body || "",
        authType: request.authType,
        authConfig: request.authConfig || {},
      })) {
        if (!defined.has(name)) missing.add(name);
      }
    }
    if (!missing.size) return null;
    const list = Array.from(missing).join(", ");
    return activeEnv
      ? `Env vars not defined in "${activeEnv.name}": ${list}`
      : `No active environment — {{env.*}} vars unresolved: ${list}`;
  }, [nodes, collections, environments, selectedEnvId]);

  // ---- save / run -----------------------------------------------------------

  const onSave = async () => {
    if (!selectedFlow) return;
    setIsSaving(true);
    try {
      const taken = new Set<string>();
      setNodes((prev) =>
        prev.map((n) => {
          const name = n.data.flowNode.name;
          if (!taken.has(name)) {
            taken.add(name);
            return n;
          }
          const fixed = dedupeName(name, taken);
          taken.add(fixed);
          return { ...n, data: { ...n.data, flowNode: { ...n.data.flowNode, name: fixed } } };
        })
      );
      const flowNodes = serializeNodesV2(nodes);
      const flowEdges = serializeEdgesV2(edges);
      await updateFlow(selectedFlow.id, {
        nodes: flowNodes as unknown as FlowNode[],
        edges: flowEdges as unknown as Flow["edges"],
      });
      setSavedSignature(flowSignatureV2(flowNodes, flowEdges));
      showToast(validationError ? `Saved (warning: ${validationError})` : "Flow saved", {
        type: validationError ? "info" : "success",
      });
    } catch (e) {
      showToast(`Save failed: ${asMessage(e)}`, { type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    onSaveRef.current = onSave;
  });

  const onRun = async () => {
    if (!selectedFlow || isRunning) return;
    if (validationError) {
      showToast(`Cannot run: ${validationError}`, { type: "error" });
      return;
    }
    const flow: FlowV2 = {
      ...selectedFlow,
      nodes: serializeNodesV2(nodes),
      edges: serializeEdgesV2(edges),
    };
    setIsRunning(true);
    resetStatuses();
    setRecords([]);
    setLastSummary(null);

    const handle = runFlowV2(
      flow,
      { apiCall, collections, environmentId: selectedEnvId || null },
      {
        onNodeStatus: setNodeStatus,
        onRecord: (record) => {
          setRecords((prev) => [...prev, record]);
          if (record.iteration === undefined) return;
          // Live "item N" progress per node while its stream flows.
          setNodes((prev) =>
            prev.map((n) =>
              n.id === record.nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      streamBadge: `item ${record.iteration! + 1}`,
                      failedItems:
                        (n.data.failedItems || 0) + (record.status === "failed" && record.attempt === undefined ? 1 : 0),
                    },
                  }
                : n
            )
          );
        },
      }
    );
    runHandleRef.current = handle;
    try {
      const summary = await handle.done;
      setLastSummary(summary);
      persistLastRun(flow.id, summary);
      // Final per-node failure tallies come from the summary, which counts
      // retries correctly (a retried item is one failure, not one per attempt).
      setNodes((prev) =>
        prev.map((n) => ({
          ...n,
          data: {
            ...n.data,
            streamBadge: null,
            failedItems: summary.nodeItemCounts?.[n.id]?.failed || 0,
            latchedInputs: summary.nodeLatchedInputs?.[n.id] || [],
          },
        }))
      );
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
  const onDownloadReport = () => {
    if (!records.length || !selectedFlow) return;
    downloadCsv(buildRunCsv(records), runCsvFilename(selectedFlow.name));
  };

  // ---- flow management ------------------------------------------------------

  const onCreateFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flowNameDraft.trim()) return;
    try {
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
    if (!selectedFlow || !flowNameDraft.trim()) return;
    try {
      await updateFlow(selectedFlow.id, { name: flowNameDraft.trim() });
      setShowRenameModal(false);
      showToast("Flow renamed", { type: "success" });
    } catch (err) {
      showToast(asMessage(err), { type: "error" });
    }
  };

  const onDeleteFlow = async () => {
    if (!selectedFlow) return;
    if (!(await confirmDialog(`Delete flow "${selectedFlow.name}"? This cannot be undone.`))) return;
    try {
      await deleteFlow(selectedFlow.id);
      onSelectFlow("");
      showToast("Flow deleted", { type: "success" });
    } catch (err) {
      showToast(asMessage(err), { type: "error" });
    }
  };

  const onDuplicateFlow = async () => {
    if (!selectedFlow) return;
    try {
      const flowNodes = serializeNodesV2(nodes);
      const flowEdges = serializeEdgesV2(edges);
      const created = await createFlow(generateDuplicateName(selectedFlow.name, flows.map((f) => f.name)));
      await updateFlow(
        created.id,
        {
          description: selectedFlow.description,
          nodes: flowNodes as unknown as FlowNode[],
          edges: flowEdges as unknown as Flow["edges"],
        },
        created
      );
      onSelectFlow(created.id);
      showToast("Flow duplicated", { type: "success" });
    } catch (err) {
      showToast(asMessage(err), { type: "error" });
    }
  };

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) || null;
  const selectedNodeRecords = useMemo(
    () => (selectedNode ? records.filter((r) => r.nodeId === selectedNode.id) : []),
    [records, selectedNode]
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="h-14 px-4 border-b border-line bg-cream flex items-center gap-2 flex-shrink-0">
        <Dropdown
          value={selectedFlow?.id || ""}
          onChange={onSelectFlow}
          placeholder={flows.length ? "Select flow…" : "No flows yet"}
          widthClass="w-[240px]"
          options={flows.map((f) => ({ value: f.id, label: f.schemaVersion === 2 ? f.name : `${f.name} · Legacy` }))}
        />
        {dirty && <span className="h-2 w-2 rounded-full bg-clay flex-shrink-0" title="Unsaved changes" />}
        <button
          onClick={() => {
            setFlowNameDraft("");
            setShowNewFlowModal(true);
          }}
          className="h-8 px-2.5 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
        {selectedFlow && (
          <>
            <button
              onClick={() => {
                setFlowNameDraft(selectedFlow.name);
                setShowRenameModal(true);
              }}
              title="Rename flow"
              className="h-8 w-8 flex items-center justify-center bg-cream border border-line rounded-md text-graphite hover:bg-panel transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDuplicateFlow}
              title="Duplicate flow"
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
          </>
        )}

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
        {(validationError || validationWarning || envWarning) && (
          <span
            className="flex items-center gap-1.5 text-[11px] text-amber-700 max-w-[320px] truncate"
            title={validationError || validationWarning || envWarning || ""}
          >
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            {validationError || validationWarning || envWarning}
          </span>
        )}
        <button
          disabled
          title="Assistant is not yet available for V2 flows"
          className="h-8 px-3 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite opacity-50 cursor-not-allowed"
        >
          <Sparkles className="h-3.5 w-3.5" /> Assistant
        </button>
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
          {PALETTE.map((entry) => (
            <div
              key={entry.type}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-studio-node", entry.type);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDoubleClick={() => addNode(entry.type, { x: 120 + Math.random() * 120, y: 120 + Math.random() * 120 })}
              className="p-3 bg-cream border border-line rounded-lg cursor-grab hover:border-clay transition-colors"
              title="Drag onto the canvas (or double-click)"
            >
              <div className="flex items-center gap-2">
                <entry.icon className="h-4 w-4 text-clay" />
                <span className="text-xs font-medium text-ink">{entry.label}</span>
              </div>
              <p className="m-0 mt-1 text-[11px] text-mute leading-snug">{entry.hint}</p>
            </div>
          ))}
          <p className="text-[11px] text-mute px-1 mt-2 leading-relaxed">
            A connection carries a <strong>stream</strong> of items, ending with a done signal — so{" "}
            <span className="font-mono">Array Emit → Request → Accumulator</span> is a loop. An output can feed as many
            inputs as you like; an input takes one connection (use <strong>Mux</strong> to combine). The small diamonds
            order blocks without passing data.
          </p>
        </div>

        {/* Canvas */}
        {selectedFlow ? (
          <div
            className="flex-1 min-w-0 min-h-0 relative"
            onDrop={onDrop}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <NodeActionsContext.Provider value={nodeActions}>
              <ReactFlow
                nodes={nodes}
                edges={edges.map((e) => ({
                  ...e,
                  animated: isRunning && nodes.find((n) => n.id === e.source)?.data.status === "running",
                }))}
                nodeTypes={studioNodeTypesV2}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onConnectEnd={onConnectEnd}
                isValidConnection={isValidConnection}
                onNodeClick={(_, node) => {
                  setSelectedNodeId(node.id);
                  setSelectedEdgeId(null);
                }}
                onEdgeClick={(_, edge) => {
                  setSelectedEdgeId(edge.id);
                  setSelectedNodeId(null);
                }}
                onPaneClick={() => {
                  setSelectedNodeId(null);
                  setSelectedEdgeId(null);
                }}
                deleteKeyCode={["Backspace", "Delete"]}
                onDelete={({ nodes: deletedNodes, edges: deletedEdges }) =>
                  pushUndo(serializeNodesV2(deletedNodes as StudioNodeV2[]), serializeEdgesV2(deletedEdges))
                }
                panOnDrag={[1, 2]}
                selectionOnDrag
                selectionMode={SelectionMode.Partial}
                fitView
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={20} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </NodeActionsContext.Provider>
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

        {selectedFlow && selectedNode && (
          <InspectorV2
            key={selectedNode.id}
            node={selectedNode}
            edges={edges}
            collections={collections}
            records={selectedNodeRecords}
            itemCounts={lastSummary?.nodeItemCounts?.[selectedNode.id]}
            latchedInputs={lastSummary?.nodeLatchedInputs?.[selectedNode.id]}
            onChange={(patch) => updateFlowNodeV2(selectedNode.id, patch)}
            onClose={() => setSelectedNodeId(null)}
            onDelete={() => {
              pushUndo(
                serializeNodesV2([selectedNode]),
                serializeEdgesV2(edges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id))
              );
              setNodes((prev) => prev.filter((n) => n.id !== selectedNode.id));
              setEdges((prev) => prev.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
              setSelectedNodeId(null);
            }}
          />
        )}

        {selectedFlow && !selectedNode && selectedEdge && (
          <EdgeInspectorV2
            edge={selectedEdge}
            nodes={nodes}
            onChangePath={(path) =>
              setEdges((prev) =>
                prev.map((e) => (e.id === selectedEdge.id ? { ...e, data: { ...e.data, path: path || undefined } } : e))
              )
            }
            onDelete={() => {
              pushUndo([], serializeEdgesV2([selectedEdge]));
              setEdges((prev) => prev.filter((e) => e.id !== selectedEdge.id));
              setSelectedEdgeId(null);
            }}
            onClose={() => setSelectedEdgeId(null)}
          />
        )}
      </div>

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

// React Flow's onConnectEnd hands back the in-progress connection; only the
// few fields the rejection hint needs are typed here.
interface ConnectionStateLike {
  isValid?: boolean | null;
  fromNode?: { id: string } | null;
  fromHandle?: { id?: string | null } | null;
  toNode?: { id: string } | null;
  toHandle?: { id?: string | null } | null;
}

const asMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const dedupeName = (base: string, taken: Set<string>): string => {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
};

// ---- inspector ----------------------------------------------------------------

/** Generator block config: pick a token from the same catalog API Explorer
 * offers, and optionally repeat per driving item. */
function GeneratorConfigV2({
  cfg,
  onChange,
}: {
  cfg: GeneratorNodeConfigV2;
  onChange: (config: GeneratorNodeConfigV2) => void;
}) {
  const token = (cfg.token || "").trim();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-stone">Value</label>
        <div className="flex items-center gap-1.5">
          <GeneratorBindingButton value={token} onChange={(t) => onChange({ ...cfg, token: t })} />
        </div>
        <span className="text-[11px] text-mute">
          Emitted on <span className="font-mono">value</span>. One output can feed several inputs, so every consumer
          sees the <em>same</em> generated value — that is what a token typed into each request separately cannot do.
        </span>
        {!!token && !isKnownGeneratorToken(token) && (
          <span className="text-[11px] text-amber-700">
            This build doesn&apos;t know <span className="font-mono">{token}</span>, so the block will fail at run time.
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5 pt-3 border-t border-line">
        <label className="flex items-center gap-2 text-xs font-medium text-stone">
          <input
            type="checkbox"
            checked={!!cfg.useEach}
            onChange={(e) => onChange({ ...cfg, useEach: e.target.checked })}
          />
          <Repeat2 className="h-3.5 w-3.5 text-clay" /> Repeat with an `each` input
        </label>
        <span className="text-[11px] text-mute">
          Off, this emits one value that every consumer reuses. On, it produces a fresh value per item of the stream
          you connect — a unique email per order, say.
        </span>
      </div>
    </div>
  );
}

const MAX_VISIBLE_RECORDS = 50;

function InspectorV2({
  node,
  edges,
  collections,
  records,
  itemCounts,
  latchedInputs,
  onChange,
  onClose,
  onDelete,
}: {
  node: StudioNodeV2;
  edges: Edge[];
  collections: Collection[];
  records: RunRecord[];
  itemCounts?: { ok: number; failed: number; skipped: number };
  latchedInputs?: string[];
  onChange: (patch: Partial<FlowNodeV2>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const fn = node.data.flowNode;
  const [detailRecord, setDetailRecord] = useState<RunRecord | null>(null);
  const updateConfig = (config: FlowNodeV2["config"]) => onChange({ config });

  const danglingEdges = useMemo(() => {
    const known = new Set(node.data.ports.map((p) => p.id));
    return edges.filter(
      (e) =>
        (e.target === node.id && e.targetHandle && !known.has(e.targetHandle)) ||
        (e.source === node.id && e.sourceHandle && !known.has(e.sourceHandle))
    );
  }, [edges, node]);

  const connectedIn = (portId: string) => edges.some((e) => e.target === node.id && e.targetHandle === portId);
  const visibleRecords = records.slice(-MAX_VISIBLE_RECORDS);

  return (
    <div className="w-[380px] flex-shrink-0 bg-panel border-l border-line flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between flex-shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-stone">{fn.type} node</span>
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
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-stone">Name (shown on the node and in run records)</label>
          <input value={fn.name} onChange={(e) => onChange({ name: e.target.value })} className={inputCls} />
        </div>

        {fn.type === "delay" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone">Delay (ms)</label>
            <input
              type="number"
              min={0}
              value={(fn.config as DelayNodeConfigV2).ms}
              onChange={(e) => updateConfig({ ms: Math.max(0, parseInt(e.target.value, 10) || 0) })}
              className={inputCls}
            />
            <span className="text-[11px] text-mute">
              Connect <span className="font-mono">value</span> through it to pace a stream (one wait per item); leave it
              unconnected to simply pause between blocks.
            </span>
          </div>
        )}

        {fn.type === "request" && (
          <RequestConfigV2
            cfg={fn.config as RequestNodeConfigV2}
            collections={collections}
            onChange={updateConfig}
          />
        )}

        {fn.type === "arrayEmit" && (() => {
          const items = (fn.config as ArrayEmitNodeConfigV2).staticItems || { type: "json" as const, value: "[]" };
          const isCount = items.type === "number";
          return (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone">Items (max {EMIT_MAX_ITEMS} per run)</label>
            {connectedIn("in:array") ? (
              <span className="text-[11px] text-mute">
                Items arrive on the <span className="font-mono">array</span> connection. Disconnect it to set a repeat
                count or static array instead.
              </span>
            ) : (
              <>
                <Dropdown
                  value={isCount ? "count" : "array"}
                  onChange={(v) =>
                    updateConfig({
                      staticItems: v === "count" ? { type: "number", value: "3" } : { type: "json", value: "[]" },
                    } as ArrayEmitNodeConfigV2)
                  }
                  widthClass="w-full"
                  options={[
                    { value: "count", label: "Repeat a number of times" },
                    { value: "array", label: "Static JSON array" },
                  ]}
                />
                {isCount ? (
                  <input
                    type="number"
                    min={1}
                    max={EMIT_MAX_ITEMS}
                    value={items.value}
                    onChange={(e) =>
                      updateConfig({
                        staticItems: { type: "number", value: e.target.value },
                      } as ArrayEmitNodeConfigV2)
                    }
                    className={inputCls}
                  />
                ) : (
                  <div className="h-[120px] rounded-lg overflow-hidden border border-line">
                    <Editor
                      height="100%"
                      language="json"
                      theme="vs-dark"
                      value={items.value || "[]"}
                      onChange={(val) =>
                        updateConfig({ staticItems: { type: "json", value: val || "[]" } } as ArrayEmitNodeConfigV2)
                      }
                      options={{ minimap: { enabled: false }, fontSize: 12, lineNumbers: "off", scrollbar: { vertical: "auto", horizontal: "hidden" } }}
                    />
                  </div>
                )}
              </>
            )}
            <span className="text-[11px] text-mute">
              Emits one item at a time on <span className="font-mono">item</span> (with its position on{" "}
              <span className="font-mono">index</span>), then fires <span className="font-mono">done</span>. To repeat a
              request that takes no inputs, wire <span className="font-mono">index</span> into its{" "}
              <span className="font-mono">each</span> input.
            </span>
          </div>
          );
        })()}

        {fn.type === "accumulator" && (
          <span className="text-[11px] text-mute">
            Collects every item of its input stream, then emits them once as an <span className="font-mono">array</span>{" "}
            (plus <span className="font-mono">count</span>). Items that failed upstream are left out. No extra wiring is
            needed — the connection itself carries the end of the stream.
          </span>
        )}

        {fn.type === "generator" && (
          <GeneratorConfigV2
            cfg={fn.config as GeneratorNodeConfigV2}
            onChange={(config) => updateConfig(config)}
          />
        )}

        {fn.type === "mapper" && (
          <RowsEditorV2
            title="Outputs (one per JSONPath)"
            addLabel="Add output"
            rows={(fn.config as MapperNodeConfigV2).rows || []}
            valueOf={(r) => r.path}
            placeholder="$.name"
            onChange={(rows) => updateConfig({ rows } as MapperNodeConfigV2)}
            makeRow={() => ({ id: crypto.randomUUID(), path: "" })}
            setValue={(row, value) => ({ ...row, path: value })}
            hint="Each output emits its own extraction from the same object, so one object in becomes several values out."
          />
        )}

        {fn.type === "mux" && (
          <RowsEditorV2
            title="Inputs (one per field)"
            addLabel="Add input"
            rows={(fn.config as MuxNodeConfigV2).rows || []}
            valueOf={(r) => r.field}
            placeholder="fieldName"
            onChange={(rows) => updateConfig({ ...(fn.config as MuxNodeConfigV2), rows })}
            makeRow={() => ({ id: crypto.randomUUID(), field: "" })}
            setValue={(row, value) => ({ ...row, field: value })}
            hint="Builds one object per item, using each input's field name as the key."
          />
        )}

        {/* Ports overview */}
        <div className="flex flex-col gap-1.5 pt-3 border-t border-line">
          <label className="text-xs font-medium text-stone">Ports</label>
          <div className="flex flex-col gap-1">
            {node.data.ports
              .filter((p) => p.kind === "data")
              .map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-[11px]">
                  <span
                    className={`h-2 w-2 rounded-full flex-shrink-0 ${p.direction === "in" ? "bg-clay" : "bg-emerald-500"}`}
                  />
                  <span className="font-mono text-graphite truncate">{portLabel(p)}</span>
                  <span className="ml-auto text-mute">
                    {p.direction === "in" ? (connectedIn(p.id) ? "connected" : "input") : "output"}
                  </span>
                </div>
              ))}
          </div>
        </div>

        {danglingEdges.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-3 border-t border-line">
            <label className="text-xs font-medium text-red-600">Port problems</label>
            {danglingEdges.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px]"
              >
                <AlertCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                <span className="font-mono text-red-700 truncate">
                  {e.target === node.id ? e.targetHandle : e.sourceHandle}
                </span>
                <span className="text-red-600/70">missing</span>
              </div>
            ))}
            <span className="text-[11px] text-mute">
              Delete the affected connection (click it, then the trash button), or restore the port on the saved request.
            </span>
          </div>
        )}

        {records.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-3 border-t border-line">
            <label className="text-xs font-medium text-stone">
              Last run
              {itemCounts && (
                <span className="ml-1.5 font-normal text-mute">
                  ({itemCounts.ok} ok
                  {itemCounts.failed ? `, ${itemCounts.failed} failed` : ""}
                  {itemCounts.skipped ? `, ${itemCounts.skipped} skipped` : ""})
                </span>
              )}
            </label>
            {!!latchedInputs?.length && (
              <span className="text-[11px] text-mute">
                {latchedInputs.map((n) => `"${n}"`).join(", ")} produced a single value, reused for
                {" "}
                {itemCounts ? itemCounts.ok + itemCounts.failed + itemCounts.skipped : "every"} item(s).
              </span>
            )}
            {records.length > visibleRecords.length && (
              <span className="text-[11px] text-mute">
                +{records.length - visibleRecords.length} earlier item(s) — download the report for all of them
              </span>
            )}
            {visibleRecords.map((r, i) => (
              <div
                key={i}
                className={`px-3 py-2 rounded-lg border text-[11px] ${
                  r.status === "success"
                    ? "bg-cream border-line"
                    : r.status === "failed"
                      ? "bg-red-50 border-red-200"
                      : "bg-amber-50 border-amber-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">
                    {r.status}
                    {r.iteration !== undefined ? ` · item ${r.iteration + 1}` : ""}
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

      {detailRecord && <RunRecordDetailModalV2 record={detailRecord} onClose={() => setDetailRecord(null)} />}
    </div>
  );
}

// ---- per-type config editors ----------------------------------------------------

function RowsEditorV2<T extends { id: string }>({
  title,
  addLabel,
  rows,
  valueOf,
  placeholder,
  onChange,
  makeRow,
  setValue,
  hint,
}: {
  title: string;
  addLabel: string;
  rows: T[];
  valueOf: (row: T) => string;
  placeholder: string;
  onChange: (rows: T[]) => void;
  makeRow: () => T;
  setValue: (row: T, value: string) => T;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-stone">{title}</label>
        <button
          onClick={() => onChange([...rows, makeRow()])}
          className="h-6 px-2 flex items-center gap-1 bg-cream border border-line rounded-md text-[11px] text-graphite hover:bg-hover transition-colors"
        >
          <Plus className="h-3 w-3" /> {addLabel}
        </button>
      </div>
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-1.5">
          <input
            value={valueOf(row)}
            onChange={(e) => onChange(rows.map((r) => (r.id === row.id ? setValue(r, e.target.value) : r)))}
            placeholder={placeholder}
            className={`${inputCls} flex-1`}
          />
          <button
            onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
            title="Remove"
            className="h-7 w-7 flex-shrink-0 rounded-md border border-line flex items-center justify-center text-stone hover:bg-danger-soft hover:text-danger transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <span className="text-[11px] text-mute">{hint}</span>
    </div>
  );
}

const OPERATORS: { value: ComparisonOperator; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "exists", label: "exists" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
];

function RequestConfigV2({
  cfg,
  collections,
  onChange,
}: {
  cfg: RequestNodeConfigV2;
  collections: Collection[];
  onChange: (config: RequestNodeConfigV2) => void;
}) {
  const verify = cfg.verify;
  const patchVerify = (patch: Partial<RequestVerifyConfigV2>) =>
    onChange({ ...cfg, verify: { ...(verify || defaultVerifyConfig()), ...patch } });
  const patchCheck = (id: string, patch: Partial<VerifyCheckV2>) =>
    patchVerify({ checks: (verify?.checks || []).map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-stone">Request</label>
        <RequestPicker
          value={cfg.requestId}
          onChange={(requestId) => onChange({ ...cfg, requestId })}
          collections={collections}
        />
        <span className="text-[11px] text-mute">
          The request&apos;s <code className="font-mono">{"{{tokens}}"}</code> become input dots and its declared outputs
          become output dots. Unconnected inputs use the value typed on the node, otherwise the request&apos;s own
          default.
        </span>
      </div>

      <div className="flex flex-col gap-1.5 pt-3 border-t border-line">
        <label className="flex items-center gap-2 text-xs font-medium text-stone">
          <input
            type="checkbox"
            checked={!!cfg.useEach}
            onChange={(e) => onChange({ ...cfg, useEach: e.target.checked })}
          />
          <Repeat2 className="h-3.5 w-3.5 text-clay" /> Repeat with an `each` input
        </label>
        <span className="text-[11px] text-mute">
          Adds an <span className="font-mono">each</span> input dot. Connect a stream to it and this request runs once
          per item, ignoring the value — the way to repeat a request that declares no inputs of its own.
        </span>
      </div>

      <div className="flex flex-col gap-1.5 pt-3 border-t border-line">
        <label className="flex items-center gap-2 text-xs font-medium text-stone">
          <input
            type="checkbox"
            checked={!!verify?.enabled}
            onChange={(e) =>
              e.target.checked
                ? onChange({ ...cfg, verify: verify ? { ...verify, enabled: true } : defaultVerifyConfig() })
                : onChange({ ...cfg, verify: verify ? { ...verify, enabled: false } : undefined })
            }
          />
          <ShieldCheck className="h-3.5 w-3.5 text-clay" /> Verify the response
        </label>
        {verify?.enabled && (
          <>
            <span className="text-[11px] text-mute">
              Every check must pass, otherwise this item is retried. Read values with JSONPath over{" "}
              <code className="font-mono">$.status</code>, <code className="font-mono">$.body…</code>,{" "}
              <code className="font-mono">$.headers…</code> or <code className="font-mono">$.outputs…</code>.
            </span>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-stone">Checks</span>
              <button
                onClick={() =>
                  patchVerify({
                    checks: [
                      ...(verify.checks || []),
                      { id: crypto.randomUUID(), path: "$.status", operator: "equals", expectedSource: "static", expected: "200" },
                    ],
                  })
                }
                className="h-6 px-2 flex items-center gap-1 bg-cream border border-line rounded-md text-[11px] text-graphite hover:bg-hover transition-colors"
              >
                <Plus className="h-3 w-3" /> Add check
              </button>
            </div>
            {(verify.checks || []).map((check) => (
              <div key={check.id} className="flex flex-col gap-1.5 rounded-lg border border-line bg-cream p-2.5">
                <div className="flex items-center gap-1.5">
                  <input
                    value={check.path}
                    onChange={(e) => patchCheck(check.id, { path: e.target.value })}
                    placeholder="$.body.status"
                    className={`${inputCls} flex-1`}
                  />
                  <button
                    onClick={() => patchVerify({ checks: (verify.checks || []).filter((c) => c.id !== check.id) })}
                    className="h-7 w-7 flex-shrink-0 rounded-md border border-line flex items-center justify-center text-stone hover:bg-danger-soft hover:text-danger transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Dropdown
                    value={check.operator}
                    onChange={(v) => patchCheck(check.id, { operator: v as ComparisonOperator })}
                    widthClass="w-[130px]"
                    options={OPERATORS}
                  />
                  {check.operator !== "exists" && (
                    <Dropdown
                      value={check.expectedSource}
                      onChange={(v) => patchCheck(check.id, { expectedSource: v as "static" | "port" })}
                      widthClass="w-[100px]"
                      options={[
                        { value: "static", label: "Static" },
                        { value: "port", label: "Port" },
                      ]}
                    />
                  )}
                </div>
                {check.operator !== "exists" && check.expectedSource === "static" && (
                  <input
                    value={check.expected}
                    onChange={(e) => patchCheck(check.id, { expected: e.target.value })}
                    placeholder="Expected value"
                    className={inputCls}
                  />
                )}
                {check.operator !== "exists" && check.expectedSource === "port" && (
                  <span className="text-[11px] text-mute">
                    The expected value arrives on this check&apos;s own input dot — connect an upstream output to it.
                  </span>
                )}
              </div>
            ))}
            <div className="flex gap-2">
              <div className="flex flex-col gap-1.5 flex-1">
                <label className="text-xs font-medium text-stone">Max attempts</label>
                <input
                  type="number"
                  min={1}
                  value={verify.maxAttempts}
                  onChange={(e) => patchVerify({ maxAttempts: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  className={inputCls}
                />
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <label className="text-xs font-medium text-stone">Retry interval (ms)</label>
                <input
                  type="number"
                  min={0}
                  value={verify.intervalMs}
                  onChange={(e) => patchVerify({ intervalMs: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                  className={inputCls}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ---- edge inspector ------------------------------------------------------------

function EdgeInspectorV2({
  edge,
  nodes,
  onChangePath,
  onDelete,
  onClose,
}: {
  edge: Edge;
  nodes: StudioNodeV2[];
  onChangePath: (path: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const source = nodes.find((n) => n.id === edge.source);
  const target = nodes.find((n) => n.id === edge.target);
  const srcPort = source ? portById(source.data.ports, edge.sourceHandle) : undefined;
  const tgtPort = target ? portById(target.data.ports, edge.targetHandle) : undefined;
  const isTrigger = parseHandle(edge.sourceHandle)?.kind === "trigger";

  return (
    <div className="w-[380px] flex-shrink-0 bg-panel border-l border-line flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between flex-shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-stone">
          {isTrigger ? "trigger connection" : "data connection"}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onDelete}
            title="Delete connection"
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
        <div className="font-mono text-[11px] text-graphite break-all">
          {source?.data.flowNode.name}.{srcPort ? portLabel(srcPort) : "done"} → {target?.data.flowNode.name}.
          {tgtPort ? portLabel(tgtPort) : "after"}
        </div>
        {isTrigger ? (
          <span className="text-[11px] text-mute">
            Ordering only — no data passes. The target waits until this block&apos;s whole stream has finished.
          </span>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone">Path (optional JSONPath into each item)</label>
            <input
              value={((edge.data as { path?: string } | undefined)?.path as string) || ""}
              onChange={(e) => onChangePath(e.target.value)}
              placeholder="$.id"
              className={inputCls}
            />
            <span className="text-[11px] text-mute">
              Applied to every item before it arrives, e.g. <code className="font-mono">$.id</code> to pass just the id,
              or <code className="font-mono">$.items[*].id</code> to collect a list.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- run record detail modal ---------------------------------------------------

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

function RunRecordDetailModalV2({ record, onClose }: { record: RunRecord; onClose: () => void }) {
  const req = record.requestPayload;
  const res = record.response;
  const meta = [
    record.nodeName,
    record.iteration !== undefined ? `item ${record.iteration + 1}` : null,
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
          <span className="text-[11px] text-mute">No request was sent for this step.</span>
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
