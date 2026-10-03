import "server-only";
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { adminClient } from "../supabase";
import { OAuthError } from "./errors";
import { MAX_REDIRECT_URI_LENGTH, validateRedirectUri } from "./redirect";

export type OAuthClient = {
  clientId: string;
  kind: "dcr" | "cimd" | "preregistered";
  clientName: string;
  redirectUris: string[];
  /** Host that published the client metadata document (CIMD only). */
  metadataHost: string | null;
  clientUri: string | null;
};

type ClientRow = {
  client_id: string;
  kind: OAuthClient["kind"];
  client_name: string;
  redirect_uris: string[];
  metadata: Record<string, unknown> | null;
  refreshed_at: string;
};

const MAX_CLIENT_NAME = 100;
const MAX_REDIRECT_URIS = 10;
const CIMD_MAX_BYTES = 16 * 1024;
const CIMD_TIMEOUT_MS = 5000;
const CIMD_DEFAULT_TTL_S = 3600;
const CIMD_MIN_TTL_S = 300;
const CIMD_MAX_TTL_S = 24 * 3600;
/** Serve a stale cached document for up to this long if a refetch fails. */
const CIMD_MAX_STALE_MS = 30 * 24 * 3600 * 1000;

function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  // Strip control and bidi-override characters; names are self-asserted and displayed.
  const s = value.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, "").trim();
  return s.length === 0 ? fallback : s.slice(0, MAX_CLIENT_NAME);
}

function optionalHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_REDIRECT_URI_LENGTH) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

function validateRedirectList(value: unknown, errorCode: "invalid_redirect_uri" | "invalid_client_metadata"): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REDIRECT_URIS) {
    throw new OAuthError(errorCode, `redirect_uris must be an array of 1 to ${MAX_REDIRECT_URIS} URLs`);
  }
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") throw new OAuthError(errorCode, "redirect_uris entries must be strings");
    const r = validateRedirectUri(v);
    if (!r.ok) throw new OAuthError(errorCode, r.reason);
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

function validateGrantAndResponseTypes(meta: Record<string, unknown>) {
  if (meta.grant_types !== undefined) {
    const g = meta.grant_types;
    if (
      !Array.isArray(g) ||
      g.length > 4 ||
      !g.every((x) => x === "authorization_code" || x === "refresh_token") ||
      !g.includes("authorization_code")
    ) {
      throw new OAuthError("invalid_client_metadata", "grant_types must include authorization_code and may include refresh_token only");
    }
  }
  if (meta.response_types !== undefined) {
    const r = meta.response_types;
    if (!Array.isArray(r) || r.length !== 1 || r[0] !== "code") {
      throw new OAuthError("invalid_client_metadata", 'response_types must be ["code"]');
    }
  }
}

function rowToClient(row: ClientRow): OAuthClient {
  const meta = row.metadata ?? {};
  return {
    clientId: row.client_id,
    kind: row.kind,
    clientName: row.client_name,
    redirectUris: row.redirect_uris,
    metadataHost: typeof meta.metadata_host === "string" ? meta.metadata_host : null,
    clientUri: typeof meta.client_uri === "string" ? meta.client_uri : null,
  };
}

// --------------------------------------------------------------- DCR (RFC 7591)

export async function registerDynamicClient(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new OAuthError("invalid_client_metadata", "Registration request must be a JSON object");
  }
  const meta = body as Record<string, unknown>;
  const redirectUris = validateRedirectList(meta.redirect_uris, "invalid_redirect_uri");
  validateGrantAndResponseTypes(meta);
  // Public clients only (MCP clients are native apps using PKCE). Per RFC 7591
  // §3.2.1 the server may replace requested metadata; the response always
  // states "none" and never includes a client_secret.
  const clientName = cleanName(meta.client_name, "Unnamed MCP client");
  const clientUri = optionalHttpsUrl(meta.client_uri);
  const clientId = `ctr_dcr_${randomBytes(24).toString("base64url")}`;
  const grantTypes = Array.isArray(meta.grant_types) ? (meta.grant_types as string[]) : ["authorization_code", "refresh_token"];
  const { data, error } = await adminClient()
    .from("oauth_clients")
    .insert({
      client_id: clientId,
      kind: "dcr",
      client_name: clientName,
      redirect_uris: redirectUris,
      metadata: {
        client_uri: clientUri,
        grant_types: grantTypes,
        application_type: meta.application_type === "web" ? "web" : "native",
      },
    })
    .select("created_at")
    .single();
  if (error || !data) throw new OAuthError("server_error", "Could not register client", 500);
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(new Date(data.created_at as string).getTime() / 1000),
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    ...(clientUri ? { client_uri: clientUri } : {}),
  };
}

// ----------------------------------------------- Client ID Metadata Documents

export function isCimdClientId(clientId: string): boolean {
  return clientId.startsWith("https://");
}

/** Validates the client_id URL itself (draft-ietf-oauth-client-id-metadata-document §3). */
function parseCimdUrl(clientId: string): URL {
  if (clientId.length > 512) throw new OAuthError("invalid_client", "client_id URL is too long");
  let u: URL;
  try {
    u = new URL(clientId);
  } catch {
    throw new OAuthError("invalid_client", "client_id is not a valid URL");
  }
  if (u.protocol !== "https:") throw new OAuthError("invalid_client", "client_id URL must use https");
  if (u.username || u.password || u.hash || clientId.includes("#")) {
    throw new OAuthError("invalid_client", "client_id URL must not contain credentials or a fragment");
  }
  if (u.pathname === "/" || u.pathname === "") throw new OAuthError("invalid_client", "client_id URL must contain a path");
  if (/(^|\/)\.\.?(\/|$)/.test(u.pathname)) throw new OAuthError("invalid_client", "client_id URL must not contain dot segments");
  if (u.port && u.port !== "443") throw new OAuthError("invalid_client", "client_id URL must use the default https port");
  if (isIP(u.hostname.replace(/^\[|\]$/g, ""))) throw new OAuthError("invalid_client", "client_id URL must use a DNS host name");
  if (u.toString() !== clientId) throw new OAuthError("invalid_client", "client_id URL must be in normalized form");
  return u;
}

function isPrivateAddress(addr: string, family: number): boolean {
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

async function assertPublicHost(hostname: string) {
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new OAuthError("invalid_client", "client_id host could not be resolved");
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address, a.family))) {
    throw new OAuthError("invalid_client", "client_id host resolves to a non-public address");
  }
}

async function readCapped(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max) throw new OAuthError("invalid_client", "Client metadata document is too large");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new OAuthError("invalid_client", "Client metadata document is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function ttlFromCacheControl(header: string | null): number {
  if (!header) return CIMD_DEFAULT_TTL_S;
  if (/no-store|no-cache/i.test(header)) return 0;
  const m = /max-age=(\d+)/i.exec(header);
  if (!m) return CIMD_DEFAULT_TTL_S;
  return Math.min(CIMD_MAX_TTL_S, Math.max(CIMD_MIN_TTL_S, Number(m[1])));
}

type CimdDoc = { clientName: string; redirectUris: string[]; clientUri: string | null; ttl: number };

async function fetchCimd(url: URL): Promise<CimdDoc> {
  await assertPublicHost(url.hostname);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      redirect: "error", // never follow redirects (SSRF / identity confusion)
      signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
      headers: { Accept: "application/json", "User-Agent": "Contour-Authorization-Server/0.3" },
      cache: "no-store",
    });
  } catch {
    throw new OAuthError("invalid_client", "Client metadata document could not be fetched");
  }
  if (res.status !== 200) throw new OAuthError("invalid_client", `Client metadata document fetch returned HTTP ${res.status}`);
  const text = await readCapped(res, CIMD_MAX_BYTES);
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new OAuthError("invalid_client", "Client metadata document is not valid JSON");
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new OAuthError("invalid_client", "Client metadata document must be a JSON object");
  const meta = doc as Record<string, unknown>;
  if (meta.client_id !== url.toString()) throw new OAuthError("invalid_client", "Client metadata client_id does not match its URL");
  if (typeof meta.client_name !== "string" || meta.client_name.trim() === "") {
    throw new OAuthError("invalid_client", "Client metadata document must include client_name");
  }
  if ("client_secret" in meta || "client_secret_expires_at" in meta) {
    throw new OAuthError("invalid_client", "Client metadata document must not contain a client secret");
  }
  const method = meta.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") {
    throw new OAuthError("invalid_client", 'Only token_endpoint_auth_method "none" is supported for metadata-document clients');
  }
  let redirectUris: string[];
  let clientUri: string | null;
  try {
    validateGrantAndResponseTypes(meta);
    redirectUris = validateRedirectList(meta.redirect_uris, "invalid_client_metadata");
    clientUri = optionalHttpsUrl(meta.client_uri);
  } catch (e) {
    throw new OAuthError("invalid_client", e instanceof Error ? `Client metadata: ${e.message}` : "Invalid client metadata");
  }
  return {
    clientName: cleanName(meta.client_name, url.hostname),
    redirectUris,
    clientUri,
    ttl: ttlFromCacheControl(res.headers.get("cache-control")),
  };
}

async function loadRow(clientId: string): Promise<ClientRow | null> {
  const { data, error } = await adminClient()
    .from("oauth_clients")
    .select("client_id, kind, client_name, redirect_uris, metadata, refreshed_at")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new OAuthError("server_error", "Client lookup failed", 500);
  return (data as ClientRow | null) ?? null;
}

async function resolveCimdClient(clientId: string, allowFetch: boolean): Promise<OAuthClient> {
  const url = parseCimdUrl(clientId);
  const cached = await loadRow(clientId);
  if (cached && cached.kind !== "cimd") throw new OAuthError("invalid_client", "Unknown client");
  const now = Date.now();
  const expiresAt = cached ? Date.parse(String(cached.metadata?.cache_expires_at ?? "")) : NaN;
  if (cached && (!allowFetch || (Number.isFinite(expiresAt) && expiresAt > now))) return rowToClient(cached);
  if (!allowFetch) throw new OAuthError("invalid_client", "Unknown client");

  let doc: CimdDoc;
  try {
    doc = await fetchCimd(url);
  } catch (e) {
    // Serve-stale: a transient fetch failure (e.g. bot protection on the
    // publisher's CDN) must not lock out a client whose document we have
    // already validated recently.
    if (cached && now - Date.parse(cached.refreshed_at) < CIMD_MAX_STALE_MS) {
      console.warn("[contour] CIMD refresh failed; using cached document for", url.hostname);
      return rowToClient(cached);
    }
    throw e;
  }
  const row = {
    client_id: clientId,
    kind: "cimd" as const,
    client_name: doc.clientName,
    redirect_uris: doc.redirectUris,
    metadata: {
      metadata_host: url.hostname,
      client_uri: doc.clientUri,
      cache_expires_at: new Date(now + doc.ttl * 1000).toISOString(),
    },
    refreshed_at: new Date(now).toISOString(),
  };
  const { error } = await adminClient().from("oauth_clients").upsert(row, { onConflict: "client_id" });
  if (error) throw new OAuthError("server_error", "Could not cache client metadata", 500);
  return rowToClient({ ...row, metadata: row.metadata });
}

/**
 * Resolves a client by id. URL-shaped ids are Client ID Metadata Documents
 * (fetched + cached when `allowFetch`), everything else must be a registered
 * DCR/pre-registered client.
 */
export async function getClient(clientId: unknown, opts: { allowFetch: boolean }): Promise<OAuthClient> {
  if (typeof clientId !== "string" || clientId.length < 8 || clientId.length > 512) {
    throw new OAuthError("invalid_client", "Unknown client");
  }
  if (isCimdClientId(clientId)) return resolveCimdClient(clientId, opts.allowFetch);
  const row = await loadRow(clientId);
  if (!row || row.kind === "cimd") throw new OAuthError("invalid_client", "Unknown client");
  return rowToClient(row);
}
