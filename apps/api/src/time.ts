export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Daily free limits and quotas reset at 00:00 UTC. */
export function secondsUntilUtcMidnight(date = new Date()): number {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.ceil((midnight - date.getTime()) / 1000);
}
