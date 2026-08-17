/**
 * Human-readable duration for the second-granularity ETAs this codebase
 * passes around (RouteOptimizationService.estimatedSeconds and friends).
 * Shared so a several-minute retrieval doesn't render as a raw 3-digit
 * second count in one place while another formats it properly.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
