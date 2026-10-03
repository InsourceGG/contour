import "server-only";
import { OAuthError } from "./errors";

/** Public, credential-less CORS for AS endpoints (no cookies are ever used there). */
export const PUBLIC_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "600",
} as const;

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/** Reads a request body as text, rejecting anything larger than `max` bytes. */
export async function readBodyCapped(request: Request, max: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) throw new OAuthError("invalid_request", "Request body too large", 413);
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new OAuthError("invalid_request", "Request body too large", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Parses an application/x-www-form-urlencoded token/revocation request. */
export async function readFormBody(request: Request, max = 8 * 1024): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    throw new OAuthError("invalid_request", "Content-Type must be application/x-www-form-urlencoded");
  }
  return new URLSearchParams(await readBodyCapped(request, max));
}

/**
 * Public-client identification: client_id in the body, or HTTP Basic with an
 * empty secret (some clients always send Basic). Secrets are never accepted.
 */
export function publicClientId(request: Request, params: URLSearchParams): string {
  const bodyIds = params.getAll("client_id");
  if (bodyIds.length > 1) throw new OAuthError("invalid_request", "Duplicate client_id parameter");
  let basicId: string | undefined;
  const auth = request.headers.get("authorization");
  if (auth) {
    const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(auth);
    if (!m) throw new OAuthError("invalid_client", "Unsupported client authentication", 401);
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    let id: string;
    try {
      id = decodeURIComponent(idx >= 0 ? decoded.slice(0, idx) : decoded);
    } catch {
      throw new OAuthError("invalid_client", "Malformed client credentials", 401);
    }
    const secret = idx >= 0 ? decoded.slice(idx + 1) : "";
    if (secret !== "") throw new OAuthError("invalid_client", "This server only supports public clients (token_endpoint_auth_method=none)", 401);
    basicId = id;
  }
  if (params.get("client_secret")) {
    throw new OAuthError("invalid_client", "This server only supports public clients (token_endpoint_auth_method=none)", 401);
  }
  const id = bodyIds[0] ?? basicId;
  if (bodyIds[0] && basicId && bodyIds[0] !== basicId) throw new OAuthError("invalid_request", "Conflicting client_id values");
  if (!id) throw new OAuthError("invalid_client", "client_id is required", 401);
  return id;
}
