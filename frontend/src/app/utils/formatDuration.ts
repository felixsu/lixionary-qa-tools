// Compact human duration for the flow-executions table: sub-second runs keep
// millisecond precision, sub-minute runs get one decimal, longer runs switch
// to m/s (durations here are API-call scale — hours don't happen in practice).
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (seconds === 60) return `${minutes + 1}m 0s`;
  return `${minutes}m ${seconds}s`;
}
