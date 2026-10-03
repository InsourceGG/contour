import "server-only";
import { ContourError, type VerifiedContext } from "@/sdk/types";
import { DEFAULT_SURFACE } from "../context";
import { env } from "../env";
import { McpAuthError, OAuthError } from "../oauth/errors";
import { readBodyCapped } from "../oauth/http";
import { requireMcpScope, resolveMcpContext } from "../oauth/resolve";
import { findTool, listToolsPayload, SERVER_INSTRUCTIONS } from "./tools";

/**
 * Stateless Streamable HTTP MCP endpoint, implemented directly on JSON-RPC 2.0.
 *
 * Dual-era (MCP 2026-07-28 "Versioning: Backward Compatibility"):
 *  - Modern requests carry `_meta["io.modelcontextprotocol/protocolVersion"]`
 *    and mirrored headers (MCP-Protocol-Version, Mcp-Method, Mcp-Name), which
 *    are validated against the body. `server/discover` is supported.
 *  - Legacy clients (2025-03-26 .. 2025-11-25) use `initialize`; we never mint
 *    a session (Mcp-Session-Id is optional for servers), so every POST stands
 *    alone. Batches are accepted for 2025-03-26 compatibility.
 * Every method requires a valid bearer token so clients discover OAuth via 401.
 * Responses are always application/json (SSE is never needed: no streaming).
 */

export const SERVER_INFO = { name: "contour", version: "0.3.0" } as const;
export const MODERN_VERSIONS = ["2026-07-28"] as const;
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
const ALL_VERSIONS: readonly string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
const LATEST_LEGACY = LEGACY_VERSIONS[0];

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 20;

const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CAPS = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER = "io.modelcontextprotocol/serverInfo";

// JSON-RPC / MCP error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_VERSION = -32022;
// Application-defined (outside the JSON-RPC reserved range).
const APP_UNAUTHORIZED = -31401;
const APP_FORBIDDEN = -31403;
const APP_UNAVAILABLE = -31503;

type JsonRpcId = string | number | null;
type Outcome = { status: number; body: unknown | null; headers?: Record<string, string> };
type AuthState = { ok: true; ctx: VerifiedContext } | { ok: false; disabled: ContourError };

const BASE_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function rpcResult(id: JsonRpcId, result: Record<string, unknown>, modern: boolean) {
  const r = modern ? { resultType: "complete", ...result, _meta: { [META_SERVER]: SERVER_INFO } } : result;
  return { jsonrpc: "2.0", id, result: r };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// ------------------------------------------------------------------ origin

function isAllowedOrigin(origin: string | null, request: Request): boolean {
  if (origin === null) return true; // non-browser clients (Claude Code) send none
  if (origin === "null") return false;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (o.origin === new URL(env.appUrl).origin || o.origin === new URL(request.url).origin) return true;
  return (o.protocol === "http:" || o.protocol === "https:") && ["localhost", "127.0.0.1", "[::1]"].includes(o.hostname);
}

// ------------------------------------------------------------- auth errors

function authErrorResponse(e: McpAuthError, id: JsonRpcId): Response {
  return json(e.status, rpcError(id, e.status === 401 ? APP_UNAUTHORIZED : APP_FORBIDDEN, e.description), {
    "WWW-Authenticate": e.challenge(),
  });
}

// ------------------------------------------------------------ tools/call

function toolResult(result: unknown) {
  const structured = isObject(result) ? result : { result };
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: structured };
}

function toolError(error: Record<string, unknown>) {
  const payload = { error };
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload, isError: true };
}

async function callTool(params: Record<string, unknown>, auth: AuthState, request: Request, inBatch: boolean) {
  const tool = findTool(params.name);
  if (!tool) return { error: { code: INVALID_PARAMS, message: `Unknown tool: ${String(params.name).slice(0, 64)}` } };
  if (params.arguments !== undefined && !isObject(params.arguments)) {
    return { error: { code: INVALID_PARAMS, message: "Tool arguments must be an object" } };
  }
  if (!auth.ok) return { result: toolError(auth.disabled.toJSON()) };

  const parsed = tool.args.safeParse(params.arguments ?? {});
  if (!parsed.success) {
    return {
      result: toolError({
        code: "INVALID_INPUT",
        message: "Arguments do not match the tool's input schema (unknown keys such as tenant or user identifiers are rejected)",
        issues: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
    };
  }
  const args = parsed.data as { surfaceId: string } & Record<string, unknown>;
  try {
    // The grant must cover the requested surface; identity still comes from the token.
    const ctx = args.surfaceId === auth.ctx.surfaceId ? auth.ctx : await resolveMcpContext(request, args.surfaceId);
    requireMcpScope(ctx, tool.scope);
    return { result: toolResult(await tool.run(ctx, args)) };
  } catch (e) {
    if (e instanceof McpAuthError) {
      if (!inBatch) throw e; // surfaces as HTTP 401/403 with a WWW-Authenticate challenge
      return { result: toolError({ code: e.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", message: e.description }) };
    }
    if (e instanceof ContourError) return { result: toolError(e.toJSON()) };
    console.error("[contour] mcp tool failed", tool.name, e instanceof Error ? e.message : "unknown");
    return { result: toolError({ code: "INTERNAL", message: "Internal error" }) };
  }
}

// --------------------------------------------------------------- dispatch

function decodeHeaderValue(v: string): string {
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(v);
  return m ? Buffer.from(m[1], "base64").toString("utf8") : v;
}

/** Modern-era header/body consistency checks. Returns an error outcome or null. */
function validateModern(msg: Record<string, unknown>, params: Record<string, unknown>, request: Request): Outcome | null {
  const id = msg.id as JsonRpcId;
  const meta = params._meta as Record<string, unknown>;
  const version = meta[META_VERSION];
  if (typeof version !== "string" || !(MODERN_VERSIONS as readonly string[]).includes(version)) {
    return {
      status: 400,
      body: rpcError(id, UNSUPPORTED_VERSION, "Unsupported protocol version", { supported: ALL_VERSIONS, requested: version }),
    };
  }
  const h = request.headers;
  const headerVersion = h.get("mcp-protocol-version");
  if (headerVersion !== version) {
    return { status: 400, body: rpcError(id, HEADER_MISMATCH, "Header mismatch: MCP-Protocol-Version is missing or differs from _meta") };
  }
  if (h.get("mcp-method") !== msg.method) {
    return { status: 400, body: rpcError(id, HEADER_MISMATCH, "Header mismatch: Mcp-Method is missing or differs from the body method") };
  }
  if (msg.method === "tools/call") {
    const name = h.get("mcp-name");
    if (name === null || decodeHeaderValue(name) !== params.name) {
      return { status: 400, body: rpcError(id, HEADER_MISMATCH, "Header mismatch: Mcp-Name is missing or differs from params.name") };
    }
  }
  if (!isObject(meta[META_CAPS])) {
    return { status: 400, body: rpcError(id, INVALID_PARAMS, `Missing required _meta field ${META_CAPS}`) };
  }
  return null;
}

async function processMessage(raw: unknown, auth: AuthState, request: Request, inBatch: boolean): Promise<Outcome> {
  if (!isObject(raw) || raw.jsonrpc !== "2.0") {
    return { status: 400, body: rpcError(null, INVALID_REQUEST, "Invalid JSON-RPC 2.0 message") };
  }
  const msg = raw;
  // Client-sent responses are not part of this protocol; accept and ignore.
  if (msg.method === undefined && ("result" in msg || "error" in msg)) return { status: 202, body: null };
  if (typeof msg.method !== "string" || msg.method.length > 128) {
    return { status: 400, body: rpcError(null, INVALID_REQUEST, "Missing method") };
  }
  // Notifications (e.g. notifications/initialized): accepted, no body.
  if (!("id" in msg)) return { status: 202, body: null };
  const id = msg.id;
  if (typeof id !== "string" && typeof id !== "number") {
    return { status: 400, body: rpcError(null, INVALID_REQUEST, "Request id must be a string or number") };
  }
  if (msg.params !== undefined && !isObject(msg.params)) {
    return { status: 400, body: rpcError(id, INVALID_PARAMS, "params must be an object") };
  }
  const params = (msg.params ?? {}) as Record<string, unknown>;
  const modern = isObject(params._meta) && params._meta[META_VERSION] !== undefined;

  if (modern) {
    if (inBatch) return { status: 400, body: rpcError(id, INVALID_REQUEST, "Batching is not supported for this protocol version") };
    const invalid = validateModern(msg, params, request);
    if (invalid) return invalid;
  } else if (msg.method !== "initialize") {
    const hv = request.headers.get("mcp-protocol-version");
    if (hv !== null && !ALL_VERSIONS.includes(hv)) {
      return { status: 400, body: rpcError(id, INVALID_REQUEST, `Unsupported MCP-Protocol-Version; supported: ${ALL_VERSIONS.join(", ")}`) };
    }
  }

  if (!auth.ok && msg.method !== "tools/call") {
    return { status: 403, body: rpcError(id, APP_FORBIDDEN, auth.disabled.message, auth.disabled.toJSON()) };
  }

  switch (msg.method) {
    case "initialize": {
      if (modern) break;
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = ALL_VERSIONS.includes(requested) ? requested : LATEST_LEGACY;
      return {
        status: 200,
        body: rpcResult(
          id,
          {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: SERVER_INSTRUCTIONS,
          },
          false,
        ),
      };
    }
    case "server/discover":
      return {
        status: 200,
        body: rpcResult(
          id,
          {
            supportedVersions: ALL_VERSIONS,
            capabilities: { tools: { listChanged: false } },
            instructions: SERVER_INSTRUCTIONS,
            ...(modern ? {} : { serverInfo: SERVER_INFO }),
          },
          modern,
        ),
      };
    case "ping":
      return { status: 200, body: rpcResult(id, {}, modern) };
    case "tools/list":
      return { status: 200, body: rpcResult(id, { tools: listToolsPayload() }, modern) };
    case "tools/call": {
      const out = await callTool(params, auth, request, inBatch);
      if ("error" in out && out.error) return { status: 200, body: rpcError(id, out.error.code, out.error.message) };
      return { status: 200, body: rpcResult(id, out.result as Record<string, unknown>, modern) };
    }
  }
  return {
    status: modern ? 404 : 200,
    body: rpcError(id, METHOD_NOT_FOUND, `Method not found: ${msg.method.slice(0, 64)}`),
  };
}

// ------------------------------------------------------------------ entry

export async function handleMcpPost(request: Request): Promise<Response> {
  if (!isAllowedOrigin(request.headers.get("origin"), request)) {
    return json(403, rpcError(null, INVALID_REQUEST, "Origin not allowed"));
  }
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/json")) {
    return json(415, rpcError(null, INVALID_REQUEST, "Content-Type must be application/json"));
  }
  let text: string;
  try {
    text = await readBodyCapped(request, MAX_BODY_BYTES);
  } catch (e) {
    if (e instanceof OAuthError && e.status === 413) return json(413, rpcError(null, INVALID_REQUEST, "Request body too large"));
    throw e;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return json(400, rpcError(null, PARSE_ERROR, "Parse error"));
  }
  const firstId: JsonRpcId = isObject(payload) && (typeof payload.id === "string" || typeof payload.id === "number") ? payload.id : null;

  // Authenticate every request before dispatch (identity never comes from the body).
  let auth: AuthState;
  try {
    auth = { ok: true, ctx: await resolveMcpContext(request, DEFAULT_SURFACE) };
  } catch (e) {
    if (e instanceof McpAuthError) return authErrorResponse(e, firstId);
    if (e instanceof ContourError && e.code === "AGENT_ACCESS_DISABLED") auth = { ok: false, disabled: e };
    else {
      console.error("[contour] mcp auth failed", e instanceof Error ? e.message : "unknown");
      return json(503, rpcError(firstId, APP_UNAVAILABLE, "Authorization check temporarily unavailable"), { "Retry-After": "5" });
    }
  }

  try {
    if (Array.isArray(payload)) {
      if (payload.length === 0 || payload.length > MAX_BATCH) {
        return json(400, rpcError(null, INVALID_REQUEST, `Batch must contain 1 to ${MAX_BATCH} messages`));
      }
      const outcomes: Outcome[] = [];
      for (const m of payload) outcomes.push(await processMessage(m, auth, request, true));
      const bodies = outcomes.filter((o) => o.body !== null).map((o) => o.body);
      return bodies.length === 0 ? new Response(null, { status: 202 }) : json(200, bodies);
    }
    const out = await processMessage(payload, auth, request, false);
    return out.body === null ? new Response(null, { status: out.status }) : json(out.status, out.body, out.headers);
  } catch (e) {
    if (e instanceof McpAuthError) return authErrorResponse(e, firstId);
    console.error("[contour] mcp request failed", e instanceof Error ? e.message : "unknown");
    return json(500, rpcError(firstId, INTERNAL_ERROR, "Internal error"));
  }
}

export function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
