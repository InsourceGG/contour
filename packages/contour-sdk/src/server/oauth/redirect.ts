import "server-only";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const MAX_REDIRECT_URI_LENGTH = 512;

function parse(uri: string): URL | null {
  if (typeof uri !== "string" || uri.length === 0 || uri.length > MAX_REDIRECT_URI_LENGTH) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(uri)) return null;
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

export function isLoopbackRedirect(uri: string): boolean {
  const u = parse(uri);
  return !!u && u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);
}

/**
 * Registration-time validation (DCR and CIMD documents): https anywhere, or
 * http on a loopback host only (RFC 8252 §7.3). No fragments, no userinfo,
 * no custom schemes.
 */
export function validateRedirectUri(uri: string): { ok: true } | { ok: false; reason: string } {
  const u = parse(uri);
  if (!u) return { ok: false, reason: "redirect_uri must be an absolute URL of at most 512 characters" };
  if (u.hash || uri.includes("#")) return { ok: false, reason: "redirect_uri must not contain a fragment" };
  if (u.username || u.password) return { ok: false, reason: "redirect_uri must not contain credentials" };
  if (u.protocol === "https:") return { ok: true };
  if (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname)) return { ok: true };
  return { ok: false, reason: "redirect_uri must use https, or http on localhost/127.0.0.1/[::1]" };
}

/**
 * Authorization-time match. Exact string comparison, except that for http
 * loopback redirects the port is ignored (RFC 8252 §7.3): native clients such
 * as Claude Code publish `http://localhost/callback` and listen on an
 * ephemeral port. Scheme, host, path and query must still match exactly.
 */
export function matchRedirectUri(requested: string, registered: readonly string[]): boolean {
  if (registered.includes(requested)) return true;
  const r = parse(requested);
  if (!r || r.protocol !== "http:" || !LOOPBACK_HOSTS.has(r.hostname) || r.hash) return false;
  return registered.some((reg) => {
    const g = parse(reg);
    return (
      !!g &&
      g.protocol === "http:" &&
      g.hostname === r.hostname &&
      g.pathname === r.pathname &&
      g.search === r.search &&
      !g.username &&
      !r.username
    );
  });
}
