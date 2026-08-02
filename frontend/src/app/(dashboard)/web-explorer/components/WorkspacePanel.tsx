"use client";

import React from "react";
import Editor from "@monaco-editor/react";
import {
  ChevronDown, ChevronUp, Copy, File, FileCode, Folder, FolderOpen, Lock,
  Play, Plus, RotateCcw, Save, Terminal, Trash2, XCircle,
} from "lucide-react";
import { useAppContext } from "../../../context/AppContext";
import { useToast } from "../../../context/ToastContext";
import { MAIN_FILE, RECORDING_FILE, isReadOnlyFile, isProtectedFile } from "../lib/workspaceFiles";
import { sectionLabel, iconBtn } from "../lib/styles";
import type { useWorkspaceFiles } from "../hooks/useWorkspaceFiles";
import type { useScriptRunner } from "../hooks/useScriptRunner";

/**
 * File sidebar + Monaco editor + execution console. State is hoisted into the
 * page (via the workspace/runner hooks) so file selection, logs, and console
 * collapse survive view-mode switches that unmount this panel.
 */
export default function WorkspacePanel({
  fileListOnRight = false,
  explorerWidth,
  onSidebarDragStart,
  workspace,
  runner,
  onEditorMount,
  isConsoleMinimized,
  setIsConsoleMinimized,
  onNewFile,
}: {
  fileListOnRight?: boolean;
  explorerWidth: number;
  onSidebarDragStart: (e: React.MouseEvent) => void;
  workspace: ReturnType<typeof useWorkspaceFiles>;
  runner: ReturnType<typeof useScriptRunner>;
  onEditorMount: (editor: any, monaco: any) => void;
  isConsoleMinimized: boolean;
  setIsConsoleMinimized: (minimized: boolean) => void;
  onNewFile: () => void;
}) {
  const {
    workspaceFiles,
    selectedWorkspaceFile,
    setSelectedWorkspaceFile,
    workspaceFileContent,
    isWorkspaceLoading,
    handleEditorChange,
    handleSaveWorkspaceFile,
    handleResetWorkspaceFile,
    handleDeleteFile,
  } = workspace;
  const { workspaceLogs, setWorkspaceLogs, isScriptRunning, handleRunScript, handleStopScript } = runner;
  const { apiCall } = useAppContext();
  const { showToast } = useToast();

  const handleOpenWorkspaceFolder = async () => {
    try {
      await apiCall("/api/workspace/open-location", { method: "POST" });
    } catch (e: any) {
      showToast(`Failed to open workspace folder: ${e.message}`, { type: "error" });
    }
  };

  const handleCopyWorkspacePath = async () => {
    try {
      const { path } = await apiCall("/api/workspace/path");
      await navigator.clipboard.writeText(path);
      showToast("Workspace path copied to clipboard", { type: "success" });
    } catch (e: any) {
      showToast(`Failed to copy workspace path: ${e.message}`, { type: "error" });
    }
  };

  const fileList = (
    <div style={{ width: `${explorerWidth}px` }} className="flex-shrink-0 bg-panel flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 border-b border-line flex items-center justify-between flex-shrink-0">
        <span className={sectionLabel}>
          <Folder className="h-3.5 w-3.5 text-clay" /> Files
        </span>
        <div className="flex items-center gap-1">
          <button onClick={handleOpenWorkspaceFolder} className={iconBtn} title="Open workspace folder in file manager">
            <FolderOpen className="h-3 w-3 text-graphite" />
          </button>
          <button onClick={handleCopyWorkspacePath} className={iconBtn} title="Copy workspace folder path">
            <Copy className="h-3 w-3 text-graphite" />
          </button>
          <button onClick={onNewFile} className={iconBtn} title="Create Python module">
            <Plus className="h-3 w-3 text-graphite" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
        {["builder", "recording"].map((folder) => {
          const folderFiles = workspaceFiles.filter((f) => f.name.startsWith(`${folder}/`));
          if (folderFiles.length === 0) return null;
          return (
            <div key={folder} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone select-none">
                <Folder className="h-3 w-3 text-mute" /> {folder}
              </div>
              {folderFiles.map((file) => {
                const active = selectedWorkspaceFile === file.name;
                const baseName = file.name.slice(folder.length + 1);
                return (
                  <div
                    key={file.name}
                    className="group flex items-center gap-2 pl-6 pr-2.5 py-1.5 rounded-md text-xs transition-colors hover:bg-cream"
                    style={{ background: active ? "var(--color-cream)" : "transparent" }}
                  >
                    <button
                      onClick={() => setSelectedWorkspaceFile(file.name)}
                      className="flex items-center gap-2 text-left truncate flex-1"
                    >
                      <File className={`h-3.5 w-3.5 ${active ? "text-clay" : "text-mute"}`} />
                      <span className={`truncate ${active ? "text-clay font-medium" : "text-graphite"}`}>{baseName}</span>
                    </button>
                    {!isProtectedFile(file.name) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteFile(file.name); }}
                        className="opacity-0 group-hover:opacity-100 text-mute hover:text-danger transition"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>

  );
  const resizer = (
    <div onMouseDown={onSidebarDragStart} className="w-1 bg-line hover:bg-clay cursor-col-resize transition-colors flex-shrink-0 self-stretch z-10 select-none" />
  );
  const editor = (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-11 border-b border-line px-4 bg-cream flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-medium text-graphite font-mono flex items-center gap-1.5">
          <FileCode className="h-4 w-4 text-mute" />
          {selectedWorkspaceFile || "No active file"}
        </span>
        <div className="flex items-center gap-2">
          {isReadOnlyFile(selectedWorkspaceFile) && (
            <span className="h-[30px] px-3 bg-panel border border-line rounded-md text-xs font-medium text-mute flex items-center gap-1.5 select-none">
              <Lock className="h-3.5 w-3.5" /> Read-only
            </span>
          )}
          {!isReadOnlyFile(selectedWorkspaceFile) && (
            <button
              onClick={handleSaveWorkspaceFile}
              disabled={!selectedWorkspaceFile || isWorkspaceLoading}
              className="h-[30px] px-3 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" /> Save
            </button>
          )}
          {(selectedWorkspaceFile === MAIN_FILE || selectedWorkspaceFile === RECORDING_FILE || isReadOnlyFile(selectedWorkspaceFile)) && (
            <button
              onClick={handleResetWorkspaceFile}
              disabled={!selectedWorkspaceFile || isWorkspaceLoading}
              className="h-[30px] px-3 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors flex items-center gap-1.5 disabled:opacity-50"
              title="Reset file content to default boilerplate"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
          )}
          {isScriptRunning ? (
            <button
              onClick={handleStopScript}
              className="h-[30px] px-3 bg-danger rounded-md text-xs font-medium text-white flex items-center gap-1.5 transition-colors"
            >
              <XCircle className="h-3.5 w-3.5" /> Stop
            </button>
          ) : (
            <button
              onClick={handleRunScript}
              disabled={!selectedWorkspaceFile}
              className="h-[30px] px-3 bg-clay hover:bg-clay-dark rounded-md text-xs font-medium text-white flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" /> Run
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {isWorkspaceLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-mute bg-cream/80">
            Loading module content…
          </div>
        ) : (
          <Editor
            key={selectedWorkspaceFile}
            height="100%"
            language="python"
            theme="vs-dark"
            value={workspaceFileContent}
            onChange={handleEditorChange}
            onMount={onEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              lineNumbers: "on",
              automaticLayout: true,
              readOnly: isReadOnlyFile(selectedWorkspaceFile),
            }}
          />
        )}
      </div>

      <div className={`border-t border-line flex flex-col flex-shrink-0 transition-all duration-300 ${isConsoleMinimized ? "h-9" : "h-44"}`}>
        <div className="h-9 px-4 border-b border-line flex items-center justify-between bg-cream flex-shrink-0">
          <button
            onClick={() => setIsConsoleMinimized(!isConsoleMinimized)}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <Terminal className="h-3.5 w-3.5 text-mute" />
            <span className={sectionLabel}>Execution console</span>
            {isConsoleMinimized ? <ChevronUp className="h-3.5 w-3.5 text-mute" /> : <ChevronDown className="h-3.5 w-3.5 text-mute" />}
          </button>
          {!isConsoleMinimized && (
            <button onClick={() => setWorkspaceLogs("")} className="text-[11px] text-mute hover:text-graphite">
              Clear
            </button>
          )}
        </div>
        {!isConsoleMinimized && (
          <pre className="flex-1 m-0 p-3 bg-ink-900 font-mono text-[11px] text-sage overflow-y-auto whitespace-pre-wrap select-text">
            {workspaceLogs || "Console output is empty. Run main.py or another script to execute."}
          </pre>
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full w-full flex overflow-hidden bg-cream">
      {fileListOnRight ? <>{editor}{resizer}{fileList}</> : <>{fileList}{resizer}{editor}</>}
    </div>
  );
}
