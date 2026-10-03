export class RateLimitError extends Error {
  readonly code = 'RATE_LIMITED';
  constructor() { super('Too many attempts. Wait a minute and try again.'); }
}

const windows = new Map<string, { count: number; expires: number }>();
/** A bounded process-local guard. Distributed deployments need a shared limiter. */
export function rateLimit(user: string, action: 'link' | 'verify' | 'mcp' | 'project', now = Date.now()): void {
  const key = `${action}:${user}`;
  let window = windows.get(key);
  if (!window || window.expires <= now) {
    if (windows.size >= 10_000) {
      for (const [entry, value] of windows) if (value.expires <= now) windows.delete(entry);
      // Fail closed instead of evicting live windows and resetting user limits.
      if (windows.size >= 10_000 && !windows.has(key)) throw new RateLimitError();
    }
    window = { count: 0, expires: now + 60_000 };
    windows.set(key, window);
  }
  const limit = { verify: 5, link: 10, mcp: 120, project: 60 }[action];
  if (++window.count > limit) throw new RateLimitError();
  if (windows.size > 10_000) for (const [entry, value] of windows) if (value.expires <= now) windows.delete(entry);
}
