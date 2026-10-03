import { pinnedFetchJson, type FetchJson } from "./pinned-fetch";

export class VerifyError extends Error {
  constructor(public code: string, message = "Project verification failed") { super(message); this.name = "VerifyError"; }
}

function metadataUrl(value: unknown): URL {
  if (typeof value !== "string") throw new VerifyError("INVALID_METADATA");
  let url: URL;
  try { url = new URL(value); } catch { throw new VerifyError("INVALID_URL"); }
  const local = process.env.CLOUD_ALLOW_LOCAL_PROJECTS === "1" && url.protocol === "http:" && url.hostname === "localhost";
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
): Promise<{ mcpResource: string; asIssuer: string; tokenEndpoint: string; authorizationEndpoint: string; revocationEndpoint: string | null }> {
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
  const metadata = await fetchDocument(`${issuerUrl.href.replace(/\/$/, "")}/.well-known/oauth-authorization-server`);
  if (metadata.issuer !== issuer) throw new VerifyError("ISSUER_MISMATCH");
  metadataUrl(metadata.token_endpoint);
  metadataUrl(metadata.authorization_endpoint);
  if (metadata.revocation_endpoint !== undefined && metadata.revocation_endpoint !== null) metadataUrl(metadata.revocation_endpoint);
  return {
    mcpResource: resource.resource as string,
    asIssuer: issuer as string,
    tokenEndpoint: metadata.token_endpoint as string,
    authorizationEndpoint: metadata.authorization_endpoint as string,
    revocationEndpoint: (metadata.revocation_endpoint as string | null | undefined) ?? null,
  };
}
