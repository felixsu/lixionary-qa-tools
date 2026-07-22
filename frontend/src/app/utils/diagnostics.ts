import { downloadJson } from "./collectionTransfer";

interface ConsoleEntry {
  level: "log" | "warn" | "error" | "info";
  message: string;
  timestamp: number;
}

export interface NetworkEntry {
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
  requestBody?: string;
  responseBody?: string;
  timestamp: number;
}

const CONSOLE_CAP = 200;
const NETWORK_CAP = 50;
const BODY_TRUNCATE_LENGTH = 2000;

const consoleRing: ConsoleEntry[] = [];
const networkRing: NetworkEntry[] = [];

const REDACT_KEY_PATTERN = /authorization|cookie|token|secret|api[-_]?key|password/i;

function pushCapped<T>(ring: T[], entry: T, cap: number): void {
  ring.push(entry);
  if (ring.length > cap) ring.shift();
}

// Wraps console methods once so recent output survives even if the user
// never opens devtools before hitting "Copy diagnostics". Guarded against
// Next.js Fast Refresh re-running this module and double-wrapping.
interface DiagCaptureWindow extends Window {
  __diagCaptureInit?: boolean;
}

export function initConsoleCapture(): void {
  if (typeof window === "undefined") return;
  const w = window as DiagCaptureWindow;
  if (w.__diagCaptureInit) return;
  w.__diagCaptureInit = true;

  (["log", "warn", "error", "info"] as const).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const message = args
        .map((a) => (typeof a === "string" ? a : safeStringify(a)))
        .join(" ");
      pushCapped(consoleRing, { level, message, timestamp: Date.now() }, CONSOLE_CAP);
      original(...args);
    };
  });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function recordNetworkEntry(entry: NetworkEntry): void {
  pushCapped(networkRing, entry, NETWORK_CAP);
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = REDACT_KEY_PATTERN.test(key) ? "[REDACTED]" : value;
  }
  return redacted;
}

export function truncateBody(body: string, max: number = BODY_TRUNCATE_LENGTH): string {
  if (!body) return body;
  return body.length > max ? `${body.slice(0, max)}…[truncated]` : body;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      redacted[key] = REDACT_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(v);
    }
    return redacted;
  }
  return value;
}

// Bodies (not just headers) can carry secrets — e.g. an auth response's
// access_token/refresh_token. Redact matching keys recursively before
// falling back to plain length-truncation for non-JSON payloads.
export function redactBody(body: string, max: number = BODY_TRUNCATE_LENGTH): string {
  if (!body) return body;
  try {
    const parsed = JSON.parse(body);
    return truncateBody(JSON.stringify(redactValue(parsed)), max);
  } catch {
    return truncateBody(body, max);
  }
}

function errorDetails(triggerError?: unknown): { message: string; stack?: string } | undefined {
  if (triggerError === undefined) return undefined;
  if (triggerError instanceof Error) {
    return { message: triggerError.message, stack: triggerError.stack };
  }
  return { message: String(triggerError) };
}

export function buildDiagnosticsBundle(triggerError?: unknown, appVersion?: string): string {
  return JSON.stringify(
    {
      appVersion: appVersion || "unknown",
      timestamp: new Date().toISOString(),
      error: errorDetails(triggerError),
      console: consoleRing.slice(-CONSOLE_CAP),
      network: networkRing.slice(-NETWORK_CAP),
    },
    null,
    2
  );
}

// Clipboard-first (matches the app's existing handleCopyId pattern); falls
// back to a file download if the webview denies clipboard access. Returns
// whether the clipboard path succeeded, so callers can tailor their toast.
export async function copyDiagnostics(triggerError?: unknown, appVersion?: string): Promise<boolean> {
  const json = buildDiagnosticsBundle(triggerError, appVersion);
  try {
    await navigator.clipboard.writeText(json);
    return true;
  } catch {
    downloadJson(json, `diagnostics-${Date.now()}.json`);
    return false;
  }
}

initConsoleCapture();
