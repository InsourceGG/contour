import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContourError } from "@contour/sdk/core";
import { createFakeDb } from "../helpers/fake-db";
import { authenticatedForm, go, safeNext } from "../../src/server/forms";
import { AUTH_CSRF_COOKIE, authCsrf, authCsrfForPage, checkAuthCsrf, newAuthNonce } from "../../src/server/auth-csrf";
import { auditUser, createProject, verifyOwnedProject } from "../../src/server/registry";
import { contour } from "../../src/server/contour";
import type { HostUser } from "@contour/sdk/server";

const doubles = vi.hoisted(() => ({
  resolveHostUser: vi.fn(), cookies: vi.fn(), verifyProject: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: doubles.cookies }));
vi.mock("../../src/server/context", () => ({
  APP_ID: "contour-cloud", resolveHostUser: doubles.resolveHostUser,
  tryHostUser: () => doubles.resolveHostUser(),
}));
vi.mock("../../src/server/verify", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/server/verify")>(),
  verifyProject: doubles.verifyProject,
}));

const origin = "https://cloud.example";
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const projectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const user: HostUser = {
  subjectId: owner, sessionId: "session-one", tenantId: "cloud", role: "consumer", roleVersion: 1,
  email: "consumer@example.test", displayName: "Consumer",
};
const input = {
  name: "Operations", company: "Company", description: "Project description",
  base_url: "https://company.example", surfaces: ["overview"],
};
function formRequest(form: FormData, requestOrigin: string | null = origin) {
  const headers = new Headers();
  if (requestOrigin !== null) headers.set("origin", requestOrigin);
  return new Request(`${origin}/owner/create`, { method: "POST", headers, body: form });
}
function formToken(token: string) {
  const form = new FormData(); form.set("csrf", token); return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("CONTOUR_CSRF_SECRET", "unit-test-session-and-auth-secret");
  vi.stubEnv("CLOUD_ALLOW_LOCAL_PROJECTS", "0");
  doubles.resolveHostUser.mockResolvedValue(user);
  doubles.cookies.mockResolvedValue({ get: () => ({ value: "cookie-nonce" }) });
  doubles.verifyProject.mockResolvedValue({
    mcpResource: "https://company.example/api/mcp", asIssuer: "https://company.example",
    tokenEndpoint: "https://company.example/api/oauth/token", authorizationEndpoint: "https://company.example/oauth/authorize",
    registrationEndpoint: "https://company.example/api/oauth/register", revocationEndpoint: null,
  });
});

describe("account form security", () => {
  it("uses the verified user and session-bound form token", async () => {
    const form = formToken(contour.oauth.csrfTokenFor(user));
    form.set("owner_id", other);
    const result = await authenticatedForm(formRequest(form));
    expect(result.user).toEqual(user);
    expect(result.form.get("owner_id")).toBe(other);
  });

  it.each([
    ["wrong user", { ...user, subjectId: other }],
    ["previous sign-in", { ...user, sessionId: "session-before" }],
  ])("rejects a token from %s", async (_name, tokenUser) => {
    await expect(authenticatedForm(formRequest(formToken(contour.oauth.csrfTokenFor(tokenUser)))))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each(["https://attacker.example", "null", null])("rejects an untrusted form origin %s", async (requestOrigin) => {
    await expect(authenticatedForm(formRequest(formToken(contour.oauth.csrfTokenFor(user)), requestOrigin)))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects missing tokens and signed-out sessions before owner operations", async () => {
    await expect(authenticatedForm(formRequest(new FormData()))).rejects.toMatchObject({ code: "FORBIDDEN" });
    doubles.resolveHostUser.mockRejectedValue(new ContourError("UNAUTHENTICATED", "Sign in required"));
    await expect(authenticatedForm(formRequest(new FormData()))).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it.each([
    "https://attacker.example", "//attacker.example", "/\\attacker.example", "/\r/attacker.example",
    "/\n/attacker.example", "/\t/attacker.example", "javascript:alert(1)", "", null, 42,
  ])("keeps a hostile next value inside Cloud: %j", (value) => {
    expect(safeNext(value)).toBe("/projects");
    expect(new URL(go(safeNext(value)).headers.get("location")!).origin).toBe(origin);
  });

  it("retains a valid internal path and OAuth query parameters", () => {
    const next = "/oauth/authorize?client_id=agent&state=abc%2F123";
    expect(safeNext(next)).toBe(next);
    expect(go(next).status).toBe(303);
    expect(go(next).headers.get("location")).toBe(`${origin}${next}`);
  });
});

describe("signed-out authentication CSRF", () => {
  it("signs a cookie nonce and accepts its form token at the configured origin", async () => {
    const nonce = newAuthNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);
    doubles.cookies.mockResolvedValue({ get: (name: string) => name === AUTH_CSRF_COOKIE ? { value: nonce } : undefined });
    const token = authCsrf(nonce);
    expect(token).not.toBe(nonce);
    expect(await authCsrfForPage()).toBe(token);
    expect(await checkAuthCsrf(formRequest(formToken(token)), formToken(token))).toBe(true);
  });

  it.each(["https://attacker.example", "null", null])("requires the configured origin %s", async (requestOrigin) => {
    const form = formToken(authCsrf("cookie-nonce"));
    expect(await checkAuthCsrf(formRequest(form, requestOrigin), form)).toBe(false);
  });

  it("rejects forged, tampered and cross-cookie tokens", async () => {
    for (const token of ["", "cookie-nonce", authCsrf("other-nonce"), `${authCsrf("cookie-nonce")}x`]) {
      const form = formToken(token);
      expect(await checkAuthCsrf(formRequest(form), form)).toBe(false);
    }
  });

  it("does not accept a form signature without its cookie nonce", async () => {
    doubles.cookies.mockResolvedValue({ get: () => undefined });
    const form = formToken(authCsrf("cookie-nonce"));
    expect(await authCsrfForPage()).toBe("");
    expect(await checkAuthCsrf(formRequest(form), form)).toBe(false);
  });
});

describe("owner project registry security", () => {
  it.each([
    { base_url: "http://company.example" }, { base_url: "ftp://company.example" },
    { base_url: "https://owner:password@company.example" },
    { base_url: "https://company.example?token=secret" }, { base_url: "https://company.example#token" },
    { surfaces: ["../../another-project"] }, { surfaces: ["surface with spaces"] }, { surfaces: [] },
    { surfaces: ["a".repeat(65)] },
  ])("rejects unsafe registry fields before any database operation: %j", async (override) => {
    const db = { from: vi.fn(), rpc: vi.fn() };
    await expect(createProject(db, owner, { ...input, ...override })).rejects.toThrow();
    expect(db.from).not.toHaveBeenCalled();
  });

  it("rejects local URLs without the explicit development flag", async () => {
    const db = { from: vi.fn(), rpc: vi.fn() };
    await expect(createProject(db, owner, { ...input, base_url: "http://localhost:3000" })).rejects.toThrow();
    expect(db.from).not.toHaveBeenCalled();
  });

  it("binds newly registered projects to the verified owner rather than posted owner metadata", async () => {
    const single = vi.fn(async () => ({ data: { id: projectId }, error: null }));
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn<(values: Record<string, unknown>) => { select: typeof select }>(() => ({ select }));
    const db = { from: vi.fn(() => ({ insert })), rpc: vi.fn() };
    expect(await createProject(db, owner, { ...input, owner_id: other, verify_nonce: "attacker-nonce" })).toBe(projectId);
    const saved = insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(saved.owner_id).toBe(owner);
    expect(saved.verify_nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(saved.verify_nonce).not.toBe("attacker-nonce");
    expect(saved.base_url).toBe(input.base_url);
  });

  it("requires owner ownership on the read and write verification queries", async () => {
    const db = createFakeDb({ projects: [
      { id: projectId, owner_id: owner, base_url: input.base_url, verify_nonce: "nonce", status: "pending" },
      { id: "other-project", owner_id: other, base_url: "https://other.example", verify_nonce: "other", status: "pending" },
    ] });
    await expect(verifyOwnedProject(db, other, projectId)).rejects.toThrow("Project unavailable");
    expect(doubles.verifyProject).not.toHaveBeenCalled();
    await verifyOwnedProject(db, owner, projectId);
    expect(doubles.verifyProject).toHaveBeenCalledWith({ baseUrl: input.base_url, projectId, nonce: "nonce" });
    expect(db.tables.get("projects")![0]).toMatchObject({ status: "verified", as_issuer: input.base_url });
    expect(db.tables.get("projects")![1]).toMatchObject({ status: "pending", owner_id: other });
  });

  it("rechecks ownership after the network verification before saving metadata", async () => {
    const db = createFakeDb({ projects: [{ id: projectId, owner_id: owner, base_url: input.base_url, verify_nonce: "nonce", status: "pending" }] });
    doubles.verifyProject.mockImplementationOnce(async () => {
      db.tables.get("projects")![0].owner_id = other;
      return { mcpResource: "https://company.example/api/mcp", asIssuer: input.base_url };
    });
    await expect(verifyOwnedProject(db, owner, projectId)).rejects.toMatchObject({ code: "PROJECT_BINDING_CHANGED" });
    expect(db.tables.get("projects")![0]).toMatchObject({ owner_id: other, status: "pending" });
    expect(db.tables.get("projects")![0].mcp_resource).toBeUndefined();
  });

  it("does not verify disabled projects and binds audit rows to the consumer", async () => {
    const db = createFakeDb({ projects: [{ id: projectId, owner_id: owner, status: "disabled" }] });
    await expect(verifyOwnedProject(db, owner, projectId)).rejects.toThrow("Project unavailable");
    expect(doubles.verifyProject).not.toHaveBeenCalled();
    await auditUser(db, owner, "project_created", projectId);
    expect(db.tables.get("audit_events")![0]).toMatchObject({ contour_user: owner, project_id: projectId, kind: "project_created", detail: {} });
  });
});
