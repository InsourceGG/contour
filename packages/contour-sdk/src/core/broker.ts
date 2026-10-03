import { randomUUID } from "node:crypto";
import { z } from "zod";
import { configsEqual, diffConfigs, generateCandidates, type CandidatePolicy } from "./candidates";
import { hashJson } from "./hash";
import type { AdaptiveRegistry } from "./registry";
import type {
  Candidate,
  ChangeItem,
  JsonValue,
  LiveJob,
  ManualPin,
  Proposal,
  ProposalStatus,
  ProposeRequest,
  ProposeResult,
  Scope,
  SurfaceManifest,
  UserPreferences,
  VerifiedContext,
  ViewConfig,
  ViewSnapshot,
} from "./types";
import { ContourError } from "./types";
import { ManualPinSchema, validateViewConfig } from "./validate";

// ------------------------------------------------------------------ ports

export type Owner = { tenantId: string; appId: string; subjectId: string; surfaceId: string };

export type StoredView = {
  revision: number;
  parentRevision: number | null;
  manifestVersion: string;
  policyVersion: string;
  config: unknown;
  configHash: string;
};

export type HistoryEntry = StoredView & {
  source: "default" | "proposal" | "undo" | "reset";
  proposalId: string | null;
  createdAt: string;
};

export type Membership = {
  tenantId: string;
  subjectId: string;
  appId: string;
  role: string;
  roleVersion: number;
  dataAccess: boolean;
  status: "active" | "suspended";
  displayName: string;
};

export type RpcResult = { ok: boolean; code?: string; [k: string]: unknown };

export type StoredJob = LiveJob & { proposalId: string | null };
export type JobPatch = Partial<Pick<StoredJob, "status" | "proposalId" | "changedComponents" | "message">>;

export type DecisionEvent = {
  id: string;
  jobId: string;
  owner: Owner;
  clientId: string;
  channel: string;
  manifestVersion: string;
  policyVersion: string;
  modelVersion: string | null;
  candidateIds: string[];
  candidateHashes: Record<string, string>;
  selectedId: string | null;
  distribution: Record<string, number> | null;
  confidence: number | null;
  confidenceFloor: number;
  inputs: Record<string, JsonValue>;
  assumptions: string[];
  validation: "passed" | "failed" | "not_run";
  validationRules: string[];
  outcome: "previewed" | "kept" | "asked" | "rejected_input" | "error";
  outcomeReason: string | null;
  providerStatus: SelectorResult["status"] | "skipped";
  providerLatencyMs: number | null;
  totalLatencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  providerCost: number | null;
  currency: string | null;
  rationale: string | null;
  proposalId: string | null;
  /** Set by the store when reading; ignored on write. */
  createdAt?: string;
};

export interface ContourStore {
  getMembership(subjectId: string, tenantId: string, appId: string): Promise<Membership | null>;
  isAgentAccessEnabled(tenantId: string, appId: string): Promise<boolean>;
  getActiveView(owner: Owner): Promise<StoredView | null>;
  getHistoryEntry(owner: Owner, revision: number): Promise<HistoryEntry | null>;
  listHistory(owner: Owner, limit: number): Promise<HistoryEntry[]>;
  getPreferences(owner: Owner): Promise<UserPreferences>;
  savePreferences(owner: Owner, prefs: UserPreferences): Promise<void>;
  getProposal(owner: Owner, id: string): Promise<Proposal | null>;
  createJob(owner: Owner, input: { clientId: string; task: string; expertise: string }): Promise<string>;
  updateJob(owner: Owner, id: string, patch: JobPatch): Promise<void>;
  /** Most recent job started since the supplied epoch milliseconds. */
  getLatestJob(owner: Owner, sinceMs: number): Promise<StoredJob | null>;
  findProposalByRequest(owner: Owner, requestId: string): Promise<(Proposal & { requestHash: string }) | null>;
  listProposals(owner: Owner, limit: number): Promise<Proposal[]>;
  setProposalStatus(owner: Owner, id: string, from: ProposalStatus, to: ProposalStatus, reason: string): Promise<boolean>;
  createProposal(record: Record<string, JsonValue>): Promise<RpcResult>;
  applyProposal(params: Record<string, JsonValue>): Promise<RpcResult>;
  commitSnapshot(params: Record<string, JsonValue>): Promise<RpcResult>;
  reserveCredit(owner: Owner, jobId: string): Promise<RpcResult>;
  releaseCredit(jobId: string): Promise<RpcResult>;
  /** `available` is null and `unmetered` true when the store runs without billing. */
  creditBalance(owner: Owner): Promise<{ available: number | null; reserved: number; consumed: number; unmetered?: boolean }>;
  recordDecision(event: DecisionEvent): Promise<void>;
  recordUsage(event: {
    jobId: string;
    owner: Owner;
    provider: string;
    modelVersion: string | null;
    usage: Record<string, JsonValue>;
    cost: number | null;
    currency: string | null;
    status: string;
  }): Promise<void>;
  listDecisions(owner: Owner, limit: number): Promise<DecisionEvent[]>;
  rateLimit(bucket: string, windowSeconds: number, max: number): Promise<boolean>;
}

export type SelectorInput = {
  /** The surface being adapted, from its manifest. Names the screen in the prompt. */
  surface?: { label: string; description: string };
  task: { id: string; label: string; description: string };
  expertise: { id: string; label: string; description: string };
  preferences: { density?: string; help?: string };
  note?: string;
  current: { summary: string; matchesCandidate: string | null };
  candidates: { id: string; label: string; summary: string }[];
};

export type SelectorResult = {
  status: "ok" | "timeout" | "error" | "malformed" | "unconfigured";
  choice?: string;
  confidence?: number;
  distribution?: Record<string, number>;
  modelVersion: string | null;
  providerLatencyMs: number | null;
  usage?: { inputTokens: number | null; outputTokens: number | null };
  cost?: number | null;
  currency?: string | null;
  error?: string;
};

export interface Selector {
  readonly provider: string;
  select(input: SelectorInput): Promise<SelectorResult>;
}

export type ReaderDef = {
  id: string;
  description: string;
  requiredScope: Scope;
  inputSchema: z.ZodType;
  /** JSON-schema-ish description exposed to agents. */
  inputDescription: Record<string, JsonValue>;
  fields: readonly string[];
  read(ctx: VerifiedContext, input: unknown): Promise<unknown>;
};

export type BrokerOptions = {
  registry: AdaptiveRegistry;
  policies: Record<string, CandidatePolicy>;
  readers: ReadonlyMap<string, ReaderDef>;
  store: ContourStore;
  selector: Selector;
  confidenceFloor: number;
  appUrl: string;
  readerTimeoutMs?: number;
  maxReaderOutputBytes?: number;
  now?: () => Date;
};

// ------------------------------------------------------------- input schemas

const RequestId = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const ShortId = z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/);

export const ProposeRequestSchema = z.strictObject({
  surfaceId: ShortId,
  baseRevision: z.number().int().min(0).max(1_000_000),
  task: z.strictObject({ id: ShortId, source: z.literal("explicit") }),
  expertise: z.strictObject({ level: ShortId, source: z.literal("explicit") }),
  preferences: z
    .strictObject({
      density: z.enum(["comfortable", "compact"]).optional(),
      help: z.enum(["auto", "show", "hide"]).optional(),
    })
    .optional(),
  note: z.string().max(280).optional(),
  requestId: RequestId,
});

export const PreferencesSchema = z.strictObject({
  expertise: z.enum(["beginner", "expert"]).optional(),
  density: z.enum(["comfortable", "compact"]).optional(),
  help: z.enum(["auto", "show", "hide"]).optional(),
  pins: z.array(ManualPinSchema).max(12),
});

const ApplySchema = z.strictObject({
  proposalId: z.uuid(),
  configHash: z.string().min(10).max(100),
  idempotencyKey: RequestId,
});

const SnapshotOpSchema = z.strictObject({
  expectedRevision: z.number().int().min(0),
  idempotencyKey: RequestId,
});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ContourError("INVALID_INPUT", "Request failed schema validation", {
      issues: r.error.issues.slice(0, 10).map((i) => ({
        code: "INVALID_INPUT",
        path: i.path.join(".") || "$",
        message: i.message,
      })),
    });
  }
  return r.data;
}

// ------------------------------------------------------------------ broker

export type PreviewState = "ready" | "expired" | "stale" | "invalid" | "applied" | "rejected";

export type PreviewData = {
  proposal: Proposal;
  state: PreviewState;
  stateReason: string | null;
  current: ViewSnapshot;
  proposed: ViewConfig;
  changes: ChangeItem[];
  pins: ManualPin[];
};

export type LiveData = {
  revision: number;
  configHash: string;
  job: LiveJob | null;
  proposal: PreviewData | null;
};

export function createAdaptiveBroker(opts: BrokerOptions) {
  const { registry, store, selector } = opts;
  const now = opts.now ?? (() => new Date());

  function ownerOf(ctx: VerifiedContext): Owner {
    return { tenantId: ctx.tenantId, appId: ctx.appId, subjectId: ctx.subjectId, surfaceId: ctx.surfaceId };
  }

  function requireScope(ctx: VerifiedContext, scope: Scope) {
    if (!ctx.scopes.has(scope)) throw new ContourError("FORBIDDEN", `Missing scope ${scope}`);
  }

  function requireHost(ctx: VerifiedContext) {
    if (ctx.channel !== "host") throw new ContourError("FORBIDDEN", "This operation is only available in the host app");
    requireScope(ctx, "view:commit");
  }

  function manifestFor(ctx: VerifiedContext): SurfaceManifest {
    const m = registry.getSurface(ctx.surfaceId);
    if (!m || m.appId !== ctx.appId) throw new ContourError("NOT_FOUND", "Unknown surface");
    return m;
  }

  /** Re-check membership on every broker call (permissions can change at any time). */
  async function requireMembership(ctx: VerifiedContext): Promise<Membership> {
    const m = await store.getMembership(ctx.subjectId, ctx.tenantId, ctx.appId);
    if (!m || m.status !== "active") throw new ContourError("FORBIDDEN", "No active membership");
    return m;
  }

  async function requireAgentAccess(ctx: VerifiedContext) {
    if (ctx.channel === "mcp" && !(await store.isAgentAccessEnabled(ctx.tenantId, ctx.appId))) {
      throw new ContourError("AGENT_ACCESS_DISABLED", "The company has disabled agent access for this app");
    }
  }

  async function rateLimit(ctx: VerifiedContext, op: string, max: number, windowSeconds = 60) {
    const ok = await store.rateLimit(`${op}:${ctx.tenantId}:${ctx.subjectId}`, windowSeconds, max);
    if (!ok) throw new ContourError("RATE_LIMITED", `Too many ${op} requests; retry shortly`);
  }

  async function loadSnapshot(ctx: VerifiedContext, manifest: SurfaceManifest): Promise<ViewSnapshot> {
    const owner = ownerOf(ctx);
    const defaultSnap = (revision: number, source: ViewSnapshot["source"], reason?: string): ViewSnapshot => ({
      surfaceId: manifest.surfaceId,
      revision,
      policyVersion: manifest.policyVersion,
      config: manifest.defaultConfig,
      configHash: hashJson(manifest.defaultConfig),
      source,
      ...(reason ? { fallbackReason: reason } : {}),
    });
    let stored: StoredView | null;
    try {
      stored = await store.getActiveView(owner);
    } catch {
      return defaultSnap(0, "fallback", "Saved view is temporarily unavailable; showing the company default.");
    }
    if (!stored) return defaultSnap(0, "default");
    if (stored.manifestVersion !== manifest.manifestVersion || stored.policyVersion !== manifest.policyVersion) {
      return defaultSnap(stored.revision, "fallback", "Your saved view was made for an earlier version of this screen.");
    }
    const result = validateViewConfig(manifest, stored.config);
    if (!result.ok || hashJson(result.config) !== stored.configHash) {
      return defaultSnap(stored.revision, "fallback", "Your saved view failed validation; showing the company default.");
    }
    return {
      surfaceId: manifest.surfaceId,
      revision: stored.revision,
      policyVersion: stored.policyVersion,
      config: result.config,
      configHash: stored.configHash,
      source: "saved",
    };
  }

  async function expireIfNeeded(owner: Owner, p: Proposal): Promise<Proposal> {
    if (p.status === "READY" && new Date(p.expiresAt).getTime() <= now().getTime()) {
      await store.setProposalStatus(owner, p.id, "READY", "EXPIRED", "expired before approval");
      return { ...p, status: "EXPIRED" };
    }
    return p;
  }

  // ------------------------------------------------------------ agent API

  async function describeSurface(ctx: VerifiedContext) {
    requireScope(ctx, "view:read");
    await requireAgentAccess(ctx);
    const membership = await requireMembership(ctx);
    const manifest = manifestFor(ctx);
    const snapshot = await loadSnapshot(ctx, manifest);
    const canRead = ctx.scopes.has("data:read") && membership.dataAccess;
    return {
      appId: manifest.appId,
      surfaceId: manifest.surfaceId,
      label: manifest.label,
      description: manifest.description,
      manifestVersion: manifest.manifestVersion,
      policyVersion: manifest.policyVersion,
      currentRevision: snapshot.revision,
      grantedScopes: [...ctx.scopes].sort(),
      components: manifest.components.map((c) => ({
        id: c.id,
        semanticRole: c.semanticRole,
        description: c.description,
        variants: c.variants.map((v) => ({ id: v, description: c.variantDescriptions[v] })),
        settings: c.settingsSchema.properties,
        locked: c.locked,
        required: c.required,
        allowedRegions: c.allowedRegions,
        ...(canRead && c.readerId ? { readerId: c.readerId } : {}),
      })),
      readers: canRead
        ? manifest.components
            .filter((c) => c.readerId && opts.readers.has(c.readerId))
            .map((c) => {
              const r = opts.readers.get(c.readerId!)!;
              return { id: r.id, description: r.description, input: r.inputDescription, fields: r.fields };
            })
        : [],
      templates: manifest.templates.map((t) => ({ id: t.id, label: t.label, description: t.description })),
      densityTokens: manifest.tokenIds,
      tasks: manifest.tasks,
      expertiseLevels: manifest.expertiseLevels,
      supportedPreferences: { density: ["comfortable", "compact"], help: ["auto", "show", "hide"] },
      limits: { maxNoteLength: manifest.limits.maxNoteLength, proposalTtlSeconds: manifest.limits.proposalTtlSeconds },
      previewSemantics:
        "propose_view prepares a pending preview that may appear live in the host dashboard. It returns a preview URL for a full comparison. Nothing is saved until the signed-in user chooses Accept in the host app; the user can also Keep current. Agents cannot commit. Each READY proposal consumes one prepaid adaptation credit.",
    };
  }

  async function readComponentData(ctx: VerifiedContext, readerId: string, input: unknown) {
    requireScope(ctx, "data:read");
    await requireAgentAccess(ctx);
    const membership = await requireMembership(ctx);
    if (!membership.dataAccess) throw new ContourError("FORBIDDEN", "Data access has been revoked for this user");
    const manifest = manifestFor(ctx);
    const parsedId = parse(z.string().min(1).max(64).regex(/^[a-z0-9._-]+$/), readerId);
    const component = manifest.components.find((c) => c.readerId === parsedId);
    const reader = opts.readers.get(parsedId);
    if (!component || !reader) throw new ContourError("NOT_FOUND", "Unknown reader for this surface");
    requireScope(ctx, reader.requiredScope);
    await rateLimit(ctx, "read", 60);
    const typed = parse(reader.inputSchema, input ?? {});
    const timeoutMs = opts.readerTimeoutMs ?? 5000;
    const data = await Promise.race([
      reader.read(ctx, typed),
      new Promise<never>((_, rej) => setTimeout(() => rej(new ContourError("INTERNAL", "Reader timed out")), timeoutMs)),
    ]);
    const size = JSON.stringify(data).length;
    if (size > (opts.maxReaderOutputBytes ?? 64_000)) throw new ContourError("INTERNAL", "Reader output exceeded the size limit");
    return {
      readerId: reader.id,
      componentId: component.id,
      semanticRole: component.semanticRole,
      description: reader.description,
      fields: reader.fields,
      untrustedContent: true,
      data,
    };
  }

  async function getView(ctx: VerifiedContext, args: { proposalId?: string } = {}) {
    requireScope(ctx, "view:read");
    await requireAgentAccess(ctx);
    await requireMembership(ctx);
    const manifest = manifestFor(ctx);
    const snapshot = await loadSnapshot(ctx, manifest);
    let proposal: { id: string; status: ProposalStatus; appliedRevision: number | null; expiresAt: string } | null = null;
    if (args.proposalId !== undefined) {
      const id = parse(z.uuid(), args.proposalId);
      const owner = ownerOf(ctx);
      const p = await store.getProposal(owner, id);
      if (!p) throw new ContourError("NOT_FOUND", "Proposal not found");
      const fresh = await expireIfNeeded(owner, p);
      proposal = { id: fresh.id, status: fresh.status, appliedRevision: fresh.appliedRevision ?? null, expiresAt: fresh.expiresAt };
    }
    return { snapshot, proposal };
  }

  async function proposeView(ctx: VerifiedContext, rawRequest: unknown): Promise<ProposeResult> {
    const started = Date.now();
    requireScope(ctx, "view:propose");
    await requireAgentAccess(ctx);
    const membership = await requireMembership(ctx);
    const manifest = manifestFor(ctx);
    const policy = opts.policies[manifest.surfaceId];
    const req = parse(ProposeRequestSchema, rawRequest) as ProposeRequest;
    if (req.surfaceId !== ctx.surfaceId) throw new ContourError("FORBIDDEN", "Surface is not authorized for this grant");
    if (req.note && req.note.length > manifest.limits.maxNoteLength) throw new ContourError("INVALID_INPUT", "Note too long");
    await rateLimit(ctx, "propose", 10);

    const owner = ownerOf(ctx);
    const requestHash = hashJson({ ...req, requestId: undefined });

    // Idempotent replay of an identical request.
    const existing = await store.findProposalByRequest(owner, req.requestId);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ContourError("IDEMPOTENCY_CONFLICT", "requestId was already used with a different payload");
      }
      const p = await expireIfNeeded(owner, existing);
      return {
        outcome: "READY",
        proposalId: p.id,
        status: p.status,
        baseRevision: p.baseRevision,
        changes: p.changes,
        rationale: p.rationale,
        previewUrl: `${opts.appUrl}/preview/${p.id}`,
        expiresAt: p.expiresAt,
        decisionId: p.decisionId,
        creditConsumed: false,
      };
    }

    const snapshot = await loadSnapshot(ctx, manifest);
    if (req.baseRevision !== snapshot.revision) {
      throw new ContourError("STALE_REVISION", "The view changed since baseRevision; read it again", {
        currentRevision: snapshot.revision,
      });
    }

    const decisionId = randomUUID();
    let jobId: string = randomUUID();
    const prefs = await store.getPreferences(owner);
    const inputs: Record<string, JsonValue> = {
      task: req.task.id,
      expertise: req.expertise.level,
      preferences: (req.preferences ?? {}) as Record<string, JsonValue>,
      noteProvided: Boolean(req.note),
      pins: prefs.pins.length,
      baseRevision: req.baseRevision,
      source: "explicit",
    };
    const baseEvent = {
      id: decisionId,
      jobId,
      owner,
      clientId: ctx.clientId,
      channel: ctx.channel,
      manifestVersion: manifest.manifestVersion,
      policyVersion: manifest.policyVersion,
      confidenceFloor: opts.confidenceFloor,
      inputs,
      assumptions: [] as string[],
    };

    // Deterministic clarification before any paid work.
    const task = manifest.tasks.find((t) => t.id === req.task.id);
    const expertise = manifest.expertiseLevels.find((e) => e.id === req.expertise.level);
    if (!task || !expertise || !policy?.taskLayouts[req.task.id]) {
      const question = !task
        ? "Which supported task are you working on?"
        : "Which supported expertise level fits you for this task?";
      await store.recordDecision({
        ...baseEvent,
        modelVersion: null,
        candidateIds: [],
        candidateHashes: {},
        selectedId: "ASK",
        distribution: null,
        confidence: null,
        validation: "not_run",
        validationRules: [],
        outcome: "asked",
        outcomeReason: !task ? "unsupported_task" : "unsupported_expertise",
        providerStatus: "skipped",
        providerLatencyMs: null,
        totalLatencyMs: Date.now() - started,
        inputTokens: null,
        outputTokens: null,
        providerCost: null,
        currency: null,
        rationale: null,
        proposalId: null,
      });
      return {
        outcome: "ASK",
        question,
        supportedChoices: { task: manifest.tasks.map((t) => t.id), expertise: manifest.expertiseLevels.map((e) => e.id) },
        decisionId,
      };
    }

    // Progress is best-effort and begins only after deterministic clarification.
    // Do not log provider errors or request content: both can contain secrets.
    try {
      jobId = await store.createJob(owner, { clientId: ctx.clientId, task: task.id, expertise: expertise.id });
      baseEvent.jobId = jobId;
    } catch {
      console.error("[contour] createJob failed");
    }
    const updateJob = async (patch: JobPatch) => {
      try {
        await store.updateJob(owner, jobId, patch);
      } catch {
        console.error("[contour] updateJob failed");
      }
    };

    let reserved = false;
    let released = false;
    // Set when the store runs without billing: nothing is reserved or consumed.
    let unmetered = false;
    const release = async () => {
      if (reserved && !released) {
        released = true;
        await store.releaseCredit(jobId);
      }
    };

    try {
      // Reserve one prepaid credit for this adaptation job (credits mode only;
      // an unmetered store answers status "unmetered" without reserving).
      const reservation = await store.reserveCredit(owner, jobId);
      if (!reservation.ok) {
        throw new ContourError("PAYMENT_REQUIRED", "No adaptation credit available. Buy one in the host app.", {
          billingUrl: `${opts.appUrl}/billing`,
        });
      }
      unmetered = reservation.status === "unmetered";
      reserved = !unmetered;
      const gen = generateCandidates(manifest, policy, {
        task: req.task.id,
        preferences: req.preferences ?? {},
        pins: prefs.pins,
      });
      const candidates = gen.candidates;
      const candidateHashes = Object.fromEntries(candidates.map((c) => [c.id, c.configHash]));
      const allIds = [...candidates.map((c) => c.id), "KEEP", "ASK"];

      if (candidates.length === 0) {
        await release();
        const reason = gen.pinConflicts.length ? "pin_conflict" : "no_valid_candidates";
        await updateJob({ status: "asked", message: "Choose another task or adjust your manual pins." });
        await store.recordDecision({
          ...baseEvent,
          modelVersion: null,
          candidateIds: allIds,
          candidateHashes,
          selectedId: "ASK",
          distribution: null,
          confidence: null,
          validation: "failed",
          validationRules: gen.rejected.flatMap((r) => r.issues.map((i) => i.code)).slice(0, 20),
          outcome: "asked",
          outcomeReason: reason,
          providerStatus: "skipped",
          providerLatencyMs: null,
          totalLatencyMs: Date.now() - started,
          inputTokens: null,
          outputTokens: null,
          providerCost: null,
          currency: null,
          rationale: null,
          proposalId: null,
        });
        return {
          outcome: "ASK",
          question:
            reason === "pin_conflict"
              ? `Your manual pins conflict with every approved layout for this task (${gen.pinConflicts
                  .slice(0, 2)
                  .map((i) => i.message)
                  .join("; ")}). Unpin a component or choose another task?`
              : "No approved layout fits these preferences. Choose another task or preference?",
          supportedChoices: { task: manifest.tasks.map((t) => t.id), unpin: prefs.pins.map((p) => p.componentId) },
          decisionId,
        };
      }

      const matchesCurrent = candidates.find((c) => configsEqual(c.config, snapshot.config))?.id ?? null;
      const selection = await selector.select({
        surface: { label: manifest.label, description: manifest.description },
        task,
        expertise,
        preferences: req.preferences ?? {},
        note: req.note,
        current: {
          summary: describeCurrent(manifest, snapshot.config),
          matchesCandidate: matchesCurrent,
        },
        candidates: candidates.map((c) => ({ id: c.id, label: c.label, summary: c.summary })),
      });

      // Decision policy: KEEP on any provider problem, unknown choice, or low confidence.
      let outcome: "READY" | "KEEP" | "ASK" = "KEEP";
      let reason = "";
      let chosen: Candidate | undefined;
      if (selection.status !== "ok") {
        reason = `provider_${selection.status}`;
      } else if (selection.choice === "KEEP") {
        reason = "model_keep";
      } else if (selection.choice === "ASK") {
        outcome = "ASK";
        reason = "model_ask";
      } else if ((selection.confidence ?? 0) < opts.confidenceFloor) {
        reason = "low_confidence";
      } else {
        chosen = candidates.find((c) => c.id === selection.choice);
        if (!chosen) reason = "unknown_choice";
        else if (configsEqual(chosen.config, snapshot.config)) {
          reason = "already_current";
          chosen = undefined;
        } else outcome = "READY";
      }

      const usageBase = {
        modelVersion: selection.modelVersion,
        providerLatencyMs: selection.providerLatencyMs,
        inputTokens: selection.usage?.inputTokens ?? null,
        outputTokens: selection.usage?.outputTokens ?? null,
        providerCost: selection.cost ?? null,
        currency: selection.currency ?? null,
      };
      await store.recordUsage({
        jobId,
        owner,
        provider: selector.provider,
        modelVersion: selection.modelVersion,
        usage: { inputTokens: usageBase.inputTokens, outputTokens: usageBase.outputTokens, latencyMs: selection.providerLatencyMs },
        cost: usageBase.providerCost,
        currency: usageBase.currency,
        status: selection.status,
      });

      if (outcome !== "READY" || !chosen) {
        await release();
        await updateJob({
          status: selection.status !== "ok" ? "failed" : outcome === "ASK" ? "asked" : "kept",
          message: outcome === "ASK" ? "Clarify the task and expertise level for this view." : keepMessage(reason),
        });
        await store.recordDecision({
          ...baseEvent,
          ...usageBase,
          candidateIds: allIds,
          candidateHashes,
          selectedId: selection.choice ?? null,
          distribution: selection.distribution ?? null,
          confidence: selection.confidence ?? null,
          validation: "passed",
          validationRules: [],
          outcome: outcome === "ASK" ? "asked" : "kept",
          outcomeReason: reason,
          providerStatus: selection.status,
          totalLatencyMs: Date.now() - started,
          rationale: null,
          proposalId: null,
        });
        if (outcome === "ASK") {
          return {
            outcome: "ASK",
            question: "Your stated context is ambiguous. Which task and expertise level should this view serve?",
            supportedChoices: {
              task: manifest.tasks.map((t) => t.id),
              expertise: manifest.expertiseLevels.map((e) => e.id),
              density: ["comfortable", "compact"],
            },
            decisionId,
          };
        }
        return { outcome: "KEEP", reason: keepMessage(reason), decisionId, currentRevision: snapshot.revision };
      }

      // Validate the complete selected result once more before persisting.
      const final = validateViewConfig(manifest, chosen.config, { pins: prefs.pins });
      if (!final.ok) throw new ContourError("INVALID_CONFIG", "Selected candidate failed validation", { issues: final.issues });
      const changes = diffConfigs(manifest, snapshot.config, final.config);
      const rationale = buildRationale(task.label, expertise.label, chosen, changes, req.preferences ?? {}, selection.confidence);
      const expiresAt = new Date(now().getTime() + manifest.limits.proposalTtlSeconds * 1000).toISOString();

      const created = await store.createProposal({
        tenant_id: owner.tenantId,
        app_id: owner.appId,
        subject_id: owner.subjectId,
        surface_id: owner.surfaceId,
        client_id: ctx.clientId,
        base_revision: snapshot.revision,
        manifest_version: manifest.manifestVersion,
        policy_version: manifest.policyVersion,
        role_version: membership.roleVersion,
        config: final.config as unknown as JsonValue,
        config_hash: chosen.configHash,
        candidate_id: chosen.id,
        task: task.id,
        expertise: expertise.id,
        preferences: (req.preferences ?? {}) as Record<string, JsonValue>,
        changes: changes as unknown as JsonValue,
        rationale,
        decision_id: decisionId,
        job_id: jobId,
        request_id: req.requestId,
        request_hash: requestHash,
        expires_at: expiresAt,
      });
      if (!created.ok) {
        await release();
        throw new ContourError(
          (created.code as "IDEMPOTENCY_CONFLICT" | "PAYMENT_REQUIRED") ?? "INTERNAL",
          created.code === "IDEMPOTENCY_CONFLICT" ? "requestId reused with a different payload" : "Could not persist the proposal",
        );
      }
      if (created.replayed) {
        // A concurrent identical request already persisted (and paid for) this proposal.
        await release();
      }
      released = true; // credit consumed inside the proposal transaction
      const proposalId = String(created.proposalId);
      await store.recordDecision({
        ...baseEvent,
        ...usageBase,
        candidateIds: allIds,
        candidateHashes,
        selectedId: chosen.id,
        distribution: selection.distribution ?? null,
        confidence: selection.confidence ?? null,
        validation: "passed",
        validationRules: final.rules,
        outcome: "previewed",
        outcomeReason: null,
        providerStatus: selection.status,
        totalLatencyMs: Date.now() - started,
        rationale,
        proposalId,
      });
      const changedComponents = manifest.components
        .filter((component) => {
          const before = snapshot.config.placements.find((p) => p.componentId === component.id);
          const after = final.config.placements.find((p) => p.componentId === component.id);
          return hashJson(before ?? null) !== hashJson(after ?? null);
        })
        .map((component) => component.id);
      await updateJob({ status: "ready", proposalId, changedComponents, message: null });
      return {
        outcome: "READY",
        proposalId,
        status: "READY",
        baseRevision: snapshot.revision,
        changes,
        rationale,
        previewUrl: `${opts.appUrl}/preview/${proposalId}`,
        expiresAt,
        decisionId,
        creditConsumed: !unmetered && !created.replayed,
      };
    } catch (err) {
      await release().catch(() => {});
      await updateJob({ status: "failed", message: "The view could not be prepared. Your current view is unchanged." });
      throw err;
    }
  }

  // --------------------------------------------------- host-only operations

  async function getPreview(ctx: VerifiedContext, proposalId: string): Promise<PreviewData> {
    if (ctx.channel !== "host") throw new ContourError("FORBIDDEN", "This operation is only available in the host app");
    requireScope(ctx, "view:read");
    await requireMembership(ctx);
    const manifest = manifestFor(ctx);
    const owner = ownerOf(ctx);
    const id = parse(z.uuid(), proposalId);
    let p = await store.getProposal(owner, id);
    if (!p) throw new ContourError("NOT_FOUND", "Proposal not found");
    p = await expireIfNeeded(owner, p);
    const current = await loadSnapshot(ctx, manifest);
    const prefs = await store.getPreferences(owner);
    let state: PreviewState = "ready";
    let stateReason: string | null = null;
    if (p.status === "APPLIED") state = "applied";
    else if (p.status === "REJECTED") state = "rejected";
    else if (p.status === "EXPIRED") {
      state = "expired";
      stateReason = "This proposal expired before it was accepted.";
    }
    else if (p.status === "STALE") {
      state = "stale";
      stateReason = "Your view changed after this proposal was made.";
    }
    else if (p.status === "INVALID") {
      state = "invalid";
      stateReason = "This proposal no longer passes company policy.";
    }
    else {
      const membership = await requireMembership(ctx);
      const valid = validateViewConfig(manifest, p.config, { pins: prefs.pins });
      if (p.manifestVersion !== manifest.manifestVersion || p.policyVersion !== manifest.policyVersion || String(membership.roleVersion) !== String(p.roleVersion)) {
        await store.setProposalStatus(owner, p.id, "READY", "INVALID", "manifest, policy or role changed");
        state = "invalid";
        stateReason = "The screen, its policy, or your role changed after this proposal was made.";
      } else if (!valid.ok) {
        await store.setProposalStatus(owner, p.id, "READY", "INVALID", "failed validation at preview");
        state = "invalid";
        stateReason = `This proposal no longer passes validation: ${valid.issues[0]?.message ?? "unknown rule"}.`;
      } else if (hashJson(valid.config) !== p.configHash) {
        await store.setProposalStatus(owner, p.id, "READY", "INVALID", "hash mismatch at preview");
        state = "invalid";
        stateReason = "The stored proposal does not match its recorded hash.";
      } else if (current.revision !== p.baseRevision) {
        await store.setProposalStatus(owner, p.id, "READY", "STALE", "base revision changed");
        state = "stale";
        stateReason = `Your view changed (now revision ${current.revision}) after this proposal was made for revision ${p.baseRevision}.`;
      }
    }
    return {
      proposal: { ...p, status: state === "invalid" ? "INVALID" : state === "stale" ? "STALE" : p.status },
      state,
      stateReason,
      current,
      proposed: p.config,
      changes: diffConfigs(manifest, current.config, p.config),
      pins: prefs.pins,
    };
  }

  async function getLive(ctx: VerifiedContext): Promise<LiveData> {
    if (ctx.channel !== "host") throw new ContourError("FORBIDDEN", "This operation is only available in the host app");
    requireScope(ctx, "view:read");
    await requireMembership(ctx);
    await rateLimit(ctx, "live", 150, 60);
    const current = await loadSnapshot(ctx, manifestFor(ctx));
    const owner = ownerOf(ctx);
    const latest = await store.getLatestJob(owner, now().getTime() - 10 * 60 * 1000);
    let proposal: PreviewData | null = null;
    if (latest?.status === "ready" && latest.proposalId) {
      try {
        const preview = await getPreview(ctx, latest.proposalId);
        if (preview.state === "ready" && preview.proposal.status === "READY") proposal = preview;
      } catch (error) {
        // A deleted proposal cannot be previewed; other errors must remain visible.
        if (!(error instanceof ContourError) || error.code !== "NOT_FOUND") throw error;
      }
    }
    // Omit internal proposal linkage and any future store-only fields.
    const job: LiveJob | null = latest ? {
      id: latest.id,
      status: latest.status,
      task: latest.task,
      expertise: latest.expertise,
      changedComponents: latest.changedComponents,
      message: latest.message,
      startedAt: latest.startedAt,
      updatedAt: latest.updatedAt,
    } : null;
    return { revision: current.revision, configHash: current.configHash, job, proposal };
  }

  async function applyProposal(ctx: VerifiedContext, raw: unknown) {
    requireHost(ctx);
    const membership = await requireMembership(ctx);
    const manifest = manifestFor(ctx);
    const owner = ownerOf(ctx);
    const input = parse(ApplySchema, raw);
    const p = await store.getProposal(owner, input.proposalId);
    if (!p) throw new ContourError("NOT_FOUND", "Proposal not found");
    const prefs = await store.getPreferences(owner);
    if (p.status === "READY") {
      const valid = validateViewConfig(manifest, p.config, { pins: prefs.pins });
      if (!valid.ok) {
        await store.setProposalStatus(owner, p.id, "READY", "INVALID", "failed validation at commit");
        throw new ContourError("INVALID_CONFIG", "The proposal no longer passes validation", { issues: valid.issues });
      }
      if (hashJson(valid.config) !== p.configHash || input.configHash !== p.configHash) {
        throw new ContourError("HASH_MISMATCH", "The approved configuration does not match the stored proposal");
      }
      if (String(membership.roleVersion) !== String(p.roleVersion)) {
        await store.setProposalStatus(owner, p.id, "READY", "INVALID", "role changed");
        throw new ContourError("INCOMPATIBLE_MANIFEST", "Your role changed since this proposal was made");
      }
    }
    const result = await store.applyProposal({
      proposal_id: p.id,
      tenant_id: owner.tenantId,
      app_id: owner.appId,
      subject_id: owner.subjectId,
      surface_id: owner.surfaceId,
      config_hash: input.configHash,
      manifest_version: manifest.manifestVersion,
      policy_version: manifest.policyVersion,
      idempotency_key: input.idempotencyKey,
      request_hash: hashJson({ op: "apply", proposalId: p.id, configHash: input.configHash }),
      default_config: manifest.defaultConfig as unknown as JsonValue,
      default_hash: hashJson(manifest.defaultConfig),
      history_limit: manifest.limits.historyLimit,
      // Fresh role version from the membership re-check above. Schema-template
      // installs compare it in SQL; the public (Acme) RPC ignores it.
      role_version: membership.roleVersion,
    });
    return mapRpc(result) as { ok: true; revision: number; proposalId: string; replayed?: boolean };
  }

  async function rejectProposal(ctx: VerifiedContext, proposalId: string) {
    requireHost(ctx);
    await requireMembership(ctx);
    const owner = ownerOf(ctx);
    const id = parse(z.uuid(), proposalId);
    const p = await store.getProposal(owner, id);
    if (!p) throw new ContourError("NOT_FOUND", "Proposal not found");
    if (p.status !== "READY") return { ok: true, status: p.status };
    await store.setProposalStatus(owner, id, "READY", "REJECTED", "user kept current view");
    return { ok: true, status: "REJECTED" as const };
  }

  async function undo(ctx: VerifiedContext, raw: unknown) {
    requireHost(ctx);
    const membership = await requireMembership(ctx);
    const manifest = manifestFor(ctx);
    const owner = ownerOf(ctx);
    const input = parse(SnapshotOpSchema, raw);
    const active = await store.getActiveView(owner);
    if ((active?.revision ?? 0) !== input.expectedRevision) {
      throw new ContourError("STALE_REVISION", "The view changed; reload and try again", { currentRevision: active?.revision ?? 0 });
    }
    if (!active || active.parentRevision === null) {
      throw new ContourError("INCOMPATIBLE_SNAPSHOT", "There is no earlier view to restore");
    }
    const target = await store.getHistoryEntry(owner, active.parentRevision);
    if (!target) throw new ContourError("INCOMPATIBLE_SNAPSHOT", "The earlier view is outside the retained history");
    const prefs = await store.getPreferences(owner);
    const valid = validateViewConfig(manifest, target.config, { pins: prefs.pins });
    if (!valid.ok || target.manifestVersion !== manifest.manifestVersion) {
      throw new ContourError(
        "INCOMPATIBLE_SNAPSHOT",
        "Your previous layout is no longer compatible with the current screen, your access, or your pins, so it cannot be restored. Unpin or reset to the default instead.",
        { issues: valid.ok ? [] : valid.issues },
      );
    }
    const result = await store.commitSnapshot({
      operation: "undo",
      tenant_id: owner.tenantId,
      app_id: owner.appId,
      subject_id: owner.subjectId,
      surface_id: owner.surfaceId,
      expected_revision: input.expectedRevision,
      parent_revision: target.parentRevision,
      restored_from: target.revision,
      config: valid.config as unknown as JsonValue,
      config_hash: hashJson(valid.config),
      manifest_version: manifest.manifestVersion,
      policy_version: manifest.policyVersion,
      idempotency_key: input.idempotencyKey,
      request_hash: hashJson({ op: "undo", expected: input.expectedRevision }),
      default_config: manifest.defaultConfig as unknown as JsonValue,
      default_hash: hashJson(manifest.defaultConfig),
      history_limit: manifest.limits.historyLimit,
      role_version: membership.roleVersion,
    });
    return mapRpc(result) as { ok: true; revision: number };
  }

  async function reset(ctx: VerifiedContext, raw: unknown) {
    requireHost(ctx);
    const membership = await requireMembership(ctx);
    const manifest = manifestFor(ctx);
    const owner = ownerOf(ctx);
    const input = parse(SnapshotOpSchema, raw);
    const result = await store.commitSnapshot({
      operation: "reset",
      tenant_id: owner.tenantId,
      app_id: owner.appId,
      subject_id: owner.subjectId,
      surface_id: owner.surfaceId,
      expected_revision: input.expectedRevision,
      parent_revision: input.expectedRevision,
      restored_from: null,
      config: manifest.defaultConfig as unknown as JsonValue,
      config_hash: hashJson(manifest.defaultConfig),
      manifest_version: manifest.manifestVersion,
      policy_version: manifest.policyVersion,
      idempotency_key: input.idempotencyKey,
      request_hash: hashJson({ op: "reset", expected: input.expectedRevision }),
      default_config: manifest.defaultConfig as unknown as JsonValue,
      default_hash: hashJson(manifest.defaultConfig),
      history_limit: manifest.limits.historyLimit,
      role_version: membership.roleVersion,
    });
    return mapRpc(result) as { ok: true; revision: number };
  }

  async function getSnapshot(ctx: VerifiedContext): Promise<ViewSnapshot> {
    requireScope(ctx, "view:read");
    await requireMembership(ctx);
    return loadSnapshot(ctx, manifestFor(ctx));
  }

  async function getPreferences(ctx: VerifiedContext) {
    requireScope(ctx, "view:read");
    await requireMembership(ctx);
    return store.getPreferences(ownerOf(ctx));
  }

  async function updatePreferences(ctx: VerifiedContext, raw: unknown) {
    requireHost(ctx);
    await requireMembership(ctx);
    const manifest = manifestFor(ctx);
    const prefs = parse(PreferencesSchema, raw) as UserPreferences;
    for (const pin of prefs.pins) {
      const spec = manifest.components.find((c) => c.id === pin.componentId);
      if (!spec) throw new ContourError("INVALID_INPUT", `Unknown component ${pin.componentId}`);
      if (spec.locked) throw new ContourError("INVALID_INPUT", `${spec.id} is locked by company policy`);
      if (pin.regionId && !spec.allowedRegions.includes(pin.regionId)) throw new ContourError("INVALID_INPUT", `${spec.id} cannot be pinned to ${pin.regionId}`);
      if (pin.variantId && !spec.variants.includes(pin.variantId)) throw new ContourError("INVALID_INPUT", `Unknown variant ${pin.variantId}`);
      if (pin.visible === false && spec.required) throw new ContourError("INVALID_INPUT", `${spec.id} is required and cannot be pinned hidden`);
    }
    if (new Set(prefs.pins.map((p) => p.componentId)).size !== prefs.pins.length) {
      throw new ContourError("INVALID_INPUT", "Only one pin per component");
    }
    await store.savePreferences(ownerOf(ctx), prefs);
    return prefs;
  }

  async function getHistory(ctx: VerifiedContext) {
    requireHost(ctx);
    await requireMembership(ctx);
    const manifest = manifestFor(ctx);
    const entries = await store.listHistory(ownerOf(ctx), manifest.limits.historyLimit);
    return entries.map((e) => ({
      revision: e.revision,
      parentRevision: e.parentRevision,
      source: e.source,
      proposalId: e.proposalId,
      createdAt: e.createdAt,
      compatible: e.manifestVersion === manifest.manifestVersion && validateViewConfig(manifest, e.config).ok,
    }));
  }

  async function listProposals(ctx: VerifiedContext, limit = 10) {
    requireHost(ctx);
    await requireMembership(ctx);
    const owner = ownerOf(ctx);
    const list = await store.listProposals(owner, Math.min(limit, 50));
    return Promise.all(list.map((p) => expireIfNeeded(owner, p)));
  }

  async function listDecisions(ctx: VerifiedContext, limit = 20) {
    requireHost(ctx);
    await requireMembership(ctx);
    return store.listDecisions(ownerOf(ctx), Math.min(limit, 100));
  }

  async function creditBalance(ctx: VerifiedContext) {
    await requireMembership(ctx);
    return store.creditBalance(ownerOf(ctx));
  }

  return {
    describeSurface,
    readComponentData,
    proposeView,
    getView,
    getPreview,
    getLive,
    applyProposal,
    rejectProposal,
    undo,
    reset,
    getSnapshot,
    getPreferences,
    updatePreferences,
    getHistory,
    listProposals,
    listDecisions,
    creditBalance,
    manifestFor,
  };
}

export type AdaptiveBroker = ReturnType<typeof createAdaptiveBroker>;

function mapRpc(result: RpcResult) {
  if (result.ok) return result;
  const code = String(result.code ?? "INTERNAL");
  const messages: Record<string, string> = {
    NOT_FOUND: "Proposal not found",
    PROPOSAL_NOT_READY: `This proposal can no longer be applied (status ${String(result.status ?? "unknown")})`,
    EXPIRED_PROPOSAL: "This proposal expired; request a new one",
    HASH_MISMATCH: "The approved configuration does not match the stored proposal",
    FORBIDDEN: "You no longer have access to this surface",
    INCOMPATIBLE_MANIFEST: "The screen, its policy, or your role changed since this proposal was made",
    STALE_REVISION: "Your view changed in another tab or session; request a new proposal",
    IDEMPOTENCY_CONFLICT: "This request key was already used for a different request",
    INVALID_INPUT: "Invalid request",
  };
  const known = [
    "NOT_FOUND",
    "PROPOSAL_NOT_READY",
    "EXPIRED_PROPOSAL",
    "HASH_MISMATCH",
    "FORBIDDEN",
    "INCOMPATIBLE_MANIFEST",
    "STALE_REVISION",
    "IDEMPOTENCY_CONFLICT",
    "INVALID_INPUT",
  ] as const;
  const c = (known as readonly string[]).includes(code) ? (code as (typeof known)[number]) : "INTERNAL";
  throw new ContourError(c, messages[c] ?? "Commit failed", {
    ...(typeof result.currentRevision === "number" ? { currentRevision: result.currentRevision } : {}),
    ...(result.status ? { status: result.status } : {}),
  });
}

function describeCurrent(manifest: SurfaceManifest, config: ViewConfig): string {
  const parts = config.placements.filter((p) => p.visible).map((p) => `${p.componentId}=${p.variantId}@${p.regionId}`);
  const tpl = manifest.templates.find((t) => t.id === config.templateId)?.label ?? config.templateId;
  return `Template ${tpl}; density ${config.densityToken.replace("density.", "")}; ${parts.join(", ")}.`;
}

function keepMessage(reason: string): string {
  switch (reason) {
    case "provider_timeout":
      return "The selector timed out, so your current view was kept.";
    case "provider_error":
    case "provider_malformed":
      return "The selector was unavailable, so your current view was kept.";
    case "provider_unconfigured":
      return "No selection model is configured, so your current view was kept.";
    case "low_confidence":
      return "No candidate was a confident enough fit, so your current view was kept.";
    case "already_current":
      return "Your current view already matches the best fit.";
    case "unknown_choice":
      return "The selector returned an unknown choice, so your current view was kept.";
    default:
      return "Your current view is preferable or the change would add little.";
  }
}

function buildRationale(
  taskLabel: string,
  expertiseLabel: string,
  chosen: Candidate,
  changes: ChangeItem[],
  prefs: { density?: string; help?: string },
  confidence: number | undefined,
): string {
  const top = changes.slice(0, 3).map((c) => c.summary.toLowerCase());
  const density = prefs.density ? `Density follows your explicit ${prefs.density} preference.` : "No density preference was stated.";
  const conf = confidence !== undefined ? ` Selector confidence ${confidence.toFixed(2)} (a fit judgment, not a guarantee).` : "";
  return `${chosen.label} layout for "${taskLabel}" at ${expertiseLabel.toLowerCase()} level${
    top.length ? `: ${top.join("; ")}` : ""
  }. ${density}${conf}`;
}
