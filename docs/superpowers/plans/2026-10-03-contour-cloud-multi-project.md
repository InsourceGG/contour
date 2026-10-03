# Contour Cloud + multi-project + setup skill: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-app Contour MVP into a monorepo containing:
- an SDK package;
- Contour Cloud (consumer accounts, project registry, linking, one consumer MCP spanning all linked projects);
- Acme as project #1;
- Northwind Support as project #2, integrated by a new `contour-setup` skill.

**Architecture:**
- **SDK:** the existing SDK core, OAuth AS, MCP handler, and store move into `packages/contour-sdk`. They are parameterized by a config object (app URL, schema, identity adapter) instead of module-level env.
- **Cloud:** an OAuth client of each project's AS (CIMD client ID). It stores encrypted refresh tokens per (Contour user, project) and forwards consumer MCP tool calls to each project's existing MCP endpoint as an MCP client.
- **Projects:** they keep full authority, and approval stays in each company app.

**Tech Stack:**
- Next.js 16.3 App Router, React 19, TypeScript 5.9, Tailwind 4
- pnpm 10 workspaces
- Supabase (Postgres 17, Auth for Cloud consumers only), with supabase-js `.schema()` for the `cloud` and `northwind` schemas
- Stripe (test mode)
- Vercel (three projects)
- TypeSafe Jev via AI Gateway
- vitest 5, Playwright 1.63
- Claude Code 2.1.288 as the MCP client

**Spec:** `docs/superpowers/specs/2026-10-03-contour-cloud-multi-project-design.md`. Baseline: `/tmp/spec.txt` and `docs/EVIDENCE.md`.

**Clarification of the spec, §5 forwarding:** `agentApiResource` is the project's existing MCP endpoint (`{appUrl}/api/mcp`). Cloud forwards by sending MCP `tools/call` JSON-RPC (protocol 2025-11-25 legacy mode, which every project supports) with the project's bearer token. That avoids a second bespoke agent API. In spec §6, the store adapter is named `supabaseStore({ client, schema })`, since it runs over supabase-js.

## Global Constraints
- Personalization changes presentation only. Agents and Cloud never commit, reset, or undo. Agent scopes are capped at `view:read`, `data:read`, `view:propose`.
- Identity always comes from server-verified records, never from request args, model text, or browser state.
- The SDK is consumed as `workspace:*`. Never publish to npm.
- Cloud URL: `https://contour-sdk.vercel.app`. Acme: `https://contour-acme.vercel.app`. Northwind: `https://northwind-support.vercel.app`. If a domain is taken, append `-app` and record the change in `docs/EVIDENCE.md`.
- All existing tests must stay green after every task: unit, integration, OAuth/MCP, webhook, e2e.
- UI copy: no em dashes, no eyebrow labels, no buzzwords. Semantic color only. Right-aligned numerals. Designed hover/focus/empty/loading/error/permission states.
- Every UI task invokes the design skills named in spec §10 before writing UI: `better-copy`, `better-writing`, `better-layouts`, `better-layout`, `better-typography`, `better-colors`, `better-ui`, `better-interface`, `better-accessibility`; `designing-dashboard-uis` for dashboards; `design-taste-frontend`, `high-end-visual-design`.
- Secrets live only in `.env.local` and Vercel env. Never log tokens. Never put tokens in URLs (OAuth codes excepted).
- Provisioning allowed: Vercel projects, aliases, and env vars in team `insourceggs-projects`; schemas in Supabase project `nesbiihlebycihorgpzk`; Stripe test-mode objects. Nothing else.

## File structure (target)

```
contour/
  package.json                     # workspace root: scripts test:*, typecheck, lint
  pnpm-workspace.yaml              # packages/*, apps/*
  tsconfig.base.json
  vitest.workspace.mts
  packages/contour-sdk/
    package.json                   # name "@contour/sdk", exports ./core ./react ./server ./jev ./testing
    src/core/{types,validate,candidates,registry,hash,broker}.ts      # moved from src/sdk
    src/jev/index.ts                                                   # moved from src/server/jev.ts, env-free
    src/react/*                                                        # moved from src/sdk/react
    src/server/config.ts            # ContourServerConfig + defineContourServer()
    src/server/store/supabase-store.ts   # moved from src/server/store.ts, schema-parameterized
    src/server/oauth/*              # moved from src/server/oauth, config-driven
    src/server/mcp/*                # moved from src/server/mcp, config-driven
    src/server/host/{csrf,host-route,http}.ts
    src/server/well-known.ts        # contour-project.json handler
    src/server/handlers.ts          # createContourHandlers(config) -> route handler map
    src/react/ConnectAgentPanel.tsx
    sql/contour_schema.sql.tmpl     # {{schema}} template: contour + oauth tables, RPCs, RLS, grants
    bin/contour-migrate.mjs         # renders template, applies via `supabase db query --linked -f`
    tests/                          # moved unit tests (contract, jev) + schema template test
  apps/ops-demo/                    # current src/app, src/components, src/host, src/server/{context,env,console,stripe,surface-data,agent-access}.ts
  apps/cloud/
    src/app/(consumer)/{login,signup,projects,activity}/page.tsx
    src/app/(owner)/owner/{page.tsx,projects/new/page.tsx,projects/[id]/page.tsx}
    src/app/link/{start/page.tsx,callback/route.ts}
    src/app/oauth/client.json/route.ts               # Cloud CIMD
    src/app/api/mcp/route.ts                         # consumer MCP (SDK MCP handler + Cloud tools)
    src/app/oauth/authorize/... + api/oauth/*        # Cloud's own AS for MCP clients (SDK)
    src/server/{env,supabase,identity,projects,verify,links,vault,forward,tools}.ts
    supabase/cloud.sql
    tests/{unit,integration}/*
  apps/northwind/                   # baseline (tag northwind-baseline) then integrated
  skills/contour-setup/{SKILL.md,references/*.md,scripts/{discover.mjs,verify.mjs}}
  tests/e2e/*                       # cross-app e2e
```

---

### Task 1: Monorepo conversion (no behavior change)

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json` (root), `tsconfig.base.json`
- Move: everything app-specific (`src/`, `public/`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `vercel.json`, `playwright.config.ts`, `tests/`, `scripts/`, `supabase/`, `.env.local`) → `apps/ops-demo/`
- Modify: Vercel project `contour-ui` → Root Directory `apps/ops-demo`

**Interfaces:**
- Produces: `apps/ops-demo` builds and tests exactly as before. Root scripts: `pnpm -F ops-demo <script>`.

- [ ] **Step 1:** `git mv` the app files into `apps/ops-demo/` (keep `docs/`, `README.md`, `.gitignore` at the root; copy `.env.local` to `apps/ops-demo/.env.local`).
- [ ] **Step 2:** Root `pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
ignoredBuiltDependencies:
  - sharp
  - unrs-resolver
```
  Root `package.json`:
```json
{ "name": "contour-monorepo", "private": true, "packageManager": "pnpm@10.33.0",
  "scripts": { "typecheck": "pnpm -r typecheck", "lint": "pnpm -r lint", "test": "pnpm -r test" } }
```
  Rename `apps/ops-demo/package.json` name to `ops-demo`.
- [ ] **Step 3:** `pnpm install`, then `pnpm -F ops-demo typecheck && pnpm -F ops-demo exec vitest run tests/unit tests/integration`. Expected: 59 passing.
- [ ] **Step 4:** `pnpm -F ops-demo build`. Expected: success.
- [ ] **Step 5:** Set the Vercel root directory: `vercel project` settings via `mcp__vercel__update_project {rootDirectory:"apps/ops-demo"}`. Deploy from the repo root with `vercel deploy --prod`. Expected: a successful deploy at the current alias.
- [ ] **Step 6:** Commit `chore: convert to pnpm monorepo (apps/ops-demo)`.

### Task 2: Extract `@contour/sdk` (parity refactor)

**Files:**
- Create: `packages/contour-sdk/**` per the file structure above.
- Modify: `apps/ops-demo/src/**` imports move to `@contour/sdk/{core,react,server,jev}`. The app keeps only host-specific code: manifest, policy, components, readers, context (identity), console, stripe, surface-data, pages, and route files.
- Tests: move `tests/unit/*` to `packages/contour-sdk/tests/`. Integration, OAuth, and e2e tests stay in ops-demo.

**Interfaces (Produces, used by Tasks 3–8):**
```ts
// @contour/sdk/server
export type HostUser = { subjectId: string; sessionId: string; tenantId: string; role: string; roleVersion: number; displayName: string; email: string };
export type Membership = { tenantId: string; subjectId: string; appId: string; role: string; roleVersion: number; dataAccess: boolean; status: "active" | "suspended"; displayName: string };
export type ContourServerConfig = {
  appUrl: string;                       // origin, no trailing slash
  appId: string;
  resourceName: string;                 // shown in PRM + consent
  surfaces: readonly string[];          // grantable surfaces
  db: SupabaseClient;                   // service-role client
  schema: string;                       // "public" for Acme, "northwind" for Northwind, "cloud" for Cloud's own AS
  csrfSecret: string;
  identity: {
    currentUser(): Promise<HostUser | null>;                 // verified company session
    loginUrl(nextPath: string): string;                      // relative path in the host app
    getMembership(subjectId: string, tenantId: string, appId: string): Promise<Membership | null>;
  };
  agentAccessEnabled(tenantId: string, appId: string): Promise<boolean>;
  trustedClients?: readonly string[];   // CIMD URLs shown as verified on consent (e.g. Cloud)
  consent?: { productName: string; dataCategories: string[]; brandColor?: string };
};
export function defineContourServer(cfg: ContourServerConfig): ContourServer;
export type ContourServer = {
  config: ContourServerConfig;
  resolveMcpContext(req: Request, surfaceId: string): Promise<VerifiedContext>;
  oauth: {
    protectedResourceMetadata(): object; authorizationServerMetadata(): object;
    validateAuthorize(raw: Record<string, string | string[] | undefined>): Promise<AuthorizeValidation>;
    decision(req: Request): Promise<Response>;               // consent POST
    token(req: Request): Promise<Response>; register(req: Request): Promise<Response>; revoke(req: Request): Promise<Response>;
    csrfTokenFor(user: HostUser): string;
    listGrantsForUser(subjectId: string, tenantId: string): Promise<GrantSummary[]>;
    revokeGrant(subjectId: string, tenantId: string, grantId: string): Promise<boolean>;
    revokeAllGrantsForApp(tenantId: string, appId: string, by?: string): Promise<number>;
  };
  mcp(handlerOpts: { tools: McpToolSet; instructions: string }): (req: Request) => Promise<Response>;
  store: ContourStore;                                      // supabaseStore({ client: db, schema })
  assertCsrf(req: Request, user: HostUser): void;
};
export function brokerTools(broker: AdaptiveBroker): McpToolSet;   // describe/read/propose/get_view
export function createContourHandlers(server: ContourServer, opts: { broker: AdaptiveBroker; projectId?: string; wellKnownNonce?: string }): Record<string, (req: Request, ctx?: any) => Promise<Response>>;
// @contour/sdk/react: AdaptiveSurface, ViewPreview, ComponentStateProvider, ComponentBoundary, ConnectAgentPanel
// @contour/sdk/jev: createJevSelector({ apiKey, model, timeoutMs, fetchImpl? })
// @contour/sdk/core: everything in today's src/sdk/{types,validate,candidates,registry,hash,broker}.ts unchanged
```

- [ ] **Step 1:** Create the `packages/contour-sdk/package.json`. It declares `"exports"` mapping `./core`, `./react`, `./server`, `./jev` to the TS sources, with peer dependencies `next`, `react`, `@supabase/supabase-js`, `zod`. Set `transpilePackages: ["@contour/sdk"]` in ops-demo's `next.config.ts`.
- [ ] **Step 2:** Move `src/sdk/*` → `src/core/*` and `src/sdk/react/*` → `src/react/*` with unchanged code. Fix relative imports. Move the unit tests and run them: `pnpm -F @contour/sdk exec vitest run`. Expected: 32 pass.
- [ ] **Step 3:** Move `src/server/oauth/*` and `src/server/mcp/*` into the SDK. Replace every `env.*`, `APP_ID`, `GRANTABLE_SURFACES`, `adminClient()`, `resolveHostUser()`, and `isAgentAccessEnabled()` reference with values from a `ContourServerConfig` passed at construction. Table access uses `cfg.db.schema(cfg.schema).from(...)` and `.rpc(...)`. The module structure is unchanged; the functions become methods closed over `cfg` inside `defineContourServer`.
- [ ] **Step 4:** Move `store.ts` to `supabase-store.ts` as `supabaseStore({ client, schema, agentAccessEnabled })`, with every `.from`/`.rpc` going through `client.schema(schema)`.
- [ ] **Step 5:** Move `csrf.ts`, `host-route.ts`, and `http.ts` into `src/server/host/`, using `cfg.csrfSecret` and `cfg.identity`.
- [ ] **Step 6:** Rewire ops-demo:
  - add `apps/ops-demo/src/server/contour.ts`, which exports `contour = defineContourServer({...})` with `schema:"public"`, `identity` built from `context.ts`, and `appUrl` from env;
  - `getBroker()` uses `contour.store`;
  - each existing route file becomes a 1–3 line call into `contour.oauth.*` or `contour.mcp(...)`;
  - the authorize page imports `contour.oauth.validateAuthorize`.
- [ ] **Step 7:** Run the typecheck, then the integration tests (27), then start `pnpm -F ops-demo dev` and run `tests/oauth-mcp.test.ts` against localhost (32). Expected: all green.
- [ ] **Step 8:** Commit `refactor: extract @contour/sdk package with config-driven server`.

### Task 3: Schema template + migrate CLI + exposed schemas

**Files:**
- Create: `packages/contour-sdk/sql/contour_schema.sql.tmpl`, `packages/contour-sdk/bin/contour-migrate.mjs`, `packages/contour-sdk/tests/schema-template.test.ts`

**Interfaces:**
- Produces: `node packages/contour-sdk/bin/contour-migrate.mjs --schema <name> [--apply]`. It prints or applies SQL that creates every table and RPC `supabaseStore` and the OAuth module need inside `<name>`. FKs to company tables are dropped (`subject_id text`).
- Produces: the schemas `northwind` and `cloud` are exposed to PostgREST.

- [ ] **Step 1: Write the failing test.** Rendering for `northwind` contains `create schema if not exists northwind`, `northwind.proposals`, and `northwind.contour_apply_proposal`, contains no `public.`, and revokes from `anon, authenticated`.
```ts
import { renderSchema } from "../bin/render.mjs";
it("renders a schema-scoped install", () => {
  const sql = renderSchema("northwind");
  expect(sql).toContain("create schema if not exists northwind");
  expect(sql).toMatch(/northwind\.contour_apply_proposal/);
  expect(sql).not.toMatch(/\bpublic\./);
  expect(sql).toMatch(/revoke all on all tables in schema northwind from anon, authenticated/);
});
```
- [ ] **Step 2:** Build the template from the four existing migrations, replacing `public.` with `{{schema}}.`. Remove the `memberships`/`tenants`/`apps`/`demo_*` tables. Remove FKs to `auth.users` and `memberships`. Remove the `contour_is_member` RLS helper. RLS is enabled with no policies (service-role only). Add `{{schema}}.tenant_app_settings` and `{{schema}}.audit_events`.
- [ ] **Step 3:** Implement `render.mjs` and `contour-migrate.mjs`. `--apply` writes to a temp file and runs `supabase db query --linked -f`. Run the test: it passes.
- [ ] **Step 4:** Expose the schemas through the Management API:
```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w 2>/dev/null)  # or supabase CLI auth
supabase db query --linked "grant usage on schema northwind, cloud to service_role"
# PATCH https://api.supabase.com/v1/projects/nesbiihlebycihorgpzk/postgrest {"db_schema":"public,graphql_public,northwind,cloud"}
```
  Verify that `createClient(url, serviceKey).schema("northwind").from("proposals").select().limit(1)` returns no error.
- [ ] **Step 5:** Commit `feat(sdk): schema template and contour-migrate`.

### Task 4: Contour Cloud app

**Files:** `apps/cloud/**` per the file structure, plus `apps/cloud/supabase/cloud.sql`.

**Interfaces:**
- Consumes: `defineContourServer` (Cloud's own AS for MCP clients, `schema:"cloud"`, identity = Supabase Auth consumer session), `contour.mcp({tools})`.
- Produces:
  - `GET /oauth/client.json`: the Cloud CIMD `{client_id:"https://contour-sdk.vercel.app/oauth/client.json", client_name:"Contour Cloud", redirect_uris:["https://contour-sdk.vercel.app/link/callback"], grant_types:["authorization_code","refresh_token"], response_types:["code"], token_endpoint_auth_method:"none"}`.
  - `GET /link/start?project=<uuid>` (session required) and `GET /link/callback`.
  - Consumer MCP at `/api/mcp` with tools `list_projects`, `list_available_projects`, `connect_project`, `describe_surface`, `read_component_data`, `propose_view`, `get_view` (closed schemas, `projectId` uuid, `surfaceId` string).
  - Owner console: create project, show the nonce, verify.

`cloud.sql`: the SDK template rendered for `cloud` (for Cloud's own consumer AS) plus:
```sql
create table cloud.projects (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  name text not null, company text not null, description text not null default '', base_url text not null,
  mcp_resource text, as_issuer text, surfaces text[] not null default '{}', verify_nonce text not null,
  verified_at timestamptz, status text not null default 'pending' check (status in ('pending','verified','disabled')),
  created_at timestamptz not null default now());
create table cloud.links (contour_user uuid not null references auth.users(id) on delete cascade, project_id uuid not null references cloud.projects(id) on delete cascade,
  status text not null check (status in ('active','needs_reconnect','revoked')), scopes text[] not null,
  refresh_ct text not null, access_ct text, access_expires_at timestamptz, key_id text not null, subject_hint text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (contour_user, project_id));
create table cloud.link_states (state_hash text primary key, contour_user uuid not null, project_id uuid not null,
  verifier_ct text not null, key_id text not null, expires_at timestamptz not null, used_at timestamptz);
create table cloud.audit_events (id bigint generated always as identity primary key, contour_user uuid, project_id uuid, kind text not null, detail jsonb not null default '{}', created_at timestamptz not null default now());
alter table cloud.projects enable row level security; alter table cloud.links enable row level security;
alter table cloud.link_states enable row level security; alter table cloud.audit_events enable row level security;
revoke all on all tables in schema cloud from anon, authenticated;
```

- [ ] **Step 1: Vault, test first** (`apps/cloud/tests/unit/vault.test.ts`): `encrypt(plaintext)` → `{ct, keyId}`; `decrypt` round-trips; tampered ciphertext throws; the wrong key ID throws. Implement `src/server/vault.ts` with AES-256-GCM, a 12-byte IV, and `CLOUD_VAULT_KEY` (base64 32 bytes) plus `CLOUD_VAULT_KEY_ID`.
- [ ] **Step 2: Link state, test first:** create returns `{state, verifier, challenge}`; consume once succeeds; a second consume, an expired state, or another user's consume fails. Implement `links.ts`: `createLinkState`, `consumeLinkState`, `upsertLink`, `getActiveLink`, `markLink`, `listLinks`, `deleteLink`.
- [ ] **Step 3: Project verification, test first** (mock fetch): the `.well-known/contour-project.json` ID and nonce must match. HTTPS only. A redirect is rejected. Then read the AS metadata from `{base}/.well-known/oauth-authorization-server` and set `mcp_resource` from `{base}/.well-known/oauth-protected-resource/api/mcp`. Implement `verify.ts`, reusing the SDK's pinned fetch helper (export `pinnedFetchJson` from `@contour/sdk/server`).
- [ ] **Step 4: Forwarding, test first** (mock project): `forwardTool(link, name, args)` sends JSON-RPC `tools/call` with `Authorization: Bearer <access>` and `MCP-Protocol-Version: 2025-11-25`. On 401 it refreshes once (single-flight per link via `pg_advisory_xact_lock` in an RPC, or an in-process mutex plus a DB compare-and-swap), then retries. On `invalid_grant` during refresh it marks the link `needs_reconnect` and throws `PROJECT_ACCESS_REVOKED`. On a 403 `AGENT_ACCESS_DISABLED` result it passes the code through. It enforces an 8 s timeout and a 256 KB cap.
- [ ] **Step 5: Consumer tools** (`tools.ts`), implementing the tool table from spec §5. Every project tool resolves `getActiveLink(ctx.subjectId, projectId)`, returns `NOT_FOUND` if absent, then calls `forwardTool`. `read_component_data` results are wrapped `{project:{id,name}, untrustedContent:true, ...}`.
- [ ] **Step 6: Routes and pages:**
  - `/link/start` (an "Link {project} to your Contour account {email}?" page with Continue, which posts and redirects to the project authorize URL with PKCE and state);
  - `/link/callback` (checks state, `iss`, exchanges the code, stores the link, redirects to `/projects?linked=<id>`);
  - `/projects` (linked projects with status, Connect for available ones, Unlink);
  - `/login` and `/signup` (Supabase email + password plus magic link);
  - `/owner` console (create project, nonce, verify button, status);
  - `/activity` (the user's audit events);
  - Cloud's own `/oauth/authorize` plus `api/oauth/*` plus `.well-known` routes through the SDK, with `schema:"cloud"`.

  Invoke all of the design skills (Global Constraints) first. Visual direction: a calm, premium consumer hub with its own identity.
- [ ] **Step 7: Integration test** (`apps/cloud/tests/integration/link-forward.test.ts`), run against local Acme (`:3000`) and Cloud (`:3100`):
  1. sign up a consumer;
  2. register Acme and verify it;
  3. drive `/link/start` → Acme authorize (Playwright request context, signed in as alex) → callback;
  4. call the consumer MCP `list_projects` (1) and `describe_surface` through Cloud.

  It also covers the spoofing cases: another consumer's token gets `NOT_FOUND` for the same project ID, and a replayed state fails.
- [ ] **Step 8:** Commit `feat(cloud): consumer accounts, registry, linking, consumer MCP`.

### Task 5: Acme as project #1

**Files:** `packages/contour-sdk/src/react/ConnectAgentPanel.tsx` (create; exported from `@contour/sdk/react`; props `{ cloudUrl: string; projectId: string; projectName: string; className?: string }`; renders a host-styled card with explanation + "Connect your AI agent" link to `${cloudUrl}/link/start?project=${projectId}`; uses host CSS variables, no own palette; design skills apply), `apps/ops-demo/src/server/contour.ts` (add `trustedClients`), `apps/ops-demo/src/app/.well-known/contour-project.json/route.ts`, `apps/ops-demo/src/app/settings/page.tsx` (add `<ConnectAgentPanel>`), plus env `CONTOUR_PROJECT_ID` and `CONTOUR_PROJECT_NONCE`.

- [ ] **Step 1:** Create the Vercel alias `contour-acme.vercel.app` for ops-demo. Set `APP_URL=https://contour-acme.vercel.app`. Re-point the Stripe webhook with `node scripts/stripe-webhook-setup.mjs https://contour-acme.vercel.app/api/stripe/webhook` and update `STRIPE_WEBHOOK_SECRET`.
- [ ] **Step 2:** Create the Vercel project `contour-cloud` (root `apps/cloud`) and move the alias `contour-sdk.vercel.app` from ops-demo to it. Set Cloud env: Supabase, `APP_URL`, vault keys, CSRF secret.
- [ ] **Step 3:** Register Acme in Cloud as owner `morgan@contour.demo` (a Cloud account), set the env nonce, deploy, and verify.
- [ ] **Step 4:** Re-run the ops-demo OAuth/MCP suite, webhook suite, and e2e against `https://contour-acme.vercel.app`. All must pass.
- [ ] **Step 5:** Commit `feat(acme): register as Contour Cloud project #1`.

### Task 6: Northwind Support baseline (parallel with Tasks 2–5)

**Files:** `apps/northwind/**`, `apps/northwind/supabase/northwind_base.sql`, `apps/northwind/scripts/seed.ts`

**Interfaces:**
- Produces:
  - Session auth: `getSession(): Promise<{userId,email,name,role:"agent"|"lead"|"admin",team:string}|null>`, with an HMAC-signed HttpOnly cookie `nw_session` and scrypt passwords.
  - Data functions in `src/data/*.ts`: `getTickets(session,{filter,limit})`, `getSlaBreaches(session)`, `getCsatTrend(session,{range})`, `getWorkload(session)`, `getKbArticles(session,{topic})`, `getCustomerTimeline(session,{limit})`. Each enforces "agents see their own team's tickets".
  - The desk at `/desk` with six components, each with variant props, plus `/settings` and `/admin`.

- [ ] **Step 1:** SQL `northwind_base.sql`: the `northwind` schema with `users`, `teams`, `customers`, `tickets`, `csat_scores`, `sla_timers`, `kb_articles`, `customer_events`. RLS on, no API grants. Apply it with `supabase db query --linked -f`.
- [ ] **Step 2: Auth tests first:** `hashPassword`/`verifyPassword` (scrypt N=16384), sign and verify the session, and a tampered cookie is rejected. Then the login page and logout.
- [ ] **Step 3: Data-function tests first:** a Tier-1 agent never sees Tier-2 tickets, and an admin sees all.
- [ ] **Step 4:** Seed 3 users (`riley`, `casey`, `dana`, password `northwind-demo-2026`), 2 teams, about 40 tickets, 60 days of CSAT, about 12 KB articles, and customer events.
- [ ] **Step 5: UI.** Invoke every design skill first. Northwind gets its own brand (not Acme's "surveyed terrain" look) and a dense, designed support desk:
  - the queue with chips for status and priority, right-aligned SLA timers, hover/focus row actions with tooltips, and the required **Assign to me** and **Reply** actions;
  - a CSAT chart (hand-rolled SVG);
  - workload bars;
  - KB panel variants;
  - a timeline feed;
  - SLA alerts.

  Responsive at 390/768/1440 px, with an axe check.
- [ ] **Step 6:** Create the Vercel project `northwind-support` (root `apps/northwind`), deploy it, and tag `northwind-baseline`.
- [ ] **Step 7:** Commit `feat(northwind): baseline support desk with own auth`.

### Task 7: `contour-setup` skill + eval harness

**Files:**
- Create: `skills/contour-setup/SKILL.md`, `references/{manifest-guide,reader-guide,identity-guide,checklist}.md`, `scripts/discover.mjs`, `scripts/verify.mjs`
- Create: `apps/northwind-eval/run-skill.ts`, a harness that copies the `northwind-baseline` tree to a temp dir, installs the skill, and runs headless `claude -p` with scripted checkpoint answers
- Create: `@contour/sdk/testing` contract kit: `runContractKit({ manifest, policy, readers, componentIds })` returns a test report, used by `verify.mjs`

- [ ] **Step 1:** Write `SKILL.md` with frontmatter `name: contour-setup` and a description listing the triggers. The body covers the 8 phases, the ⏸ checkpoints (each phase ends with an explicit question to the owner, and the agent must not proceed without an answer), the guardrails, and the output report template. Reference files hold the exact code shapes for the manifest, readers, `resolveIdentity`, the mount, and the preview page, all matching the Task 2 interfaces.
- [ ] **Step 2:** `discover.mjs`: prints JSON with the framework, auth hints, data functions (`export async function get*`), page routes, and candidate dashboard components with their props. Test it on `apps/northwind`: it finds all 6 components and 6 data functions.
- [ ] **Step 3:** `verify.mjs`: runs the contract kit plus `tsc --noEmit` plus a local smoke test (`describe` → `propose` with a fixture selector → preview GET 200 → apply). It exits non-zero on any failure.
- [ ] **Step 4:** Run the eval harness on a fresh baseline copy. Pass criteria: build green, the contract kit green, and the transcript showing the three checkpoint questions before the matching edits. Save the transcript to `docs/evidence/skill-run.jsonl` (with init trimmed and secrets redacted).
- [ ] **Step 5:** Commit `feat(skill): contour-setup skill, contract kit, eval harness`.

### Task 8: Integrate Northwind with the skill

- [ ] **Step 1:** In `apps/northwind`, run Claude Code with the skill and act as owner Dana: lock alerts and require the queue; approve the reader fields; allow roles `agent`, `lead`, `admin`; kill switch default on.
- [ ] **Step 2:** Apply the migration for schema `northwind` (contour tables), set env, and register the project in Cloud as owner `dana@northwind.demo` (a Cloud account). Serve the nonce, deploy, and verify.
- [ ] **Step 3:** Run the OAuth/MCP suite against Northwind (parameterize `tests/oauth-mcp.test.ts` by `CONTOUR_TEST_URL` and the demo users, with Northwind sign-in through its own login form).
- [ ] **Step 4:** Commit the integrated result `feat(northwind): integrate Contour via contour-setup`.

### Task 9: Design polish across all apps
- [ ] **Step 1:** Run `impeccable` critique and polish on Cloud, Acme, and Northwind (a separate subagent per app). Apply the fixes.
- [ ] **Step 2:** Screenshots at 390/768/1440 for every primary screen to `docs/evidence/design/`. Axe with no serious or critical violations.
- [ ] **Step 3:** Commit `style: polish pass across apps`.

### Task 10: Two-project E2E, evidence, demo
- [ ] **Step 1:** `tests/e2e/two-projects.spec.ts` against production:
  1. sign up a consumer;
  2. link Acme (alex) and Northwind (riley);
  3. consumer MCP `list_projects` returns 2;
  4. propose on both;
  5. Accept at Northwind, Keep current at Acme;
  6. `get_view` confirms;
  7. the Northwind kill switch blocks only Northwind.
- [ ] **Step 2:** `scripts/agent-run-cloud.ts`: a headless Claude Code session against the Cloud MCP proposes on both projects. Save the evidence.
- [ ] **Step 3:** Update `docs/EVIDENCE.md`, `README.md`, and `docs/DEMO.md` (the 3-minute script from spec §12, with exact commands and logins).
- [ ] **Step 4:** Commit `docs: two-project evidence and demo script`.

## Self-review notes
- **Spec coverage:**
  - §3 layout: Tasks 1, 2, 4, 6
  - §4 login and linking: Task 4
  - §5 MCP: Task 4
  - §6 SDK API: Tasks 2 and 3
  - §7 Northwind: Tasks 6 and 8
  - §8 skill: Task 7
  - §9 invariants: tests in Tasks 4, 5, 8, 10
  - §10 design: the UI steps plus Task 9
  - §11 testing: each task plus Task 10
  - §12 demo: Task 10
- **Deviations recorded:** forwarding goes over the project's MCP endpoint, and the store is named `supabaseStore`.

### Task 11: Custom mods (added by user decision 3 Oct, after Tasks 1–10)
Agents compose **new** widgets from company-registered primitives (card, stat, table, list, line/bar chart, badge, text, filter chips), rendered with the company design system, bound only to company-approved data fields with whitelisted operations (filter, sort, group, count/sum/avg, top-N, time bucket). Setup (the `contour-setup` skill) declares the **data catalog**: which fields each reader exposes for mods, their types/semantics, and allowed operations. The MCP exposes `describe_mod_capabilities` (primitives + catalog + ops + limits) so an agent can discover what is even available, then `propose_mod` (validated mod tree → READY proposal → same preview/Accept in the company app). Console shows mods created/kept and lets operators promote a mod into an approved component. Requires its own mini-spec (brainstorm → spec) before implementation; may be delegated to Codex.
