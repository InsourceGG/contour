import "server-only";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest, type ClientRequest } from "node:http";
import { isIP } from "node:net";
import { allowLocalProjects } from "./env";

export type FetchJson = (url: string, init: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string; maxBytes: number; timeoutMs: number }) => Promise<{ status: number; json: unknown; headers: Headers }>;

type Address = { address: string; family: number };

function isPublicAddress(address: string, family: number): boolean {
  if (isIP(address) !== family) return false;
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  // Canonicalize expanded IPv6 and dotted IPv4 tails before checking prefixes.
  let canonical: string;
  try { canonical = new URL(`https://[${address}]/`).hostname.slice(1, -1); }
  catch { return false; }
  const [left, right] = canonical.split("::");
  const before = left ? left.split(":").map(word => parseInt(word, 16)) : [];
  const after = right ? right.split(":").map(word => parseInt(word, 16)) : [];
  const words = right !== undefined ? [...before, ...Array(8 - before.length - after.length).fill(0), ...after] : before;
  if (words.length !== 8) return false;
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
    const v4 = [words[6] >>> 8, words[6] & 255, words[7] >>> 8, words[7] & 255].join(".");
    return isPublicAddress(v4, 4);
  }
  // Only global unicast; exclude documentation and tunneling ranges which can
  // translate into private IPv4 destinations (Teredo and 6to4).
  return (words[0] & 0xe000) === 0x2000 &&
    !(words[0] === 0x2001 && (words[1] === 0 || words[1] === 0xdb8)) && words[0] !== 0x2002;
}

/** Resolve once, validate every answer, and connect using only the pinned IP. */
export const pinnedFetchJson: FetchJson = async (input, init) => {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Invalid project URL"); }
  const local = allowLocalProjects() && url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if ((!local && url.protocol !== "https:") || url.username || url.password || input.includes("#") ||
    !Number.isSafeInteger(init.maxBytes) || init.maxBytes <= 0 || !Number.isSafeInteger(init.timeoutMs) || init.timeoutMs <= 0) {
    throw new Error("Invalid project request");
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let req: ClientRequest | undefined;
    const finishFailure = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Generic messages keep URL credentials, request headers and tokens out
      // of errors, including failures raised by Node's networking libraries.
      reject(new Error(message));
      req?.destroy();
    };
    const timer = setTimeout(() => finishFailure("Project request timed out"), init.timeoutMs);
    void (async () => {
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      let addresses: Address[];
      if (local) addresses = [{ address: "127.0.0.1", family: 4 }];
      else if (isIP(hostname)) addresses = [{ address: hostname, family: isIP(hostname) }];
      else addresses = await lookup(hostname, { all: true, verbatim: true });
      if (settled) return;
      if (!addresses.length || (!local && addresses.some(address => !isPublicAddress(address.address, address.family)))) {
        finishFailure("Project host is not public");
        return;
      }
      const pinned = addresses[0];
      const transport = local ? httpRequest : httpsRequest;
      req = transport(url, {
        method: init.method ?? "GET",
        headers: init.headers,
        agent: false,
        ...(!local ? { servername: hostname } : {}),
        lookup: (_host, options, callback) => {
          if (typeof options === "object" && options !== null && "all" in options && options.all) {
            (callback as unknown as (error: null, addresses: Address[]) => void)(null, [pinned]);
          } else callback(null, pinned.address, pinned.family);
        },
      }, response => {
        if (settled) { response.destroy(); return; }
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) { finishFailure("Project redirect rejected"); response.destroy(); return; }
        if (Number(response.headers["content-length"] ?? 0) > init.maxBytes) { finishFailure("Project response too large"); response.destroy(); return; }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (data: Buffer | string) => {
          if (settled) return;
          const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
          bytes += chunk.length;
          if (bytes > init.maxBytes) { finishFailure("Project response too large"); response.destroy(); return; }
          chunks.push(chunk);
        });
        response.on("aborted", () => finishFailure("Project response interrupted"));
        response.on("error", () => finishFailure("Project request failed"));
        response.on("end", () => {
          if (settled) return;
          try {
            const body = Buffer.concat(chunks).toString("utf8");
            const json: unknown = body ? JSON.parse(body) : null;
            const headers = new Headers();
            for (const [name, value] of Object.entries(response.headers)) {
              if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
              else if (typeof value === "string") headers.set(name, value);
            }
            settled = true;
            clearTimeout(timer);
            resolve({ status, json, headers });
          } catch { finishFailure("Invalid project JSON response"); }
        });
      });
      req.on("error", () => finishFailure("Project request failed"));
      req.end(init.body);
    })().catch(() => finishFailure("Project request failed"));
  });
};
