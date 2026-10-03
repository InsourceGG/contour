import "server-only";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

/**
 * Outbound HTTPS GET to a URL supplied by an untrusted party (client metadata
 * documents, project verification). The host is resolved once, every address
 * must be public, and the connection is pinned to the validated address so a
 * DNS rebind between the check and the connect cannot reach a private
 * network. TLS still verifies the real host name via SNI. Redirects are never
 * followed and the body is capped.
 */

export type PinnedFetchFailure = "invalid_url" | "unresolvable" | "private_address" | "fetch_failed" | "too_large";

export class PinnedFetchError extends Error {
  constructor(public readonly reason: PinnedFetchFailure) {
    super(`pinned fetch failed: ${reason}`);
    this.name = "PinnedFetchError";
  }
}

export function isPrivateAddress(addr: string, family: number): boolean {
  if (family === 4) {
    const [a, b] = addr.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v = addr.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("::ffff:")) {
    const v4 = v.slice(7);
    return isIP(v4) === 4 ? isPrivateAddress(v4, 4) : true;
  }
  return (
    v.startsWith("fc") || v.startsWith("fd") || // unique local
    /^fe[89ab]/.test(v) || // link-local
    v.startsWith("ff") || // multicast
    v.startsWith("64:ff9b:") || // NAT64
    v.startsWith("2001:db8") // documentation
  );
}

/** Resolves once and returns the validated public address to pin the connection to. */
async function resolvePublicHost(hostname: string): Promise<{ address: string; family: number }> {
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new PinnedFetchError("unresolvable");
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address, a.family))) {
    throw new PinnedFetchError("private_address");
  }
  return addrs[0];
}

/** HTTPS GET pinned to the pre-validated address. No redirects are followed. */
function pinnedGet(
  url: URL,
  pinned: { address: string; family: number },
  opts: { maxBytes: number; timeoutMs: number },
): Promise<{ status: number; body: Buffer; headers: Headers }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "GET",
        servername: url.hostname,
        headers: { Accept: "application/json", "User-Agent": "Contour-Authorization-Server/0.3" },
        timeout: opts.timeoutMs,
        lookup: (_host, _opts, cb) => {
          const all = typeof _opts === "object" && _opts !== null && (_opts as { all?: boolean }).all;
          if (all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [pinned]);
          else cb(null, pinned.address, pinned.family);
        },
      },
      (res) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") headers.set(k, v);
        const declared = Number(headers.get("content-length") ?? "0");
        if (declared > opts.maxBytes) {
          req.destroy(new PinnedFetchError("too_large"));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (c: Buffer) => {
          total += c.length;
          if (total > opts.maxBytes) {
            req.destroy(new PinnedFetchError("too_large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), headers }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

/**
 * Pinned-address HTTPS GET that parses a JSON body.
 *
 * Throws `PinnedFetchError` when the URL is not https, the host does not
 * resolve or resolves to any non-public address, the connection fails or
 * times out, or the body exceeds `maxBytes`. Any HTTP status is returned
 * as-is (3xx is never followed). `json` is `undefined` when the body is not
 * valid JSON, so callers can tell "not JSON" apart from a JSON `null`.
 */
export async function pinnedFetchJson(
  url: string,
  opts: { maxBytes: number; timeoutMs: number },
): Promise<{ status: number; json: unknown; headers: Headers }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new PinnedFetchError("invalid_url");
  }
  if (u.protocol !== "https:" || u.username || u.password) throw new PinnedFetchError("invalid_url");
  const pinned = await resolvePublicHost(u.hostname.replace(/^\[|\]$/g, ""));
  let res: { status: number; body: Buffer; headers: Headers };
  try {
    res = await pinnedGet(u, pinned, opts);
  } catch (e) {
    if (e instanceof PinnedFetchError) throw e;
    throw new PinnedFetchError("fetch_failed");
  }
  let json: unknown;
  try {
    json = JSON.parse(res.body.toString("utf8"));
  } catch {
    json = undefined;
  }
  return { status: res.status, json, headers: res.headers };
}
