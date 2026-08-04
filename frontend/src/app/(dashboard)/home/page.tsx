"use client";

import React from "react";
import Link from "next/link";
import { Send, Workflow, Globe, Inbox, Download } from "lucide-react";
import { useAppContext, type Collection, type RequestItem } from "../../context/AppContext";
import { useFlowRuns, type FlowRunMeta } from "../../context/FlowRunsContext";
import { useToast } from "../../context/ToastContext";
import { useNowTick } from "../../utils/useNowTick";
import { formatRelativeTime } from "../../utils/formatRelativeTime";
import { formatDurationMs } from "../../utils/formatDuration";
import { methodStyle } from "../../utils/methodStyle";
import { buildRunCsv, downloadCsv, runCsvFilename } from "../../utils/flowReport";

const TOOLS = [
  { href: "/api-explorer", icon: Send, name: "API explorer", desc: "Build and run REST requests" },
  { href: "/api-studio", icon: Workflow, name: "API Studio", desc: "Design multi-step API flows" },
  { href: "/web-explorer", icon: Globe, name: "Web explorer", desc: "Automate browser flows" },
];

interface RecentRequest {
  req: RequestItem;
  collectionName: string;
}

// Walks a collection tree (including nested sub-collections) collecting every
// request that has actually been run, paired with the root collection's name
// for display.
function collectRecentRequests(collection: Collection, collectionName: string, out: RecentRequest[]) {
  for (const req of collection.requests || []) {
    if (req.lastResponse && req.lastRunAt) {
      out.push({ req, collectionName });
    }
  }
  for (const child of collection.children || []) {
    collectRecentRequests(child, collectionName, out);
  }
}

const statusStyle = (status: number): { bg: string; c: string } =>
  status < 400 ? { bg: "#e3f5e9", c: "#276749" } : { bg: "#fde8e8", c: "#c64545" };

const RUN_STATUS_STYLE: Record<FlowRunMeta["status"], { bg: string; c: string; label: string }> = {
  success: { bg: "#e3f5e9", c: "#276749", label: "Success" },
  failed: { bg: "#fde8e8", c: "#c64545", label: "Failed" },
  cancelled: { bg: "#eeeae3", c: "#6b6459", label: "Cancelled" },
  running: { bg: "#fdf1dc", c: "#9a6b1f", label: "Running" },
};

function FlowExecutions({ nowTick }: { nowTick: number }) {
  const { runs, fetchRun } = useFlowRuns();
  const { showToast } = useToast();

  const onDownload = async (run: FlowRunMeta) => {
    const detail = await fetchRun(run.runId);
    if (!detail?.summary?.records) {
      showToast("Report unavailable for this run", { type: "error" });
      return;
    }
    downloadCsv(buildRunCsv(detail.summary.records), runCsvFilename(run.flowName));
  };

  return (
    <div>
      <div className="text-[13px] font-semibold text-graphite mb-3">Flow executions</div>
      <div className="bg-cream border border-line rounded-xl overflow-hidden">
        {runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Inbox className="h-6 w-6 text-mute" />
            <div className="text-xs text-mute max-w-[280px]">
              No flow runs yet — run a flow in API Studio or via an MCP agent.
            </div>
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="bg-panel border-b border-line text-stone font-semibold uppercase tracking-wider text-[10px]">
                <th className="px-4 py-2.5">Flow</th>
                <th className="px-4 py-2.5">Source</th>
                <th className="px-4 py-2.5 text-right">Nodes</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Duration</th>
                <th className="px-4 py-2.5 text-right" title="Average duration of this flow's successful runs">Avg</th>
                <th className="px-4 py-2.5 text-right">Started</th>
                <th className="px-4 py-2.5 text-right">Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {runs.map((run) => {
                const sStyle = RUN_STATUS_STYLE[run.status];
                return (
                  <tr key={run.runId} className="hover:bg-hover transition-colors">
                    <td className="px-4 py-2.5 max-w-[220px]">
                      <div className="text-[13px] text-graphite truncate">{run.flowName}</div>
                      <div className="text-[11px] text-mute truncate">
                        {run.environmentName ?? "No environment"}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          run.source === "mcp" ? "bg-clay/10 text-clay" : "bg-hover text-graphite"
                        }`}
                      >
                        {run.source === "mcp" ? "Agent" : "User"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[11px]">{run.nodeCount}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium px-2 py-0.5 rounded-full"
                        style={{ background: sStyle.bg, color: sStyle.c }}
                      >
                        {run.status === "running" && (
                          <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: sStyle.c }} />
                        )}
                        {sStyle.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[11px]">
                      {run.durationMs != null ? formatDurationMs(run.durationMs) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[11px]">
                      {run.avgDurationMs != null ? formatDurationMs(run.avgDurationMs) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[11px] text-mute whitespace-nowrap">
                      {formatRelativeTime(run.startedAt, nowTick)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => onDownload(run)}
                        disabled={run.status === "running" || !run.hasReport}
                        title={run.status === "running" ? "Run still in progress" : run.hasReport ? "Download CSV report" : "No report stored for this run"}
                        className="h-7 w-7 inline-flex items-center justify-center bg-cream border border-line rounded-md text-graphite hover:bg-panel transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  const { user, collections, environments, selectedEnvId } = useAppContext();
  const nowTick = useNowTick(30000);

  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = user?.name?.split(" ")[0] || "there";

  const recent = collections
    .flatMap((col) => {
      const out: RecentRequest[] = [];
      collectRecentRequests(col, col.name, out);
      return out;
    })
    .sort((a, b) => new Date(b.req.lastRunAt!).getTime() - new Date(a.req.lastRunAt!).getTime())
    .slice(0, 5);

  return (
    <div className="flex-1 overflow-y-auto px-10 py-8 pb-12">
      <div className="max-w-[1040px] mx-auto flex flex-col gap-8">

        <div>
          <div className="font-serif text-[30px] font-medium tracking-[-0.3px] text-ink">
            Good {timeOfDay}, {firstName} 👋
          </div>
          <div className="text-sm text-stone mt-1.5">
            Here&apos;s what&apos;s happening across your automation workspace.
          </div>
        </div>

        <div>
          <div className="text-[13px] font-semibold text-graphite mb-3">Jump back in</div>
          <div className="grid grid-cols-3 gap-3.5">
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              return (
                <Link
                  key={tool.href}
                  href={tool.href}
                  className="flex flex-col gap-2.5 bg-cream border border-line rounded-xl p-[18px] no-underline text-ink cursor-pointer hover:bg-panel transition-colors"
                >
                  <div className="h-8 w-8 rounded-lg bg-hover flex items-center justify-center">
                    <Icon className="h-4 w-4 text-clay" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{tool.name}</div>
                    <div className="text-xs text-mute mt-0.5">{tool.desc}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        <FlowExecutions nowTick={nowTick} />

        <div className="grid gap-5 items-start" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
          <div>
            <div className="text-[13px] font-semibold text-graphite mb-3">Recent activity</div>
            <div className="bg-cream border border-line rounded-xl overflow-hidden">
              {recent.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                  <Inbox className="h-6 w-6 text-mute" />
                  <div className="text-xs text-mute max-w-[240px]">
                    No requests run yet — head to API explorer to send your first one.
                  </div>
                </div>
              ) : (
                recent.map(({ req, collectionName }) => {
                  const status = req.lastResponse?.status ?? 0;
                  const sStyle = statusStyle(status);
                  return (
                    <div
                      key={req.id}
                      className="flex items-center gap-3 px-4 py-3 border-b border-line-soft last:border-b-0"
                    >
                      <span
                        className="font-mono text-[9px] font-medium px-1.5 py-0.5 rounded flex-shrink-0"
                        style={methodStyle(req.method)}
                      >
                        {req.method}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-graphite truncate">{req.name}</div>
                        <div className="text-[11px] text-mute mt-0.5 truncate">{collectionName}</div>
                      </div>
                      <span
                        className="font-mono text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: sStyle.bg, color: sStyle.c }}
                      >
                        {status}
                      </span>
                      <span className="text-[11px] text-mute w-16 text-right flex-shrink-0">
                        {formatRelativeTime(req.lastRunAt, nowTick)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <div className="text-[13px] font-semibold text-graphite mb-3">Environments</div>
            <div className="bg-cream border border-line rounded-xl overflow-hidden">
              {environments.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                  <div className="text-xs text-mute max-w-[200px]">
                    No environments yet — add one to manage variables per stage.
                  </div>
                </div>
              ) : (
                environments.map((env) => {
                  const active = env.id === selectedEnvId;
                  return (
                    <div
                      key={env.id}
                      className="flex items-center gap-2.5 px-4 py-3 border-b border-line-soft last:border-b-0"
                    >
                      <span
                        className={`h-[7px] w-[7px] rounded-full flex-shrink-0 ${active ? "bg-sage" : "bg-mute"}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">{env.name}</div>
                        <div className="text-[11px] text-mute">
                          {env.variables.length} variable{env.variables.length === 1 ? "" : "s"}
                        </div>
                      </div>
                      <span className="text-[11px] text-mute flex-shrink-0">{active ? "Active" : "—"}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
