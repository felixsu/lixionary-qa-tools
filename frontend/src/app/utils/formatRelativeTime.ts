/** Formats an ISO timestamp as a short relative label ("2m ago", "3h ago").
 * `now` should come from useNowTick so re-renders stay in sync without
 * calling Date.now() directly during render. */
export function formatRelativeTime(iso: string | null | undefined, now: number): string {
  if (!iso || !now) return "never";
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
