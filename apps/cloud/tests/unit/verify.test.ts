import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyProject, VerifyError } from "../../src/server/verify";
import type { FetchJson } from "../../src/server/pinned-fetch";

const project = { baseUrl: "https://project.example", projectId: "project-id", nonce: "nonce" };
const documents = [
  { projectId: project.projectId, nonce: project.nonce },
  { resource: "https://project.example/api/mcp", authorization_servers: ["https://auth.example"] },
  { issuer: "https://auth.example", token_endpoint: "https://auth.example/token", authorization_endpoint: "https://auth.example/authorize", revocation_endpoint: "https://auth.example/revoke" },
];
function fetcher(docs: unknown[] = documents): ReturnType<typeof vi.fn<FetchJson>> {
  let index = 0;
  return vi.fn<FetchJson>(async () => ({ status: 200, json: docs[index++], headers: new Headers() }));
}
afterEach(() => vi.unstubAllEnvs());
describe("verifyProject", () => {
  it("verifies identity, resource and discovered issuer metadata", async () => {
    const fetch = fetcher();
    expect(await verifyProject(project, fetch)).toEqual({ mcpResource: documents[1].resource, asIssuer: documents[2].issuer, tokenEndpoint: documents[2].token_endpoint, authorizationEndpoint: documents[2].authorization_endpoint, revocationEndpoint: documents[2].revocation_endpoint });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://project.example/.well-known/contour-project.json", "https://project.example/.well-known/oauth-protected-resource/api/mcp", "https://auth.example/.well-known/oauth-authorization-server"]);
    for (const [, init] of fetch.mock.calls) expect(init).toMatchObject({ maxBytes: 262144, timeoutMs: 8000 });
  });
  it("rejects nonce mismatch", async () => {
    await expect(verifyProject(project, fetcher([{ ...documents[0], nonce: "wrong" }]))).rejects.toMatchObject({ code: "NONCE_MISMATCH" });
  });
  it("rejects project ID mismatch", async () => {
    await expect(verifyProject(project, fetcher([{ ...documents[0], projectId: "wrong" }]))).rejects.toMatchObject({ code: "PROJECT_MISMATCH" });
  });
  it.each(["http://project.example", "https://user:password@project.example", "https://project.example/#", "ftp://project.example"])("rejects unsafe base URL %s", async (baseUrl) => {
    const fetch = fetcher();
    await expect(verifyProject({ ...project, baseUrl }, fetch)).rejects.toMatchObject({ code: "INVALID_URL" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects redirects from every metadata document", async () => {
    for (let stage = 0; stage < 3; stage++) {
      let index = 0;
      const fetch: FetchJson = async () => ({ status: index === stage ? 302 : 200, json: documents[index++], headers: new Headers() });
      await expect(verifyProject(project, fetch)).rejects.toMatchObject({ code: "REDIRECT_REJECTED" });
    }
  });
  it("rejects issuer mismatch", async () => {
    await expect(verifyProject(project, fetcher([documents[0], documents[1], { ...documents[2], issuer: "https://other.example" }]))).rejects.toMatchObject({ code: "ISSUER_MISMATCH" });
  });
  it("rejects resource origin mismatch before requesting the issuer", async () => {
    const fetch = fetcher([documents[0], { ...documents[1], resource: "https://other.example/api/mcp" }]);
    await expect(verifyProject(project, fetch)).rejects.toMatchObject({ code: "RESOURCE_ORIGIN_MISMATCH" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["token_endpoint", "authorization_endpoint", "revocation_endpoint"])("rejects unsafe %s", async (endpoint) => {
    await expect(verifyProject(project, fetcher([documents[0], documents[1], { ...documents[2], [endpoint]: "http://auth.example/endpoint" }]))).rejects.toMatchObject({ code: "INVALID_URL" });
  });
  it("allows absent revocation endpoint", async () => {
    expect((await verifyProject(project, fetcher([documents[0], documents[1], { ...documents[2], revocation_endpoint: undefined }]))).revocationEndpoint).toBeNull();
  });
  it("allows explicitly enabled http localhost projects", async () => {
    vi.stubEnv("CLOUD_ALLOW_LOCAL_PROJECTS", "1");
    const local = "http://localhost:3000";
    const result = await verifyProject({ ...project, baseUrl: local }, fetcher([documents[0], { resource: `${local}/api/mcp`, authorization_servers: [local] }, { issuer: local, token_endpoint: `${local}/token`, authorization_endpoint: `${local}/authorize` }]));
    expect(result.mcpResource).toBe(`${local}/api/mcp`);
  });
  it("maps network failures without exposing upstream error text", async () => {
    const fetch: FetchJson = async () => { throw new Error("secret upstream details"); };
    const error = await verifyProject(project, fetch).catch(e => e);
    expect(error).toBeInstanceOf(VerifyError);
    expect(error.code).toBe("PROJECT_UNAVAILABLE");
    expect(error.message).not.toContain("secret");
  });
  it("rejects malformed metadata", async () => {
    await expect(verifyProject(project, fetcher([documents[0], { resource: "https://project.example/api/mcp", authorization_servers: [] }]))).rejects.toMatchObject({ code: "INVALID_METADATA" });
  });
});
