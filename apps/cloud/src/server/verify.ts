import "server-only";
import { pinnedFetchJson, type FetchJson } from "./pinned-fetch";
import { allowLocalProjects } from "./env";

export class VerifyError extends Error {
  constructor(public code: string, message = "Project verification failed") { super(message); this.name = "VerifyError"; }
}

function metadataUrl(value: unknown): URL {
  if (typeof value !== "string") throw new VerifyError("INVALID_METADATA");
  let url: URL;
  try { url = new URL(value); } catch { throw new VerifyError("INVALID_URL"); }
  const local = allowLocalProjects() && url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if ((!local && url.protocol !== "https:") || url.username || url.password || value.includes("#")) throw new VerifyError("INVALID_URL");
  return url;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VerifyError("INVALID_METADATA");
  return value as Record<string, unknown>;
}

export async function verifyProject(
  p: { baseUrl: string; projectId: string; nonce: string },
  fetchJson: FetchJson = pinnedFetchJson,
): Promise<{ mcpResource: string; asIssuer: string; tokenEndpoint: string; authorizationEndpoint: string; revocationEndpoint: string | null; registrationEndpoint: string | null }> {
  const base = metadataUrl(p.baseUrl);
  if (base.search) throw new VerifyError("INVALID_URL");
  async function fetchDocument(url: string): Promise<Record<string, unknown>> {
    let response: Awaited<ReturnType<FetchJson>>;
    try { response = await fetchJson(url, { maxBytes: 262144, timeoutMs: 8000 }); }
    catch { throw new VerifyError("PROJECT_UNAVAILABLE", "Project metadata is unavailable"); }
    if (response.status >= 300 && response.status < 400) throw new VerifyError("REDIRECT_REJECTED");
    if (response.status !== 200) throw new VerifyError("PROJECT_UNAVAILABLE", "Project metadata is unavailable");
    return object(response.json);
  }
  const basePath = base.href.replace(/\/$/, "");
  const identity = await fetchDocument(`${basePath}/.well-known/contour-project.json`);
  if (identity.projectId !== p.projectId) throw new VerifyError("PROJECT_MISMATCH");
  if (identity.nonce !== p.nonce) throw new VerifyError("NONCE_MISMATCH");
  const resource = await fetchDocument(`${basePath}/.well-known/oauth-protected-resource/api/mcp`);
  const resourceUrl = metadataUrl(resource.resource);
  if (resourceUrl.origin !== base.origin) throw new VerifyError("RESOURCE_ORIGIN_MISMATCH");
  if (!Array.isArray(resource.authorization_servers) || resource.authorization_servers.length === 0) throw new VerifyError("INVALID_METADATA");
  const issuer = resource.authorization_servers[0];
  const issuerUrl = metadataUrl(issuer);
  if (issuerUrl.search) throw new VerifyError("INVALID_URL");
  if (issuerUrl.origin !== base.origin) throw new VerifyError("ISSUER_ORIGIN_MISMATCH");
  const metadata = await fetchDocument(`${issuerUrl.href.replace(/\/$/, "")}/.well-known/oauth-authorization-server`);
  if (metadata.issuer !== issuer) throw new VerifyError("ISSUER_MISMATCH");
  for (const endpoint of [metadata.token_endpoint, metadata.authorization_endpoint]) {
    if (metadataUrl(endpoint).origin !== base.origin) throw new VerifyError("ENDPOINT_ORIGIN_MISMATCH");
  }
  if (metadata.revocation_endpoint !== undefined && metadata.revocation_endpoint !== null &&
    metadataUrl(metadata.revocation_endpoint).origin !== base.origin) throw new VerifyError("ENDPOINT_ORIGIN_MISMATCH");
  if (metadata.registration_endpoint !== undefined && metadata.registration_endpoint !== null) metadataUrl(metadata.registration_endpoint);
  return {
    mcpResource: resource.resource as string,
    asIssuer: issuer as string,
    tokenEndpoint: metadata.token_endpoint as string,
    authorizationEndpoint: metadata.authorization_endpoint as string,
    revocationEndpoint: (metadata.revocation_endpoint as string | null | undefined) ?? null,
    registrationEndpoint: (metadata.registration_endpoint as string | null | undefined) ?? null,
  };
}
