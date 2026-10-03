/**
 * Contour SDK — shared contract types.
 *
 * Everything in this file is serializable metadata. Implementations (React
 * components, reader functions, credentials) are registered separately by
 * trusted company code and never appear in a manifest, a proposal, or a
 * model prompt.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Closed JSON-schema subset accepted for component settings. Only the
 * constructs below are supported; registration rejects anything else.
 */
export type SettingSchema =
  | { enum: readonly (string | number | boolean)[]; description?: string }
  | { type: "boolean"; description?: string }
  | { type: "integer"; minimum: number; maximum: number; description?: string }
  | { type: "string"; maxLength: number; pattern?: string; description?: string };

export type SettingsSchema = {
  type: "object";
  additionalProperties: false;
  properties: Record<string, SettingSchema>;
  required: readonly string[];
};

export type ComponentSpec = {
  id: string;
  semanticRole: string;
  description: string;
  variants: readonly string[];
  /** Human/agent-readable description per variant. Keys must equal `variants`. */
  variantDescriptions: Record<string, string>;
  settingsSchema: SettingsSchema;
  defaultSettings: Record<string, JsonValue>;
  readerId?: string;
  requiredScope?: string;
  /** Locked components keep their default region, order, variant and visibility. */
  locked: boolean;
  /** Required components can never be hidden. */
  required: boolean;
  allowedRegions: readonly string[];
};

export type BreakpointId = "narrow" | "medium" | "wide";

export type TemplateBreakpoint = {
  id: BreakpointId;
  /** Inclusive lower bound in CSS pixels. */
  minWidth: number;
  columns: number;
  /** Region reading/focus order at this breakpoint. Must list every region. */
  regionOrder: readonly string[];
  /** Grid column span per region (1..columns). */
  regionSpan: Record<string, number>;
  /** Max visible components per region at this breakpoint. */
  regionCapacity: Record<string, number>;
};

export type LayoutTemplate = {
  id: string;
  label: string;
  description: string;
  regions: readonly { id: string; label: string }[];
  breakpoints: readonly TemplateBreakpoint[];
};

export type TaskSpec = { id: string; label: string; description: string };
export type ExpertiseSpec = { id: string; label: string; description: string };

/**
 * Cross-component relationship rules. A dependency is satisfied when the
 * dependent placement is hidden or not in `whenVariants`, or the required
 * component is visible.
 */
export type DependencyRule = {
  componentId: string;
  whenVariants?: readonly string[];
  requiresVisible: string;
  reason: string;
};

export type SurfaceManifest = {
  schemaVersion: "1";
  appId: string;
  surfaceId: string;
  label: string;
  description: string;
  manifestVersion: string;
  policyVersion: string;
  components: ComponentSpec[];
  tokenIds: string[];
  templates: LayoutTemplate[];
  dependencies: DependencyRule[];
  tasks: TaskSpec[];
  expertiseLevels: ExpertiseSpec[];
  defaultConfig: ViewConfig;
  limits: {
    maxPlacements: number;
    maxNoteLength: number;
    proposalTtlSeconds: number;
    historyLimit: number;
  };
};

export type Placement = {
  componentId: string;
  regionId: string;
  order: number;
  variantId: string;
  visible: boolean;
  settings: Record<string, JsonValue>;
};

export type ViewConfig = {
  schemaVersion: "1";
  manifestVersion: string;
  templateId: string;
  densityToken: string;
  placements: Placement[];
};

export type ViewSnapshot = {
  surfaceId: string;
  revision: number;
  policyVersion: string;
  configHash: string;
  config: ViewConfig;
  /** "saved" = validated stored snapshot, "default" = no saved view yet,
   *  "fallback" = stored snapshot invalid/unavailable, default rendered. */
  source: "saved" | "default" | "fallback";
  fallbackReason?: string;
};

/** A manual pin constrains candidate generation. */
export type ManualPin = {
  componentId: string;
  regionId?: string;
  visible?: boolean;
  variantId?: string;
};

export type DensityPreference = "comfortable" | "compact";
export type HelpPreference = "auto" | "show" | "hide";

export type UserPreferences = {
  expertise?: string;
  density?: DensityPreference;
  help?: HelpPreference;
  pins: ManualPin[];
};

export type VerifiedContext = {
  subjectId: string;
  tenantId: string;
  appId: string;
  surfaceId: string;
  /** "host" for the authenticated first-party browser session, otherwise the OAuth client_id. */
  clientId: string;
  grantRevision: string;
  scopes: ReadonlySet<Scope>;
  roleVersion: string;
  role: string;
  channel: "host" | "mcp";
};

export type Scope = "view:read" | "data:read" | "view:propose" | "view:commit";
export const ALL_SCOPES: readonly Scope[] = ["view:read", "data:read", "view:propose", "view:commit"];
/** Scopes an external agent may ever hold in the MVP (no commit privilege). */
export const AGENT_SCOPES: readonly Scope[] = ["view:read", "data:read", "view:propose"];

export type ProposalStatus = "READY" | "APPLIED" | "REJECTED" | "EXPIRED" | "STALE" | "INVALID";

/** Presentation-only progress for an adaptation; it grants no commit authority. */
export type LiveJob = {
  id: string;
  status: "working" | "ready" | "kept" | "asked" | "failed";
  task: string;
  expertise: string;
  changedComponents: string[];
  message: string | null;
  startedAt: string;
  updatedAt: string;
};

export type ChangeItem = {
  kind: "template" | "density" | "visibility" | "variant" | "region" | "order" | "settings";
  componentId?: string;
  from: string;
  to: string;
  summary: string;
};

export type Proposal = {
  id: string;
  ownerSubjectId: string;
  tenantId: string;
  appId: string;
  surfaceId: string;
  baseRevision: number;
  manifestVersion: string;
  policyVersion: string;
  roleVersion: string;
  config: ViewConfig;
  configHash: string;
  expiresAt: string;
  createdAt: string;
  status: ProposalStatus;
  decisionId: string;
  requestId: string;
  candidateId: string;
  task: string;
  expertise: string;
  preferences: ProposeRequest["preferences"];
  changes: ChangeItem[];
  rationale: string;
  appliedRevision?: number | null;
};

export type ProposeRequest = {
  surfaceId: string;
  baseRevision: number;
  task: { id: string; source: "explicit" };
  expertise: { level: string; source: "explicit" };
  preferences?: { density?: DensityPreference; help?: HelpPreference };
  /** Optional short user text. Bounded, untrusted context; cannot alter policy. */
  note?: string;
  requestId: string;
};

export type CandidateId = "guided" | "balanced" | "dense";
export type Candidate = {
  id: CandidateId;
  label: string;
  summary: string;
  config: ViewConfig;
  configHash: string;
};

export type DecisionOutcome = "READY" | "KEEP" | "ASK";

export type ProposeResult =
  | {
      outcome: "READY";
      proposalId: string;
      status: ProposalStatus;
      baseRevision: number;
      changes: ChangeItem[];
      rationale: string;
      previewUrl: string;
      expiresAt: string;
      decisionId: string;
      creditConsumed: boolean;
    }
  | {
      outcome: "KEEP";
      reason: string;
      decisionId: string;
      currentRevision: number;
    }
  | {
      outcome: "ASK";
      question: string;
      supportedChoices: Record<string, readonly string[]>;
      decisionId: string;
    };

export type ContourErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "STALE_REVISION"
  | "EXPIRED_PROPOSAL"
  | "INCOMPATIBLE_MANIFEST"
  | "INCOMPATIBLE_SNAPSHOT"
  | "INVALID_CONFIG"
  | "PROPOSAL_NOT_READY"
  | "HASH_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "RATE_LIMITED"
  | "PAYMENT_REQUIRED"
  | "AGENT_ACCESS_DISABLED"
  | "INTERNAL";

export type ValidationIssue = { code: string; path: string; message: string };

export class ContourError extends Error {
  constructor(
    public readonly code: ContourErrorCode,
    message: string,
    public readonly details: {
      issues?: ValidationIssue[];
      currentRevision?: number;
      [k: string]: unknown;
    } = {},
  ) {
    super(message);
    this.name = "ContourError";
  }
  toJSON() {
    return { code: this.code, message: this.message, ...this.details };
  }
}
