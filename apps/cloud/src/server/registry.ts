import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { CloudDb } from "./db";
import { verifyProject, VerifyError } from "./verify";
export type RegistryProject = { id: string; owner_id: string; name: string; company: string; description: string; base_url: string; surfaces: string[]; verify_nonce: string; status: "pending" | "verified" | "disabled"; verified_at: string | null };
const fields = z.object({ name: z.string().trim().min(1).max(100), company: z.string().trim().min(1).max(100), description: z.string().trim().max(1000), base_url: z.url().max(2048), surfaces: z.array(z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/)).min(1).max(30) });
export async function createProject(db: CloudDb, ownerId: string, input: unknown) {
  const p = fields.parse(input), url = new URL(p.base_url);
  const local = process.env.CLOUD_ALLOW_LOCAL_PROJECTS === "1" && url.protocol === "http:" && url.hostname === "localhost";
  if ((!local && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) throw new Error("Invalid project URL");
  const { data, error } = await db.from("projects").insert({ ...p, base_url: url.href.replace(/\/$/, ""), owner_id: ownerId, verify_nonce: randomBytes(32).toString("base64url") }).select("id").single();
  if (error || !data) throw new Error("Unable to create project");
  return data.id as string;
}
export async function verifyOwnedProject(db: CloudDb, ownerId: string, id: string) {
  const { data: project, error } = await db.from("projects").select("id,base_url,verify_nonce,status,as_issuer,mcp_resource,token_endpoint,revocation_endpoint").eq("id", id).eq("owner_id", ownerId).maybeSingle();
  if (error || !project || project.status === "disabled") throw new Error("Project unavailable");
  const result = await verifyProject({ baseUrl: project.base_url, projectId: project.id, nonce: project.verify_nonce });
  // An existing grant belongs to these exact endpoints. A replacement issuer
  // or token destination must use a new registry project and fresh consent.
  const established = !!(project.as_issuer || project.mcp_resource || project.token_endpoint);
  if (established && (project.as_issuer !== result.asIssuer || project.mcp_resource !== result.mcpResource ||
    project.token_endpoint !== result.tokenEndpoint || (project.revocation_endpoint ?? null) !== result.revocationEndpoint)) {
    throw new VerifyError("PROJECT_BINDING_CHANGED", "The project authorization settings changed. Register a new project and link it again.");
  }
  let update = db.from("projects").update({
    mcp_resource: result.mcpResource, as_issuer: result.asIssuer, token_endpoint: result.tokenEndpoint,
    authorization_endpoint: result.authorizationEndpoint, registration_endpoint: result.registrationEndpoint,
    revocation_endpoint: result.revocationEndpoint, status: "verified", verified_at: new Date().toISOString(),
  }).eq("id", id).eq("owner_id", ownerId).eq("status", project.status);
  for (const key of ["as_issuer", "mcp_resource", "token_endpoint", "revocation_endpoint"] as const) {
    update = project[key] == null ? update.is(key, null) : update.eq(key, project[key]);
  }
  const saved = await update.select("id").maybeSingle();
  if (saved.error) throw new Error("Unable to record verification");
  if (!saved.data) throw new VerifyError("PROJECT_BINDING_CHANGED", "The project changed during verification. Reload the project and try again.");
}
export async function auditUser(db: CloudDb, userId: string, kind: string, projectId?: string) {
  const { error } = await db.from("audit_events").insert({ contour_user: userId, project_id: projectId ?? null, kind, detail: {} });
  if (error) throw new Error("Unable to record activity");
}
