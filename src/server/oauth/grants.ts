import "server-only";
import { AGENT_SCOPES, ContourError, type Scope } from "@/sdk/types";
import { APP_ID } from "../context";
import { adminClient } from "../supabase";

export type GrantRow = {
  id: string;
  subject_id: string;
  tenant_id: string;
  app_id: string;
  client_id: string;
  scopes: string[];
  surfaces: string[];
  grant_revision: number;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GrantSummary = {
  id: string;
  clientId: string;
  clientName: string;
  /** "dcr" = self-registered (name unverified), "cimd" = metadata document at a URL. */
  clientKind: string;
  scopes: Scope[];
  surfaces: string[];
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

const GRANT_COLUMNS =
  "id, subject_id, tenant_id, app_id, client_id, scopes, surfaces, grant_revision, revoked_at, created_at, updated_at";

export function agentScopesOnly(scopes: readonly string[]): Scope[] {
  return AGENT_SCOPES.filter((s) => scopes.includes(s));
}

/** (Re-)consent. Bumps grant_revision so tokens from earlier consents stop working. */
export async function upsertGrant(p: {
  subjectId: string;
  tenantId: string;
  appId: string;
  clientId: string;
  scopes: Scope[];
  surfaces: string[];
}): Promise<GrantRow> {
  const scopes = agentScopesOnly(p.scopes);
  if (scopes.length === 0) throw new ContourError("INVALID_INPUT", "No grantable scopes");
  const { data, error } = await adminClient().rpc("contour_upsert_grant", {
    p_subject: p.subjectId,
    p_tenant: p.tenantId,
    p_app: p.appId,
    p_client: p.clientId,
    p_scopes: scopes,
    p_surfaces: p.surfaces,
  });
  const row = (Array.isArray(data) ? data[0] : data) as GrantRow | null;
  if (error || !row?.id) throw new ContourError("INTERNAL", "Could not record the grant");
  return row;
}

/** Grant lookup by id; callers must still check ownership/state. */
export async function getGrantById(grantId: string): Promise<GrantRow | null> {
  const { data, error } = await adminClient().from("oauth_grants").select(GRANT_COLUMNS).eq("id", grantId).maybeSingle();
  if (error) throw new ContourError("INTERNAL", "Grant lookup failed");
  return (data as GrantRow | null) ?? null;
}

export async function findGrant(subjectId: string, tenantId: string, appId: string, clientId: string): Promise<GrantRow | null> {
  const { data, error } = await adminClient()
    .from("oauth_grants")
    .select(GRANT_COLUMNS)
    .eq("subject_id", subjectId)
    .eq("tenant_id", tenantId)
    .eq("app_id", appId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new ContourError("INTERNAL", "Grant lookup failed");
  return (data as GrantRow | null) ?? null;
}

/** Revoke every live token of the given grants (access + refresh). */
export async function revokeTokensForGrants(grantIds: string[]): Promise<void> {
  if (grantIds.length === 0) return;
  const { error } = await adminClient()
    .from("oauth_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .in("grant_id", grantIds)
    .is("revoked_at", null);
  if (error) throw new ContourError("INTERNAL", "Token revocation failed");
}

async function audit(tenantId: string, appId: string, subjectId: string | null, kind: string, ref: string, detail: Record<string, unknown>) {
  const { error } = await adminClient()
    .from("audit_events")
    .insert({ tenant_id: tenantId, app_id: appId, subject_id: subjectId, surface_id: null, kind, ref, detail });
  if (error) console.error("[contour] audit insert failed", error.code ?? "unknown");
}

/** Agent connections for the signed-in user's Connected agents page. */
export async function listGrantsForUser(subjectId: string, tenantId: string): Promise<GrantSummary[]> {
  const { data, error } = await adminClient()
    .from("oauth_grants")
    .select(`${GRANT_COLUMNS}, oauth_clients(client_name, kind)`)
    .eq("subject_id", subjectId)
    .eq("tenant_id", tenantId)
    .eq("app_id", APP_ID)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new ContourError("INTERNAL", "Could not list connected agents");
  type Row = GrantRow & { oauth_clients: { client_name: string; kind: string } | { client_name: string; kind: string }[] | null };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const c = Array.isArray(r.oauth_clients) ? r.oauth_clients[0] : r.oauth_clients;
    return {
      id: r.id,
      clientId: r.client_id,
      clientName: c?.client_name ?? "Unknown client",
      clientKind: c?.kind ?? "unknown",
      scopes: agentScopesOnly(r.scopes),
      surfaces: r.surfaces,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      revokedAt: r.revoked_at,
    };
  });
}

/** User revokes one of their own agent grants. Returns false if not found / not theirs. */
export async function revokeGrant(subjectId: string, tenantId: string, grantId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(grantId)) return false;
  const now = new Date().toISOString();
  const { data, error } = await adminClient()
    .from("oauth_grants")
    .update({ revoked_at: now, updated_at: now })
    .eq("id", grantId)
    .eq("subject_id", subjectId)
    .eq("tenant_id", tenantId)
    .eq("app_id", APP_ID)
    .select("id, revoked_at");
  if (error) throw new ContourError("INTERNAL", "Could not revoke the grant");
  if (!data || data.length === 0) return false;
  await revokeTokensForGrants([grantId]);
  await audit(tenantId, APP_ID, subjectId, "agent_grant_revoked", grantId, { by: "user" });
  return true;
}

/** Operator kill switch: revoke every agent grant for a tenant + app. Returns the count. */
export async function revokeAllGrantsForApp(tenantId: string, appId: string, operatorSubjectId?: string): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await adminClient()
    .from("oauth_grants")
    .update({ revoked_at: now, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("app_id", appId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new ContourError("INTERNAL", "Could not revoke grants");
  const ids = (data ?? []).map((r) => r.id as string);
  // Also sweep tokens of grants revoked earlier (idempotent).
  const { data: all } = await adminClient().from("oauth_grants").select("id").eq("tenant_id", tenantId).eq("app_id", appId);
  await revokeTokensForGrants((all ?? []).map((r) => r.id as string));
  await audit(tenantId, appId, operatorSubjectId ?? null, "agent_grants_revoked_all", appId, { count: ids.length, by: "operator" });
  return ids.length;
}

/** Revoke a grant because of a security event (refresh-token reuse, code replay). */
export async function revokeGrantForSecurityEvent(grant: GrantRow, reason: string): Promise<void> {
  const now = new Date().toISOString();
  await adminClient()
    .from("oauth_grants")
    .update({ revoked_at: now, updated_at: now })
    .eq("id", grant.id)
    .eq("subject_id", grant.subject_id)
    .eq("tenant_id", grant.tenant_id);
  await revokeTokensForGrants([grant.id]);
  await audit(grant.tenant_id, grant.app_id, grant.subject_id, "agent_grant_revoked", grant.id, { by: "system", reason });
}
