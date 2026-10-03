import { expect, it, vi } from "vitest";
import type { VerifiedContext } from "@contour/sdk/core";
import { adaptCloudTools } from "../../src/server/mcp-adapter";
import { cloudTools } from "../../src/server/tools";
import { createFakeDb } from "../helpers/fake-db";

vi.mock("../../src/server/forward", async (original) => ({
  ...await original<typeof import("../../src/server/forward")>(),
  forwardTool: async () => ({ result: { ok: true }, isError: false }),
}));

it("allocates a per-project limit only for an active caller-owned link", async () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const db = createFakeDb({ projects: [{ id, name: "Project", company: "Company", status: "verified",
    mcp_resource: "https://app.example/api/mcp", as_issuer: "https://app.example", token_endpoint: "https://app.example/token" }], links: [] });
  const tool = adaptCloudTools(cloudTools({ db, fetchJson: vi.fn(), clientId: "client", appUrl: "https://cloud.example" })).find(t => t.name === "describe_surface")!;
  const ctx = { subjectId: "limit-consumer" } as VerifiedContext;
  const args = tool.args.parse({ projectId: id, surfaceId: "overview" });
  for (let i = 0; i < 61; i++) await expect(tool.run(ctx, args)).rejects.toMatchObject({ code: "NOT_FOUND" });
  db.tables.get("links")!.push({ contour_user: ctx.subjectId, project_id: id, status: "active" });
  await expect(tool.run(ctx, args)).resolves.toEqual({ ok: true });
  // A fresh caller gets sixty forwarded calls, then the project limit applies.
  const linkedCtx = { subjectId: "linked-limit-consumer" } as VerifiedContext;
  db.tables.get("links")!.push({ contour_user: linkedCtx.subjectId, project_id: id, status: "active" });
  for (let i = 0; i < 60; i++) await expect(tool.run(linkedCtx, args)).resolves.toEqual({ ok: true });
  await expect(tool.run(linkedCtx, args)).rejects.toMatchObject({ code: "RATE_LIMITED" });
});
