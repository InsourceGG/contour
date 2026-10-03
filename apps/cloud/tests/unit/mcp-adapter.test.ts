import { describe, expect, it, vi } from "vitest";
import { ContourError, type VerifiedContext } from "@contour/sdk/core";
import { adaptCloudTools, CLOUD_TOOL_SCOPES } from "../../src/server/mcp-adapter";
import { cloudTools, ToolError, type ToolDef } from "../../src/server/tools";
import { ForwardError } from "../../src/server/forward";
import { ProjectClientError } from "../../src/server/project-client";

vi.mock("server-only", () => ({}));
import { createMcpHandler } from "../../../../packages/contour-sdk/src/server/mcp/handler";
import type { ServerContext } from "../../../../packages/contour-sdk/src/server/context";

const projectId = "11111111-1111-4111-8111-111111111111";
const context: VerifiedContext = {
  subjectId: "verified-consumer", tenantId: "cloud", appId: "contour-cloud", surfaceId: "cloud",
  clientId: "agent", grantRevision: "1", role: "consumer", roleVersion: "1",
  channel: "mcp", scopes: new Set(["view:read", "data:read", "view:propose"]),
};
function source(name: string, handler: ToolDef["handler"] = vi.fn(async () => ({ ok: true }))): ToolDef {
  const tools = cloudTools({
    db: { from: vi.fn(), rpc: vi.fn() }, fetchJson: vi.fn(),
    appUrl: "https://cloud.example", clientId: "https://cloud.example/oauth/client.json",
  });
  return { ...tools.find((tool) => tool.name === name)!, handler };
}
function request(name: string, args: object) {
  return new Request("https://cloud.example/api/mcp", {
    method: "POST", headers: { "Content-Type": "application/json", "MCP-Protocol-Version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
}
function wire(tool: ToolDef, caller = context) {
  const resolver = vi.fn(async () => caller);
  const handler = createMcpHandler({
    cfg: { appUrl: "https://cloud.example" }, defaultSurface: () => "cloud",
    resourceMetadataUrl: () => "https://cloud.example/.well-known/oauth-protected-resource/api/mcp",
  } as ServerContext, resolver, { tools: adaptCloudTools([tool]), instructions: "Cloud" });
  return { handler, resolver };
}

describe("Cloud MCP adapter", () => {
  it.each(Object.entries(CLOUD_TOOL_SCOPES))("requires the declared scope for %s", (name, scope) => {
    expect(adaptCloudTools([source(name)])[0].scope).toBe(scope);
  });

  it("authorizes the hub and forwards the original company surface with the verified consumer", async () => {
    const companyHandler = vi.fn(async () => ({ components: [] }));
    const tool = source("describe_surface", companyHandler);
    const { handler, resolver } = wire(tool);
    const response = await handler(request("describe_surface", { projectId, surfaceId: "overview" }));
    expect(response.status).toBe(200);
    expect(companyHandler).toHaveBeenCalledWith({ contourUser: "verified-consumer" }, { projectId, surfaceId: "overview" });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith(expect.any(Request), "cloud");
    expect((await response.json()).result.isError).toBeUndefined();
  });

  it("allows project-list input without a company surface", async () => {
    const companyHandler = vi.fn(async () => []);
    const { handler } = wire(source("list_projects", companyHandler));
    const response = await handler(request("list_projects", {}));
    expect((await response.json()).result.structuredContent).toEqual({ result: [] });
    expect(companyHandler).toHaveBeenCalledWith({ contourUser: "verified-consumer" }, {});
  });

  it("keeps the original closed input schemas and rejects identity injection", async () => {
    const tool = source("describe_surface");
    const adapted = adaptCloudTools([tool])[0];
    expect(adapted.inputSchema).toEqual(tool.inputSchema);
    expect(adapted.args.safeParse({ projectId, surfaceId: "overview", contourUser: "victim" }).success).toBe(false);
    const { handler } = wire(tool);
    const result = (await (await handler(request("describe_surface", { projectId, surfaceId: "overview", subjectId: "victim" }))).json()).result;
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe("INVALID_INPUT");
    expect(tool.handler).not.toHaveBeenCalled();
  });

  it("enforces scopes before invoking company tools", async () => {
    const tool = source("read_component_data");
    const { handler } = wire(tool, { ...context, scopes: new Set(["view:read"]) });
    const response = await handler(request("read_component_data", { projectId, surfaceId: "overview", readerId: "kpis" }));
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain("insufficient_scope");
    expect(tool.handler).not.toHaveBeenCalled();
  });

  it.each([
    new ToolError("LINK_REQUIRED", "Reconnect this project"),
    new ForwardError("PROJECT_ACCESS_REVOKED", "Project access was revoked"),
    new ProjectClientError("PROJECT_UNAVAILABLE", "Project unavailable"),
  ])("maps $code to a stable SDK MCP error result", async (error) => {
    const tool = source("describe_surface", vi.fn(async () => { throw error; }));
    const { handler } = wire(tool);
    const result = (await (await handler(request("describe_surface", { projectId, surfaceId: "overview" }))).json()).result;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: { code: error.code, message: error.message } });
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
  });

  it("preserves a company's PAYMENT_REQUIRED code through the wire", async () => {
    const tool = source("describe_surface", vi.fn(async () => ({
      isError: true, error: { code: "PAYMENT_REQUIRED", message: "No adaptation credits remaining" },
    })));
    const { handler } = wire(tool);
    const result = (await (await handler(request("describe_surface", { projectId, surfaceId: "overview" }))).json()).result;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: { code: "PAYMENT_REQUIRED", message: "No adaptation credits remaining" } });
  });

  it("preserves ordinary SDK errors and exposes no commit tools", async () => {
    const tool = source("list_projects", vi.fn(async () => { throw new ContourError("NOT_FOUND", "Project not found"); }));
    await expect(adaptCloudTools([tool])[0].run(context, adaptCloudTools([tool])[0].args.parse({}))).rejects.toBeInstanceOf(ContourError);
    expect(Object.keys(CLOUD_TOOL_SCOPES)).not.toContain("commit_view");
    expect(Object.keys(CLOUD_TOOL_SCOPES)).not.toContain("reset_view");
    expect(Object.keys(CLOUD_TOOL_SCOPES)).not.toContain("undo_view");
  });
});
