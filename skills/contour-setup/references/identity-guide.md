# Map the existing company identity

`defineContourServer` accepts `identity`, not a `resolveIdentity` property. Implement the three methods exactly:

```ts
import type { HostUser, Membership } from "@contour/sdk/server";

export const identity: {
  currentUser(): Promise<HostUser | null>;
  loginUrl(nextPath: string): string;
  getMembership(subjectId: string, tenantId: string, appId: string): Promise<Membership | null>;
} = {
  currentUser,
  loginUrl: (nextPath) => `/login?next=${encodeURIComponent(
    nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/desk",
  )}`,
  getMembership,
};
```

Here `currentUser` and `getMembership` are host functions implemented below. `HostUser` contains `subjectId`, `sessionId`, `tenantId`, `role`, `roleVersion` (number), `displayName`, `email`. `Membership` contains `tenantId`, `subjectId`, `appId`, `role`, `roleVersion` (number), `dataAccess`, `status` (`active` or `suspended`), `displayName`.

Read the original session verifier and membership storage. Only verified server-side identity chooses the subject. A cookie may select among actual memberships, never invent one. Reload membership for OAuth/MCP requests, including calls with a still-valid access token. `currentUser` returns null only for a signed-out user. A signed-in user with no active membership must throw `ContourError("FORBIDDEN")`; returning null would cause a login loop. Database failure is an error, never an anonymous fallback or permission grant.

## A: Supabase Auth (Acme)

Reuse the existing server `userClient` and privileged `adminClient`. Call `auth.getUser()` to verify the token, then query `memberships` by subject, app, and active status. Match the selected tenant only within those rows. Read the session_id claim from the same access token verified by `getUser`, not from an unverified JWT supplied independently. Never use `getSession()` alone as authentication.

```ts
import { cookies } from "next/headers";
import { ContourError } from "@contour/sdk/core";
import type { HostUser, Membership } from "@contour/sdk/server";
import { adminClient, userClient } from "@/server/supabase";

const APP_ID = "ops-demo";
async function currentUser(): Promise<HostUser | null> {
  const client = await userClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const { data: rows, error: dbError } = await adminClient()
    .from("memberships")
    .select("tenant_id,role,role_version,status,display_name,data_access")
    .eq("subject_id", data.user.id).eq("app_id", APP_ID).eq("status", "active");
  if (dbError) throw new Error("Membership lookup failed");
  const requested = (await cookies()).get("contour_tenant")?.value;
  const membership = rows?.find((row) => row.tenant_id === requested) ?? rows?.[0];
  if (!membership) throw new ContourError("FORBIDDEN", "No active membership");
  const { data: session } = await client.auth.getSession();
  const token = session.session?.access_token;
  if (!token) return null;
  let sessionId: unknown;
  try { sessionId = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).session_id; }
  catch { return null; }
  if (typeof sessionId !== "string" || !sessionId) return null;
  return {
    subjectId: data.user.id, sessionId, tenantId: membership.tenant_id,
    role: membership.role, roleVersion: membership.role_version,
    displayName: membership.display_name, email: data.user.email ?? "",
  };
}
async function getMembership(subjectId: string, tenantId: string, appId: string): Promise<Membership | null> {
  if (appId !== APP_ID) return null;
  const { data, error } = await adminClient().from("memberships")
    .select("role,role_version,data_access,status,display_name")
    .eq("subject_id", subjectId).eq("tenant_id", tenantId).eq("app_id", appId).maybeSingle();
  if (error) throw new Error("Membership lookup failed");
  return data ? {
    subjectId, tenantId, appId, role: data.role, roleVersion: data.role_version,
    dataAccess: data.data_access, status: data.status, displayName: data.display_name,
  } : null;
}
```

Adapt column names to the real schema. Keep existing role eligibility checks. Never infer membership from email/domain or copy the Cloud identity into the company identity.

## B: Signed cookie session (Northwind)

Reuse `getSession()` which verifies HMAC and expiry for `nw_session` and reloads the current user's role/team. Its baseline `Session` has no sessionId or roleVersion. In the integrated copy, provide a stable sign-in identifier, preferably an opaque random ID carried in the signed payload. A server-side hash of the already-verified signed cookie is also a stable per-cookie identifier. Never use the raw cookie or a constant subject ID as sessionId.

Propose a persisted `role_version` counter on the authoritative Northwind user record. Recommend a database trigger on the role/team/access columns (and suspension if present) to increment it atomically when those values change, rather than app-level increments that other write paths can bypass. Backfill safely, default to 1, and preserve baseline session verification. Write that SQL and the approved `northwind_contour.tenant_app_settings` row to `supabase/contour-host.sql`, with its exact rollback in `supabase/contour-host.down.sql` (see the wiring guide). Show both files in full, with target schemas, in checkpoint 3 and wait for approval before applying them. Do not hardcode version 1 forever or use timestamps with possible collisions. Keep current authorization attributes live, not copied indefinitely from a token.

The following example assumes checkpoint 3 approved these host schema changes and `role_version` exists. Implement this only in the integration target, never this task's pristine Northwind baseline.

```ts
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { ContourError } from "@contour/sdk/core";
import type { HostUser, Membership } from "@contour/sdk/server";
import { getSession } from "@/lib/session";
import { getDb } from "@/lib/db";

const APP_ID = "northwind";
const TENANT_ID = "northwind"; // company, not the current support team
const allowedRoles = new Set(["agent", "lead", "admin"]); // owner-approved
async function getMembership(subjectId: string, tenantId: string, appId: string): Promise<Membership | null> {
  if (tenantId !== TENANT_ID || appId !== APP_ID) return null;
  const { data, error } = await getDb().from("users")
    .select("id,name,role,role_version").eq("id", subjectId).maybeSingle();
  if (error) throw new Error("Membership lookup failed");
  if (!data) return null;
  return {
    subjectId: data.id, tenantId, appId, role: data.role,
    roleVersion: data.role_version, displayName: data.name,
    status: "active", dataAccess: allowedRoles.has(data.role),
  };
}
async function currentUser(): Promise<HostUser | null> {
  const session = await getSession();
  if (!session) return null;
  const membership = await getMembership(session.userId, TENANT_ID, APP_ID);
  const cookie = (await cookies()).get("nw_session")?.value;
  if (!membership || membership.status !== "active") throw new ContourError("FORBIDDEN", "No active membership");
  if (!cookie) throw new ContourError("FORBIDDEN", "Verified session cookie missing");
  return {
    subjectId: session.userId,
    sessionId: createHash("sha256").update(cookie).digest("hex"),
    tenantId: membership.tenantId, role: membership.role,
    roleVersion: membership.roleVersion, displayName: session.name, email: session.email,
  };
}
```

Northwind's baseline has no suspension column; deletion yields null membership. If adding suspension, select it and map it to `status`, and increment version on changes. Never report suspension support without that storage/enforcement.

Implement `sessionForContext(ctx: VerifiedContext): Promise<Session>` for readers by reloading the row, checking app/company, membership status/dataAccess and `String(role_version) === ctx.roleVersion`, and taking its **current** team. Throw `ContourError("FORBIDDEN", ...)` on mismatch. Retain each data function's existing team filter as well.

## Kill switch and grants

Persist the owner-approved switch per company/app in `<app>_contour.tenant_app_settings` (Northwind: `northwind_contour.tenant_app_settings`, read through the unscoped `getAppDb()` client with `.schema("northwind_contour")`). The default proposal is agents ENABLED, with the admin kill switch available and off. Turning the kill switch on DISABLES agents. `agentAccessEnabled(tenantId, appId)` returns false when killed, missing, or outside the approved app/company; initialize approved settings explicitly, never treat a missing row as enabled. Only authenticated admins may change it, with same-origin and CSRF checks; expose a positive UI label such as "Allow agent access" so off corresponds to kill switch on. Do not disable the host's original app.

Use `contour.oauth.listGrantsForUser`, `revokeGrant`, and `revokeAllGrantsForApp` for the host's connection controls with fresh identity checks and CSRF. `view:commit` is host-only. Current memberships, switch state, and roleVersion must invalidate agent access on the next call.
