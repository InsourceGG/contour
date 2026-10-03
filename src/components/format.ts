/** Deterministic formatters (fixed locale + UTC) so server and client render identically. */

const LOCALE = "en-US";

export function formatMoney(value: number, currency = "USD", compact = false): string {
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString(LOCALE)} ${currency}`;
  }
}

export function formatNumber(value: number, digits = 0): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatPct(value: number | null | undefined, digits = 1, signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const s = `${formatNumber(Math.abs(value), digits)}%`;
  if (!signed) return value < 0 ? `-${s}` : s;
  return value > 0 ? `+${s}` : value < 0 ? `−${s}` : s;
}

/** Rates arrive as 0..1 fractions. */
export function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return formatPct(value * 100, 0);
}

const dateFmt = new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});
const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

function parse(iso: string): Date | null {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(iso: string): string {
  const d = parse(iso);
  return d ? dateFmt.format(d) : iso;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parse(iso);
  return d ? `${dateTimeFmt.format(d)} UTC` : iso;
}

export function formatTime(iso: string): string {
  const d = parse(iso);
  return d ? timeFmt.format(d) : iso;
}

/** Relative to a reference time supplied by the data (not the clock) to stay deterministic. */
export function formatAgo(iso: string, reference: string): string {
  const a = parse(iso);
  const b = parse(reference);
  if (!a || !b) return iso;
  const mins = Math.round((b.getTime() - a.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDate(iso);
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  return ms >= 1000 ? `${formatNumber(ms / 1000, 2)} s` : `${formatNumber(ms)} ms`;
}

const TENANTS: Record<string, string> = { acme: "Acme", globex: "Globex" };

/** Display name for a tenant id (memberships don't expose tenant names to browsers). */
export function tenantName(tenantId: string): string {
  return TENANTS[tenantId] ?? tenantId.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
