import "server-only";
import type { ContourStore, DecisionEvent, HistoryEntry, Membership, Owner, RpcResult, StoredView } from "@/sdk/broker";
import { ContourError, type Proposal, type UserPreferences } from "@/sdk/types";
import { adminClient } from "./supabase";

/**
 * Supabase-backed preference store. Uses the service-role client, so every
 * query below applies explicit tenant/app/subject/surface filters; the broker
 * enforces membership before calling in. RLS policies remain as defense in
 * depth for any user-session access path.
 */

function db() {
  return adminClient();
}

function fail(op: string, error: { message: string } | null): never {
  console.error(`[contour] store.${op} failed`, error?.message);
  throw new ContourError("INTERNAL", "Preference store unavailable");
}

type Filterable = { eq(column: string, value: string): Filterable };

/** Explicit owner-tuple filter applied to every owner-scoped query. */
function ownerFilter<T>(q: T, o: Owner): T {
  const f = q as unknown as Filterable;
  return f.eq("tenant_id", o.tenantId).eq("app_id", o.appId).eq("subject_id", o.subjectId).eq("surface_id", o.surfaceId) as unknown as T;
}

type ProposalRow = {
  id: string;
  tenant_id: string;
  app_id: string;
  subject_id: string;
  surface_id: string;
  base_revision: number;
  manifest_version: string;
  policy_version: string;
  role_version: number;
  config: Proposal["config"];
  config_hash: string;
  candidate_id: string;
  status: Proposal["status"];
  task: string;
  expertise: string;
  preferences: Proposal["preferences"];
  changes: Proposal["changes"];
  rationale: string;
  decision_id: string;
  request_id: string;
  request_hash: string;
  expires_at: string;
  created_at: string;
  applied_revision: number | null;
};

const PROPOSAL_COLS =
  "id,tenant_id,app_id,subject_id,surface_id,base_revision,manifest_version,policy_version,role_version,config,config_hash,candidate_id,status,task,expertise,preferences,changes,rationale,decision_id,request_id,request_hash,expires_at,created_at,applied_revision";

function toProposal(r: ProposalRow): Proposal & { requestHash: string } {
  return {
    id: r.id,
    ownerSubjectId: r.subject_id,
    tenantId: r.tenant_id,
    appId: r.app_id,
    surfaceId: r.surface_id,
    baseRevision: r.base_revision,
    manifestVersion: r.manifest_version,
    policyVersion: r.policy_version,
    roleVersion: String(r.role_version),
    config: r.config,
    configHash: r.config_hash,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    status: r.status,
    decisionId: r.decision_id,
    requestId: r.request_id,
    candidateId: r.candidate_id,
    task: r.task,
    expertise: r.expertise,
    preferences: r.preferences ?? {},
    changes: r.changes ?? [],
    rationale: r.rationale,
    appliedRevision: r.applied_revision,
    requestHash: r.request_hash,
  };
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const { data, error } = await db().rpc(fn, args);
  if (error) fail(fn, error);
  return data as RpcResult;
}

export const supabaseStore: ContourStore = {
  async getMembership(subjectId, tenantId, appId): Promise<Membership | null> {
    const { data, error } = await db()
      .from("memberships")
      .select("tenant_id,subject_id,app_id,role,role_version,data_access,status,display_name")
      .eq("subject_id", subjectId)
      .eq("tenant_id", tenantId)
      .eq("app_id", appId)
      .maybeSingle();
    if (error) fail("getMembership", error);
    if (!data) return null;
    return {
      tenantId: data.tenant_id,
      subjectId: data.subject_id,
      appId: data.app_id,
      role: data.role,
      roleVersion: data.role_version,
      dataAccess: data.data_access,
      status: data.status,
      displayName: data.display_name,
    };
  },

  async isAgentAccessEnabled(appId) {
    const { data, error } = await db().from("apps").select("agent_access_enabled").eq("id", appId).maybeSingle();
    if (error) fail("isAgentAccessEnabled", error);
    return Boolean(data?.agent_access_enabled);
  },

  async getActiveView(owner): Promise<StoredView | null> {
    const { data, error } = await ownerFilter(
      db().from("user_views").select("revision,parent_revision,manifest_version,policy_version,config,config_hash"),
      owner,
    ).maybeSingle();
    if (error) fail("getActiveView", error);
    if (!data) return null;
    return {
      revision: data.revision,
      parentRevision: data.parent_revision,
      manifestVersion: data.manifest_version,
      policyVersion: data.policy_version,
      config: data.config,
      configHash: data.config_hash,
    };
  },

  async getHistoryEntry(owner, revision): Promise<HistoryEntry | null> {
    const { data, error } = await ownerFilter(
      db()
        .from("view_history")
        .select("revision,parent_revision,source,proposal_id,manifest_version,policy_version,config,config_hash,created_at"),
      owner,
    )
      .eq("revision", revision)
      .maybeSingle();
    if (error) fail("getHistoryEntry", error);
    if (!data) return null;
    return {
      revision: data.revision,
      parentRevision: data.parent_revision,
      source: data.source,
      proposalId: data.proposal_id,
      manifestVersion: data.manifest_version,
      policyVersion: data.policy_version,
      config: data.config,
      configHash: data.config_hash,
      createdAt: data.created_at,
    };
  },

  async listHistory(owner, limit) {
    const { data, error } = await ownerFilter(
      db()
        .from("view_history")
        .select("revision,parent_revision,source,proposal_id,manifest_version,policy_version,config,config_hash,created_at"),
      owner,
    )
      .order("revision", { ascending: false })
      .limit(limit);
    if (error) fail("listHistory", error);
    return (data ?? []).map((d) => ({
      revision: d.revision,
      parentRevision: d.parent_revision,
      source: d.source,
      proposalId: d.proposal_id,
      manifestVersion: d.manifest_version,
      policyVersion: d.policy_version,
      config: d.config,
      configHash: d.config_hash,
      createdAt: d.created_at,
    }));
  },

  async getPreferences(owner): Promise<UserPreferences> {
    const { data, error } = await ownerFilter(
      db().from("user_preferences").select("expertise,density,help,pins"),
      owner,
    ).maybeSingle();
    if (error) fail("getPreferences", error);
    if (!data) return { pins: [] };
    return {
      ...(data.expertise ? { expertise: data.expertise } : {}),
      ...(data.density ? { density: data.density } : {}),
      ...(data.help ? { help: data.help } : {}),
      pins: Array.isArray(data.pins) ? data.pins : [],
    };
  },

  async savePreferences(owner, prefs) {
    const { error } = await db()
      .from("user_preferences")
      .upsert(
        {
          tenant_id: owner.tenantId,
          app_id: owner.appId,
          subject_id: owner.subjectId,
          surface_id: owner.surfaceId,
          expertise: prefs.expertise ?? null,
          density: prefs.density ?? null,
          help: prefs.help ?? "auto",
          pins: prefs.pins,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,app_id,subject_id,surface_id" },
      );
    if (error) fail("savePreferences", error);
  },

  async getProposal(owner, id) {
    const { data, error } = await ownerFilter(db().from("proposals").select(PROPOSAL_COLS), owner).eq("id", id).maybeSingle();
    if (error) fail("getProposal", error);
    return data ? toProposal(data as ProposalRow) : null;
  },

  async findProposalByRequest(owner, requestId) {
    const { data, error } = await ownerFilter(db().from("proposals").select(PROPOSAL_COLS), owner)
      .eq("request_id", requestId)
      .maybeSingle();
    if (error) fail("findProposalByRequest", error);
    return data ? toProposal(data as ProposalRow) : null;
  },

  async listProposals(owner, limit) {
    const { data, error } = await ownerFilter(db().from("proposals").select(PROPOSAL_COLS), owner)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail("listProposals", error);
    return (data ?? []).map((r) => toProposal(r as ProposalRow));
  },

  async setProposalStatus(owner, id, from, to, reason) {
    const { data, error } = await ownerFilter(
      db().from("proposals").update({ status: to, status_reason: reason }),
      owner,
    )
      .eq("id", id)
      .eq("status", from)
      .select("id");
    if (error) fail("setProposalStatus", error);
    return (data ?? []).length > 0;
  },

  createProposal: (record) => rpc("contour_create_proposal", { p: record }),
  applyProposal: (params) => rpc("contour_apply_proposal", { p: params }),
  commitSnapshot: (params) => rpc("contour_commit_snapshot", { p: params }),
  reserveCredit: (owner, jobId) =>
    rpc("contour_reserve_credit", { p_tenant: owner.tenantId, p_app: owner.appId, p_subject: owner.subjectId, p_job: jobId }),
  releaseCredit: (jobId) => rpc("contour_release_credit", { p_job: jobId }),

  async creditBalance(owner) {
    const { data, error } = await db()
      .from("credits")
      .select("status")
      .eq("tenant_id", owner.tenantId)
      .eq("app_id", owner.appId)
      .eq("subject_id", owner.subjectId);
    if (error) fail("creditBalance", error);
    const rows = data ?? [];
    return {
      available: rows.filter((r) => r.status === "available").length,
      reserved: rows.filter((r) => r.status === "reserved").length,
      consumed: rows.filter((r) => r.status === "consumed").length,
    };
  },

  async recordDecision(e: DecisionEvent) {
    const { error } = await db().from("decision_events").insert({
      id: e.id,
      job_id: e.jobId,
      tenant_id: e.owner.tenantId,
      app_id: e.owner.appId,
      subject_id: e.owner.subjectId,
      surface_id: e.owner.surfaceId,
      client_id: e.clientId,
      channel: e.channel,
      manifest_version: e.manifestVersion,
      policy_version: e.policyVersion,
      model_version: e.modelVersion,
      candidate_ids: e.candidateIds,
      candidate_hashes: e.candidateHashes,
      selected_id: e.selectedId,
      distribution: e.distribution,
      confidence: e.confidence,
      confidence_floor: e.confidenceFloor,
      inputs: e.inputs,
      assumptions: e.assumptions,
      validation: e.validation,
      validation_rules: e.validationRules,
      outcome: e.outcome,
      outcome_reason: e.outcomeReason,
      provider_status: e.providerStatus,
      provider_latency_ms: e.providerLatencyMs,
      total_latency_ms: e.totalLatencyMs,
      input_tokens: e.inputTokens,
      output_tokens: e.outputTokens,
      provider_cost: e.providerCost,
      currency: e.currency,
      rationale: e.rationale,
      proposal_id: e.proposalId,
    });
    // Diagnostics must never break the user flow.
    if (error) console.error("[contour] recordDecision failed", error.message);
  },

  async recordUsage(e) {
    const { error } = await db()
      .from("usage_events")
      .upsert(
        {
          job_id: e.jobId,
          tenant_id: e.owner.tenantId,
          app_id: e.owner.appId,
          subject_id: e.owner.subjectId,
          provider: e.provider,
          model_version: e.modelVersion,
          provider_usage: e.usage,
          provider_cost: e.cost,
          currency: e.currency,
          status: e.status,
        },
        { onConflict: "job_id", ignoreDuplicates: true },
      );
    if (error) console.error("[contour] recordUsage failed", error.message);
  },

  async listDecisions(owner, limit) {
    const { data, error } = await db()
      .from("decision_events")
      .select("*")
      .eq("tenant_id", owner.tenantId)
      .eq("app_id", owner.appId)
      .eq("subject_id", owner.subjectId)
      .eq("surface_id", owner.surfaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail("listDecisions", error);
    return (data ?? []).map(
      (d): DecisionEvent => ({
        id: d.id,
        jobId: d.job_id,
        owner,
        clientId: d.client_id,
        channel: d.channel,
        manifestVersion: d.manifest_version,
        policyVersion: d.policy_version,
        modelVersion: d.model_version,
        candidateIds: d.candidate_ids,
        candidateHashes: d.candidate_hashes,
        selectedId: d.selected_id,
        distribution: d.distribution,
        confidence: d.confidence,
        confidenceFloor: d.confidence_floor,
        inputs: d.inputs,
        assumptions: d.assumptions,
        validation: d.validation,
        validationRules: d.validation_rules,
        outcome: d.outcome,
        outcomeReason: d.outcome_reason,
        providerStatus: d.provider_status,
        providerLatencyMs: d.provider_latency_ms,
        totalLatencyMs: d.total_latency_ms,
        inputTokens: d.input_tokens,
        outputTokens: d.output_tokens,
        providerCost: d.provider_cost === null ? null : Number(d.provider_cost),
        currency: d.currency,
        rationale: d.rationale,
        proposalId: d.proposal_id,
        createdAt: d.created_at,
      }),
    );
  },

  async rateLimit(bucket, windowSeconds, max) {
    const { data, error } = await db().rpc("contour_rate_limit", {
      p_bucket: bucket,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (error) fail("rateLimit", error);
    return Boolean(data);
  },
};
