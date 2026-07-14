"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAppContext } from "../../context/AppContext";
import { 
  Folder, 
  FolderOpen, 
  RefreshCw, 
  GitBranch, 
  Settings, 
  FileCode, 
  ChevronRight, 
  AlertCircle, 
  Check, 
  ArrowLeft,
  Terminal,
  HardDrive,
  Download,
  Target,
  Search
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";

const formatSize = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const formatDate = (isoStr: string) => {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return "";
  }
};

interface TrackedDir {
  name: string;
  path: string;
}

interface PythonFile {
  name: string;
  relativePath: string;
  size: number;
  modified: string;
}

interface FileTreeNode {
  name: string;
  relativePath: string;
  isDir: boolean;
  children?: FileTreeNode[];
  size?: number;
  modified?: string;
}

interface DirData {
  dirName: string;
  isGitRepo: boolean;
  gitBranch: string | null;
  pythonFiles: PythonFile[];
  fileTree?: FileTreeNode[];
}

interface BddParameter {
  name: string;
  type: string;
}

interface BddStep {
  stepType: string;
  pattern: string;
  functionName: string;
  parameters: BddParameter[];
  fileName: string;
  relativePath: string;
  code?: string;
}

interface FileTreeItemProps {
  node: FileTreeNode;
  depth: number;
  selectedFile: PythonFile | null;
  onSelectFile: (file: PythonFile) => void;
  onFocusDirectory: (path: string) => void;
}

const FileTreeItem: React.FC<FileTreeItemProps> = ({ node, depth, selectedFile, onSelectFile, onFocusDirectory }) => {
  const [isOpen, setIsOpen] = useState(true);

  const toggleOpen = () => {
    setIsOpen(!isOpen);
  };

  const paddingLeft = `${depth * 16 + 12}px`;

  if (node.isDir) {
    return (
      <div className="flex flex-col">
        <div className="group w-full flex items-center justify-between hover:bg-hover transition-colors pr-2">
          <button
            type="button"
            onClick={toggleOpen}
            className="flex-1 text-left py-1.5 flex items-center gap-1.5 transition-colors cursor-pointer text-stone min-w-0"
            style={{ paddingLeft }}
          >
            <ChevronRight className={`h-3.5 w-3.5 text-stone transition-transform flex-shrink-0 ${isOpen ? "rotate-90" : ""}`} />
            <Folder className="h-4 w-4 text-clay flex-shrink-0" />
            <span className="text-[12.5px] font-medium text-graphite truncate">{node.name}</span>
          </button>
          
          <button
            type="button"
            onClick={() => onFocusDirectory(node.relativePath)}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-chip rounded text-stone hover:text-clay transition-all cursor-pointer flex-shrink-0"
            title="Focus scanner on this folder"
          >
            <Target className="h-3.5 w-3.5" />
          </button>
        </div>
        {isOpen && node.children && (
          <div className="flex flex-col">
            {node.children.map(child => (
              <FileTreeItem
                key={child.relativePath}
                node={child}
                depth={depth + 1}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                onFocusDirectory={onFocusDirectory}
              />
            ))}
          </div>
        )}
      </div>
    );
  } else {
    const isSelected = selectedFile?.relativePath === node.relativePath;
    const pythonFile: PythonFile = {
      name: node.name,
      relativePath: node.relativePath,
      size: node.size || 0,
      modified: node.modified || ""
    };
    return (
      <button
        type="button"
        onClick={() => onSelectFile(pythonFile)}
        className={`w-full text-left py-1.5 pr-4 hover:bg-hover flex items-center justify-between transition-colors cursor-pointer ${
          isSelected ? "bg-panel text-clay font-medium border-l-2 border-clay" : "text-ink"
        }`}
        style={{ paddingLeft: `${depth * 16 + 32}px` }}
        title={`${node.name} (${formatSize(node.size || 0)}) - Modified: ${formatDate(node.modified || "")}`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <FileCode className={`h-4 w-4 flex-shrink-0 ${isSelected ? "text-clay" : "text-stone"}`} />
          <span className="text-[12.5px] truncate">{node.name}</span>
        </div>
        <span className="text-[10px] font-mono text-stone ml-2 flex-shrink-0 opacity-75">
          {formatSize(node.size || 0)}
        </span>
      </button>
    );
  }
};

export default function LocalScannerPage() {
  const { apiCall } = useAppContext();

  // Root configuration
  const [rootDir, setRootDir] = useState("");
  const [trackedDirs, setTrackedDirs] = useState<TrackedDir[]>([]);
  const [availableSubdirs, setAvailableSubdirs] = useState<string[]>([]);
  const [selectedSubdirsToTrack, setSelectedSubdirsToTrack] = useState<string[]>([]);

  // Page mode / States
  const [isSetupMode, setIsSetupMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active workspace state
  const [activeDir, setActiveDir] = useState<string | null>(null);
  const [activeDirData, setActiveDirData] = useState<DirData | null>(null);
  const [activeDirScanPath, setActiveDirScanPath] = useState(".");
  const [isDirScanning, setIsDirScanning] = useState(false);
  const [dirBranchMap, setDirBranchMap] = useState<Record<string, string>>({});

  // BDD steps tab view states
  const [activeTab, setActiveTab] = useState<"explorer" | "steps">("explorer");
  const [bddSteps, setBddSteps] = useState<BddStep[]>([]);
  const [isStepsLoading, setIsStepsLoading] = useState(false);
  const [stepsSearchQuery, setStepsSearchQuery] = useState("");

  // Git pull state
  const [isPulling, setIsPulling] = useState(false);
  const [pullOutput, setPullOutput] = useState<string | null>(null);
  const [showPullTerminal, setShowPullTerminal] = useState(false);

  // Monaco File Viewer state
  const [selectedFile, setSelectedFile] = useState<PythonFile | null>(null);
  const [selectedStep, setSelectedStep] = useState<BddStep | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [isFileLoading, setIsFileLoading] = useState(false);

  // Custom manual root dir input
  const [manualPathInput, setManualPathInput] = useState("");

  // Load config on mount
  useEffect(() => {
    loadConfiguration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch branches for tracked directories
  useEffect(() => {
    if (trackedDirs.length > 0 && rootDir) {
      trackedDirs.forEach(dir => {
        fetchDirBranch(dir.name);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedDirs, rootDir]);

  const loadConfiguration = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const config = await apiCall("/api/workspace/scanner/load-config");
      setRootDir(config.rootDir || "");
      const tracked = config.trackedDirs || [];
      setTrackedDirs(tracked);

      if (!config.rootDir) {
        setIsSetupMode(true);
      } else {
        setIsSetupMode(false);
        // If there are tracked directories, set the first one active
        if (tracked.length > 0) {
          handleSelectDirectory(tracked[0].name, tracked[0].path || ".", config.rootDir);
        } else {
          // If root is set but no tracked directories, automatically fetch subdirs for tracking setup
          await fetchRootSubdirs(config.rootDir);
          setIsSetupMode(true);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load scanner configuration");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchRootSubdirs = async (path: string) => {
    try {
      const res = await apiCall(`/api/workspace/scanner/scan-root?rootDir=${encodeURIComponent(path)}`);
      setAvailableSubdirs(res.subdirs || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to scan root directory contents");
    }
  };

  const fetchDirBranch = async (dirName: string) => {
    try {
      const res = await apiCall(`/api/workspace/scanner/scan-directory?rootDir=${encodeURIComponent(rootDir)}&dirName=${encodeURIComponent(dirName)}&relativePath=.`);
      if (res.gitBranch) {
        setDirBranchMap(prev => ({ ...prev, [dirName]: res.gitBranch }));
      }
    } catch {
      // Ignore background branch fetch errors
    }
  };

  const handleBrowseRoot = async () => {
    setIsBrowsing(true);
    setError(null);
    try {
      const selectedPath = await invoke<string | null>("select_directory");
      if (selectedPath) {
        setRootDir(selectedPath);
        setManualPathInput(selectedPath);
        await fetchRootSubdirs(selectedPath);
        setIsSetupMode(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to launch native folder browser");
    } finally {
      setIsBrowsing(false);
    }
  };

  const handleSetManualRoot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualPathInput.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      setRootDir(manualPathInput);
      await fetchRootSubdirs(manualPathInput);
      setIsSetupMode(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid path or failed to scan directory");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveTracking = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const newTrackedDirs = selectedSubdirsToTrack.map(name => {
        // Maintain existing path parameter if already tracked, else default to '.'
        const existing = trackedDirs.find(d => d.name === name);
        return { name, path: existing ? existing.path : "." };
      });

      await apiCall("/api/workspace/scanner/save-config", {
        method: "POST",
        body: JSON.stringify({ rootDir, trackedDirs: newTrackedDirs })
      });

      setTrackedDirs(newTrackedDirs);
      setIsSetupMode(false);

      if (newTrackedDirs.length > 0) {
        const first = newTrackedDirs[0];
        handleSelectDirectory(first.name, first.path);
      } else {
        setActiveDir(null);
        setActiveDirData(null);
        setSelectedFile(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save tracked directories");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectDirectory = async (name: string, defaultScanPath: string = ".", customRootDir?: string) => {
    const storedPath = typeof window !== "undefined" ? localStorage.getItem(`nv_scanner_focus_path_${name}`) : null;
    const scanPath = storedPath || defaultScanPath || ".";
    const activeRootDir = customRootDir || rootDir;

    setActiveDir(name);
    setActiveDirScanPath(scanPath);
    setSelectedFile(null);
    setSelectedStep(null);
    setFileContent("");
    setShowPullTerminal(false);
    setPullOutput(null);
    setIsDirScanning(true);
    setError(null);

    try {
      const data = await apiCall(
        `/api/workspace/scanner/scan-directory?rootDir=${encodeURIComponent(activeRootDir)}&dirName=${encodeURIComponent(name)}&relativePath=${encodeURIComponent(scanPath)}`
      );
      setActiveDirData(data);
      if (data.gitBranch) {
        setDirBranchMap(prev => ({ ...prev, [name]: data.gitBranch }));
      }
    } catch (err: unknown) {
      setError(`Failed to scan ${name}: ${err instanceof Error ? err.message : String(err)}`);
      setActiveDirData(null);
    } finally {
      setIsDirScanning(false);
    }
  };

  const handleScanPathUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDir) return;
    
    setIsDirScanning(true);
    setError(null);
    setSelectedFile(null);
    setSelectedStep(null);
    setFileContent("");

    try {
      // 1. Scan directory with new relative path
      const data = await apiCall(
        `/api/workspace/scanner/scan-directory?rootDir=${encodeURIComponent(rootDir)}&dirName=${encodeURIComponent(activeDir)}&relativePath=${encodeURIComponent(activeDirScanPath)}`
      );
      setActiveDirData(data);

      // 2. Save relative path parameter to config so it persists
      const updatedTrackedDirs = trackedDirs.map(d => 
        d.name === activeDir ? { ...d, path: activeDirScanPath } : d
      );
      await apiCall("/api/workspace/scanner/save-config", {
        method: "POST",
        body: JSON.stringify({ rootDir, trackedDirs: updatedTrackedDirs })
      });
      setTrackedDirs(updatedTrackedDirs);

      // 3. Save to localStorage immediately
      localStorage.setItem(`nv_scanner_focus_path_${activeDir}`, activeDirScanPath);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to scan specified path");
    } finally {
      setIsDirScanning(false);
    }
  };

  const fetchBddSteps = useCallback(async (dirName: string, path: string) => {
    setIsStepsLoading(true);
    try {
      const data = await apiCall(
        `/api/workspace/scanner/scan-steps?rootDir=${encodeURIComponent(rootDir)}&dirName=${encodeURIComponent(dirName)}&relativePath=${encodeURIComponent(path)}`
      );
      setBddSteps(data.steps || []);
    } catch (err: unknown) {
      console.error("Failed to fetch BDD steps", err);
    } finally {
      setIsStepsLoading(false);
    }
  }, [apiCall, rootDir]);

  useEffect(() => {
    if (activeTab === "steps" && activeDir) {
      fetchBddSteps(activeDir, activeDirScanPath);
    }
  }, [activeTab, activeDir, activeDirScanPath, fetchBddSteps]);

  const handleFocusDirectory = async (relativePath: string) => {
    if (!activeDir) return;
    
    setActiveDirScanPath(relativePath);
    setIsDirScanning(true);
    setError(null);
    setSelectedFile(null);
    setSelectedStep(null);
    setFileContent("");

    try {
      // 1. Scan directory with new relative path
      const data = await apiCall(
        `/api/workspace/scanner/scan-directory?rootDir=${encodeURIComponent(rootDir)}&dirName=${encodeURIComponent(activeDir)}&relativePath=${encodeURIComponent(relativePath)}`
      );
      setActiveDirData(data);

      // 2. Save relative path parameter to config so it persists
      const updatedTrackedDirs = trackedDirs.map(d => 
        d.name === activeDir ? { ...d, path: relativePath } : d
      );
      await apiCall("/api/workspace/scanner/save-config", {
        method: "POST",
        body: JSON.stringify({ rootDir, trackedDirs: updatedTrackedDirs })
      });
      setTrackedDirs(updatedTrackedDirs);

      // 3. Save to browser localStorage immediately as requested
      localStorage.setItem(`nv_scanner_focus_path_${activeDir}`, relativePath);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to scan specified path");
    } finally {
      setIsDirScanning(false);
    }
  };

  const handleGitPull = async () => {
    if (!activeDir) return;
    setIsPulling(true);
    setShowPullTerminal(true);
    setPullOutput("Pulling updates from git...\n");
    setError(null);

    try {
      const res = await apiCall(
        `/api/workspace/scanner/git-pull?rootDir=${encodeURIComponent(rootDir)}&dirName=${encodeURIComponent(activeDir)}`,
        { method: "POST" }
      );
      setPullOutput(res.output);
      // Re-scan directory to pick up any changes
      await handleSelectDirectory(activeDir, activeDirScanPath);
    } catch (err: unknown) {
      setPullOutput(prev => (prev || "") + `\nError running git pull: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsPulling(false);
    }
  };

  const handleReadFile = async (file: PythonFile) => {
    if (!activeDir) return;
    setSelectedStep(null);
    setSelectedFile(file);
    setIsFileLoading(true);
    setError(null);

    try {
      const res = await apiCall(
        `/api/workspace/scanner/read-file?rootDir=${encodeURIComponent(rootDir)}&dirName=${encodeURIComponent(activeDir)}&relativePath=${encodeURIComponent(activeDirScanPath)}&filePath=${encodeURIComponent(file.relativePath)}`
      );
      setFileContent(res.content);
    } catch (err: unknown) {
      setError(`Failed to read file: ${err instanceof Error ? err.message : String(err)}`);
      setFileContent("");
    } finally {
      setIsFileLoading(false);
    }
  };

  const handleSelectStep = (step: BddStep) => {
    setSelectedFile(null);
    setSelectedStep(step);
    setFileContent(step.code || "");
  };

  const toggleSubdirSelection = (name: string) => {
    setSelectedSubdirsToTrack(prev => 
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  const enterSetupMode = () => {
    setSelectedSubdirsToTrack(trackedDirs.map(d => d.name));
    setManualPathInput(rootDir);
    fetchRootSubdirs(rootDir);
    setIsSetupMode(true);
  };

  if (isLoading && !rootDir) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-cream gap-4">
        <RefreshCw className="h-8 w-8 text-clay animate-spin" />
        <p className="text-sm font-medium text-stone">Loading scanner settings...</p>
      </div>
    );
  }

  // 1. Initial Setup or Manage Tracking Screen
  if (isSetupMode) {
    return (
      <div className="flex-1 overflow-y-auto bg-cream p-8 flex flex-col items-center justify-start min-h-screen">
        <div className="w-full max-w-3xl flex flex-col gap-8 animate-[fadeUp_0.3s_ease-out]">
          
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line pb-5">
            <div>
              <h1 className="font-serif text-3xl font-medium text-ink flex items-center gap-3">
                <FolderOpen className="h-8 w-8 text-clay" />
                Local Directory Scanner
              </h1>
              <p className="text-sm text-stone mt-1">Configure and manage directory tracking on your local system.</p>
            </div>
            {rootDir && trackedDirs.length > 0 && (
              <button 
                onClick={() => setIsSetupMode(false)}
                className="h-[38px] px-4 border border-line hover:bg-hover rounded-lg text-[13px] font-medium text-graphite flex items-center gap-2 transition-all cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" /> Back to Scanner
              </button>
            )}
          </div>

          {/* Root Directory Picker */}
          <div className="bg-panel border border-line rounded-xl p-6 flex flex-col gap-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-mute flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-clay" /> Root Directory Setup
            </h2>
            <p className="text-[13px] text-stone leading-relaxed">
              Define the root folder containing your projects. The scanner will fetch subdirectories directly inside this path, letting you choose which ones to track.
            </p>
            
            <div className="flex flex-col md:flex-row gap-3 items-stretch">
              <button
                onClick={handleBrowseRoot}
                disabled={isBrowsing}
                className="h-10 px-5 bg-clay hover:bg-clay-dark disabled:bg-stone text-white font-medium text-sm rounded-lg flex items-center justify-center gap-2.5 transition-all shadow-sm cursor-pointer whitespace-nowrap"
              >
                {isBrowsing ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" /> Selecting...
                  </>
                ) : (
                  <>
                    <FolderOpen className="h-4 w-4" /> Browse Folders
                  </>
                )}
              </button>
              
              <div className="flex-1 flex items-center text-stone text-xs font-medium px-2 py-1 md:py-0 justify-center">
                OR
              </div>
              
              <form onSubmit={handleSetManualRoot} className="flex-1 flex gap-2">
                <input
                  type="text"
                  placeholder="Paste absolute path manually..."
                  value={manualPathInput}
                  onChange={(e) => setManualPathInput(e.target.value)}
                  className="flex-1 h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay"
                />
                <button
                  type="submit"
                  className="h-10 px-4 border border-line bg-cream hover:bg-hover rounded-lg text-sm font-medium text-graphite transition-all cursor-pointer"
                >
                  Set Root
                </button>
              </form>
            </div>

            {rootDir && (
              <div className="mt-2 text-xs text-graphite font-mono bg-cream px-3 py-2 rounded border border-line-soft break-all flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-sage flex-shrink-0" />
                <span>Active Root: <strong>{rootDir}</strong></span>
              </div>
            )}
          </div>

          {/* Subdirectory Checklist */}
          {rootDir && (
            <div className="bg-panel border border-line rounded-xl p-6 flex flex-col gap-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-mute">
                  Available Directories ({availableSubdirs.length})
                </h2>
                <button
                  onClick={() => fetchRootSubdirs(rootDir)}
                  className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-hover transition-colors"
                  title="Rescan root directory"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-graphite" />
                </button>
              </div>
              <p className="text-[13px] text-stone leading-relaxed">
                Select the repositories or project folders you want to track in the workspace. Any others will be left untracked.
              </p>

              {availableSubdirs.length === 0 ? (
                <div className="py-12 border border-dashed border-line rounded-lg text-center flex flex-col items-center gap-2">
                  <AlertCircle className="h-6 w-6 text-stone" />
                  <p className="text-sm text-graphite font-medium">No subdirectories found</p>
                  <p className="text-xs text-mute">Make sure the path contains subfolders and is a valid directory.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[350px] overflow-y-auto pr-1">
                  {availableSubdirs.map(name => {
                    const checked = selectedSubdirsToTrack.includes(name);
                    return (
                      <button
                        key={name}
                        onClick={() => toggleSubdirSelection(name)}
                        className={`p-3 border rounded-xl flex items-center gap-3 text-left transition-all cursor-pointer ${
                          checked 
                            ? "bg-cream border-clay shadow-sm" 
                            : "bg-cream/40 border-line hover:border-clay/50 hover:bg-cream"
                        }`}
                      >
                        <div className={`h-5 w-5 rounded-md border flex items-center justify-center transition-all ${
                          checked ? "bg-clay border-clay text-white" : "border-line bg-white"
                        }`}>
                          {checked && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13.5px] font-medium text-ink truncate">{name}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 border-t border-line pt-4 mt-2">
                {rootDir && trackedDirs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsSetupMode(false)}
                    className="h-10 px-5 border border-line bg-cream hover:bg-hover text-graphite font-medium text-sm rounded-lg transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveTracking}
                  disabled={isLoading}
                  className="h-10 px-5 bg-clay hover:bg-clay-dark text-white font-medium text-sm rounded-lg flex items-center gap-2 transition-all shadow-sm cursor-pointer"
                >
                  {isLoading ? "Saving..." : "Save Tracking Settings"}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-4 bg-danger-soft border border-danger/20 rounded-xl flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-danger flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-danger">Configuration Error</p>
                <p className="text-xs text-danger/80 mt-1">{error}</p>
              </div>
            </div>
          )}

        </div>
      </div>
    );
  }

  // 2. Active Workspace Dashboard (Directories, Files list, and Monaco Editor side-by-side)
  return (
    <div className="flex-1 flex overflow-hidden h-full">
      
      {/* Pane 1: Tracked Directory List (Left sidebar inside page) */}
      <aside className="w-64 flex-shrink-0 border-r border-line bg-panel flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="p-4 border-b border-line flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-mute flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5 text-clay" /> Tracked Folders
            </h2>
            <p className="text-[10px] text-stone mt-0.5 truncate max-w-[150px]" title={rootDir}>{rootDir}</p>
          </div>
          
          <button
            onClick={enterSetupMode}
            className="p-1.5 hover:bg-hover rounded-md text-stone hover:text-clay transition-all cursor-pointer"
            title="Manage directory tracking / Edit setup"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>

        {/* Directory list */}
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {trackedDirs.map(dir => {
            const isActive = activeDir === dir.name;
            const branch = dirBranchMap[dir.name];
            return (
              <button
                key={dir.name}
                onClick={() => handleSelectDirectory(dir.name, dir.path)}
                className={`w-full p-2.5 rounded-lg text-left flex flex-col gap-1 transition-all cursor-pointer ${
                  isActive 
                    ? "bg-cream border-l-3 border-clay shadow-sm" 
                    : "hover:bg-hover text-graphite border-l-3 border-transparent"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className={`text-[13px] truncate font-medium ${isActive ? "text-clay" : "text-ink"}`}>
                    {dir.name}
                  </span>
                  <ChevronRight className={`h-3 w-3 text-stone flex-shrink-0 transition-transform ${isActive ? "translate-x-0.5" : "opacity-0"}`} />
                </div>
                {branch && (
                  <div className="flex items-center gap-1 text-[10px] text-mute font-mono">
                    <GitBranch className="h-3 w-3 text-stone" />
                    <span className="truncate">{branch}</span>
                  </div>
                )}
              </button>
            );
          })}

          {trackedDirs.length === 0 && (
            <div className="text-center py-8 text-xs text-mute">
              No directories tracked. Click the gear icon to track some.
            </div>
          )}
        </div>
      </aside>

      {/* Main Workspace (Split middle pane for Directory Info & right pane for Monaco Editor) */}
      <main className="flex-1 flex overflow-hidden bg-cream">
        
        {/* Pane 2: Directory Detail view (Middle) */}
        <section className="flex-1 border-r border-line flex flex-col overflow-hidden min-w-[340px]">
          {activeDir ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              
              {/* Directory info banner */}
              <div className="p-5 border-b border-line flex-shrink-0 flex items-start justify-between bg-panel/30">
                <div className="min-w-0">
                  <h1 className="text-lg font-serif font-semibold text-ink flex items-center gap-2 truncate">
                    <Folder className="h-5 w-5 text-clay" /> {activeDir}
                  </h1>
                  
                  {/* Git branch status */}
                  {activeDirData && (
                    <div className="mt-1.5 flex items-center gap-2 text-xs">
                      {activeDirData.isGitRepo ? (
                        <div className="flex items-center gap-1 text-stone bg-chip/50 px-2 py-0.5 rounded-full font-mono text-[11px]">
                          <GitBranch className="h-3 w-3 text-clay" />
                          <span>{activeDirData.gitBranch || "no branch"}</span>
                        </div>
                      ) : (
                        <div className="text-[10px] text-mute font-medium uppercase tracking-[0.04em]">
                          Not a Git repository
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Git pull action */}
                {activeDirData?.isGitRepo && (
                  <button
                    onClick={handleGitPull}
                    disabled={isPulling}
                    className="h-8 px-3 bg-clay hover:bg-clay-dark disabled:bg-stone text-white font-medium text-xs rounded-lg flex items-center gap-1.5 transition-all shadow-sm cursor-pointer whitespace-nowrap"
                  >
                    <Download className={`h-3.5 w-3.5 ${isPulling ? "animate-bounce" : ""}`} />
                    {isPulling ? "Pulling..." : "Git Pull"}
                  </button>
                )}
              </div>

              {/* Sub-path configure & Scan input */}
              <div className="p-4 border-b border-line bg-panel/10 flex-shrink-0">
                <form onSubmit={handleScanPathUpdate} className="flex gap-2">
                  <div className="flex-1 flex flex-col gap-1">
                    <label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-mute">
                      Scan Sub-path Parameter
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. scripts/ or . (root)"
                      value={activeDirScanPath}
                      onChange={(e) => setActiveDirScanPath(e.target.value)}
                      className="h-9 bg-cream border border-line rounded-lg px-2.5 text-xs text-ink outline-none focus:border-clay"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isDirScanning}
                    className="self-end h-9 px-4 border border-line bg-cream hover:bg-hover rounded-lg text-xs font-semibold text-graphite transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <RefreshCw className={`h-3 w-3 ${isDirScanning ? "animate-spin" : ""}`} />
                    Scan Path
                  </button>
                </form>
              </div>

              {/* Git Pull Console Output Modal/Terminal */}
              {showPullTerminal && pullOutput && (
                <div className="p-4 border-b border-line bg-ink text-white font-mono text-xs flex flex-col gap-2 max-h-[160px] overflow-y-auto flex-shrink-0">
                  <div className="flex items-center justify-between border-b border-line/20 pb-1.5 text-mute">
                    <span className="flex items-center gap-1.5"><Terminal className="h-3.5 w-3.5 text-clay" /> Git Pull Output</span>
                    <button 
                      onClick={() => setShowPullTerminal(false)}
                      className="hover:text-white transition-colors cursor-pointer"
                    >
                      Close Console
                    </button>
                  </div>
                  <pre className="whitespace-pre-wrap select-text break-all">{pullOutput}</pre>
                </div>
              )}

              {/* Error messages */}
              {error && (
                <div className="m-4 p-3 bg-danger-soft border border-danger/20 rounded-lg flex items-start gap-2 flex-shrink-0">
                  <AlertCircle className="h-4.5 w-4.5 text-danger flex-shrink-0 mt-0.5" />
                  <span className="text-xs text-danger font-medium">{error}</span>
                </div>
              )}

              {/* Tab Selector */}
              <div className="flex border-b border-line bg-panel/30 flex-shrink-0 px-4">
                <button
                  type="button"
                  onClick={() => setActiveTab("explorer")}
                  className={`py-2.5 px-4 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                    activeTab === "explorer"
                      ? "border-clay text-clay"
                      : "border-transparent text-stone hover:text-graphite"
                  }`}
                >
                  Explorer
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("steps")}
                  className={`py-2.5 px-4 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                    activeTab === "steps"
                      ? "border-clay text-clay"
                      : "border-transparent text-stone hover:text-graphite"
                  }`}
                >
                  Steps
                </button>
              </div>

              {/* Pane 2.1 Scrollable Content (Explorer or Steps) */}
              <div className="flex-1 overflow-y-auto">
                {activeTab === "explorer" ? (
                  <div className="py-2">
                    {isDirScanning ? (
                      <div className="flex flex-col items-center justify-center gap-3 py-16 text-stone">
                        <RefreshCw className="h-6 w-6 animate-spin text-clay" />
                        <span className="text-xs font-medium">Scanning python scripts...</span>
                      </div>
                    ) : !activeDirData || !activeDirData.fileTree || activeDirData.fileTree.length === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                        <FileCode className="h-8 w-8 text-stone" />
                        <p className="text-sm text-graphite font-medium">No Python files found</p>
                        <p className="text-xs text-mute max-w-xs leading-relaxed">
                          We only scan for files ending in <code className="text-clay font-mono bg-chip/40 px-1 rounded">.py</code>. Try scanning a different sub-path or check folder files.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-mute mb-2 px-4">
                          Scanned Scripts Tree
                        </div>
                        <div className="flex flex-col">
                          {activeDirData.fileTree.map(node => (
                            <FileTreeItem
                              key={node.relativePath}
                              node={node}
                              depth={0}
                              selectedFile={selectedFile}
                              onSelectFile={handleReadFile}
                              onFocusDirectory={handleFocusDirectory}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-4 px-4 flex flex-col gap-3">
                    {/* Search box */}
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search BDD steps..."
                        value={stepsSearchQuery}
                        onChange={(e) => setStepsSearchQuery(e.target.value)}
                        className="w-full text-xs bg-cream/30 border border-line rounded-lg py-2 pl-8 pr-3 text-ink focus:outline-none focus:border-clay"
                      />
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-stone" />
                    </div>

                    {isStepsLoading ? (
                      <div className="flex flex-col items-center justify-center gap-3 py-16 text-stone">
                        <RefreshCw className="h-6 w-6 animate-spin text-clay" />
                        <span className="text-xs font-medium">Scanning BDD steps...</span>
                      </div>
                    ) : (() => {
                      const filteredSteps = bddSteps.filter(step => {
                        const query = stepsSearchQuery.toLowerCase();
                        return (
                          step.pattern.toLowerCase().includes(query) ||
                          step.stepType.toLowerCase().includes(query) ||
                          step.functionName.toLowerCase().includes(query)
                        );
                      });
                      
                      if (filteredSteps.length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                            <Terminal className="h-8 w-8 text-stone" />
                            <p className="text-sm text-graphite font-medium">No BDD steps found</p>
                            <p className="text-xs text-mute max-w-xs leading-relaxed">
                              No pytest-bdd steps matching search or decorators `@given`, `@when`, or `@then` found in this path.
                            </p>
                          </div>
                        );
                      }
                      
                      return (
                        <div className="flex flex-col gap-2.5">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-mute mb-1 px-1">
                            Scanned Steps ({filteredSteps.length})
                          </div>
                          {filteredSteps.map((step, idx) => {
                            const isSelected = selectedStep?.pattern === step.pattern && selectedStep?.stepType === step.stepType;
                            let typeColor = "bg-blue-50 text-blue-700 border-blue-100";
                            if (step.stepType.toLowerCase() === "when") {
                              typeColor = "bg-amber-50 text-amber-700 border-amber-100";
                            } else if (step.stepType.toLowerCase() === "then") {
                              typeColor = "bg-emerald-50 text-emerald-700 border-emerald-100";
                            }
                            
                            return (
                              <button
                                type="button"
                                key={idx}
                                onClick={() => handleSelectStep(step)}
                                className={`w-full text-left border rounded-xl p-3 flex flex-col gap-2 transition-all cursor-pointer ${
                                  isSelected 
                                    ? "bg-panel border-clay shadow-sm" 
                                    : "bg-cream/40 border-line hover:border-clay/50 hover:bg-cream"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border flex-shrink-0 ${typeColor}`}>
                                      {step.stepType}
                                    </span>
                                    <span className="text-[12.5px] font-semibold text-graphite font-mono break-all">
                                      {step.pattern}
                                    </span>
                                  </div>
                                  <span className="text-[9.5px] text-mute font-mono truncate max-w-[120px] flex-shrink-0 align-self-end mt-0.5" title={step.relativePath}>
                                    {step.fileName}
                                  </span>
                                </div>
                                
                                {step.parameters.length > 0 && (
                                  <div className="mt-2 pt-2 border-t border-line/60 flex flex-col gap-1">
                                    <div className="text-[9.5px] font-bold uppercase tracking-[0.06em] text-mute">
                                      Parameters:
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                                      {step.parameters.map((param, pIdx) => (
                                        <div
                                          key={pIdx}
                                          className="text-[10px] bg-panel/70 border border-line/40 rounded px-1.5 py-0.5 font-mono flex items-center gap-1"
                                        >
                                          <span className="text-ink font-semibold">{param.name}</span>
                                          <span className="text-stone font-light text-[9px]">({param.type})</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-stone gap-3">
              <FolderOpen className="h-10 w-10 text-stone" />
              <p className="text-sm font-medium text-graphite">Select a folder to begin</p>
              <p className="text-xs text-mute max-w-xs">
                Pick one of your tracked local directories from the left sidebar to browse Python scripts and Git branches.
              </p>
            </div>
          )}
        </section>

        {/* Pane 3: Monaco Code Editor Viewer (Right) */}
        <section className="flex-1 flex flex-col overflow-hidden min-w-[400px]">
          {selectedStep || selectedFile ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              
              {/* Editor Header */}
              <div className="p-4 border-b border-line bg-panel flex items-center justify-between flex-shrink-0">
                <div className="min-w-0 flex-1 pr-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-mute">
                    {selectedStep ? "Step Definition Viewer" : "File Code Viewer"}
                  </div>
                  <h2 className="text-xs font-mono text-ink truncate font-semibold mt-0.5" title={selectedStep ? `${selectedStep.stepType} ${selectedStep.pattern}` : selectedFile?.relativePath || ""}>
                    {selectedStep 
                      ? `${selectedStep.stepType} ${selectedStep.pattern}` 
                      : selectedFile?.relativePath}
                  </h2>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] font-mono text-mute bg-chip px-2 py-0.5 rounded">
                    Read-only
                  </span>
                  <button
                    onClick={() => {
                      setSelectedFile(null);
                      setSelectedStep(null);
                      setFileContent("");
                    }}
                    className="text-stone hover:text-ink text-xs font-semibold px-2 py-1 rounded hover:bg-hover transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Editor View */}
              <div className="flex-1 bg-white relative">
                {isFileLoading ? (
                  <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
                    <RefreshCw className="h-6 w-6 animate-spin text-clay" />
                  </div>
                ) : (
                  <Editor
                    height="100%"
                    defaultLanguage="python"
                    theme="vs-light"
                    value={fileContent}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 12.5,
                      fontFamily: "JetBrains Mono, Menlo, Monaco, Courier New, monospace",
                      lineNumbersMinChars: 3,
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                    }}
                  />
                )}
              </div>

            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-stone gap-3 bg-panel/30">
              <FileCode className="h-10 w-10 text-stone" />
              <p className="text-sm font-medium text-graphite font-semibold">No file or step selected</p>
              <p className="text-xs text-mute max-w-xs leading-relaxed">
                Select a Python script from the Explorer tree or a BDD step definition card to inspect its implementation code here.
              </p>
            </div>
          )}
        </section>

      </main>

    </div>
  );
}
