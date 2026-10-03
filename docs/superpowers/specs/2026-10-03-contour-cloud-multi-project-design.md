# Contour Cloud, multi-project consumer MCP, and enterprise setup skill

Design spec. 3 October 2026. Extends the Contour build specification (baseline 0.3) and the shipped MVP (`docs/EVIDENCE.md`).

## 1. Goal

Cover both sides of the product in one demo.

- **Enterprise:** a site owner points an agent at their existing dashboard codebase. A setup skill proactively integrates the Contour SDK, stopping only at owner decisions, then registers and verifies the project.
- **Consumer:** a person installs one MCP server, signs in to Contour once, links each company project they use by signing in at that company, and then has their agent read and propose views across all linked projects. They accept or keep each proposal in the company's own app.

All invariants of the baseline spec still hold. Personalization changes presentation only. The company is the identity, permission, data, and approval authority. Agents and Contour Cloud never commit.

## 2. Decisions

| Topic | Decision |
|---|---|
| Consumer login | A Contour account (Supabase Auth on Cloud: email + password, magic link), plus per-project linking through each company's own login and consent. No email-based identity matching. |
| Hub ↔ project | Contour Cloud is an OAuth 2.1 client of each project's SDK authorization server. It identifies itself with a Client ID Metadata Document, uses authorization code + PKCE S256 with resource binding, and stores an encrypted refresh token per (Contour user, project). |
| Link entry points | All three: an agent tool (`connect_project`), the Cloud web "Connect a project" page, and a company-side "Connect your AI agent" panel shipped by the SDK. All of them start the same Cloud link flow. |
| Repo | A pnpm monorepo: `packages/contour-sdk`, `apps/cloud`, `apps/ops-demo`, `apps/northwind`, `skills/contour-setup`. The SDK is consumed as `workspace:*`. Nothing is published to npm. |
| Project #2 | "Northwind Support", a support desk with its own session auth in a `northwind` Postgres schema (not Supabase Auth), in the existing Supabase project. |
| Skill mode | Proactive with three owner checkpoints: the surface and locks, the reader data exposure, and the identity and agent roles. Plus go-aheads for registration and deploy. |
| Domains | Cloud keeps `https://contour-sdk.vercel.app`. Acme moves to `https://contour-acme.vercel.app`. Northwind is at `https://northwind-support.vercel.app` (each one is checked for availability, with a fallback name if taken). |
| Design quality | Every UI and copy surface is built with the installed skills (section 10). Each app gets its own visual identity. |

## 3. System layout

| Package | Responsibility |
|---|---|
| `packages/contour-sdk` | Contract types, closed schemas, registration and config validation, candidate generation, diff, hashing, the broker, the JEV selector, and the React renderer (`AdaptiveSurface`, `ViewPreview`, `ContourPreviewPage`, `ConnectAgentPanel`). Plus the **project API** (`createContourHandlers`): OAuth authorization server, consent, project agent API, host routes, `.well-known` files, and an optional direct project MCP. Plus the store adapters (`supabaseStore({ schema })`), the `contour migrate` CLI, and the contract test kit. Framework adapter: Next.js App Router. |
| `apps/cloud` | Contour Cloud: consumer accounts, the site-owner console and project registry, domain verification, link flows, the encrypted grant vault, the consumer MCP (`/api/mcp`) with its own OAuth authorization server for MCP clients, and the Cloud CIMD at `/oauth/client.json`. |
| `apps/ops-demo` | The existing Acme operations dashboard, refactored onto the SDK package. Project #1, registered in Cloud. Keeps Stripe billing through the SDK billing adapter. |
| `apps/northwind` | The Northwind Support baseline (no Contour), then the skill-integrated version. Project #2. |
| `skills/contour-setup` | The enterprise setup skill (section 8). |

### Trust boundaries
- **Cloud:**
  - It knows a consumer's Contour identity and their link records.
  - It never stores company-internal user IDs, beyond an optional display hint the project chooses to return.
  - It holds only opaque, audience-bound project tokens whose scopes are a subset of `view:read`, `data:read`, `view:propose`.
- **Each project:**
  - It verifies every forwarded call from scratch: token, grant, membership, kill switch, scopes, and broker validation.
  - Approval (`Accept`) exists only in the company app at `/contour/preview/:id`.
- **Data placement:** per-project data (preferences, views, history, proposals, approvals, decisions, usage, billing ledger) lives in the company's store.
  - Acme keeps its existing `public` tables.
  - Northwind uses `northwind.contour_*`.
  - Cloud uses the `cloud` schema.

  In the demo they share one Postgres instance, and each schema is reachable only through its own app's server with explicit filters. RLS is enabled everywhere, and the API roles have no grants on `cloud` or `northwind`.

## 4. Consumer identity and linking

### Contour account
Supabase Auth on Cloud with email + password and magic link. The demo consumer is `jordan@contour.demo`.

### Consumer MCP authorization
Cloud runs the same OAuth 2.1 authorization server implementation as projects, from the SDK:
- issuer `https://contour-sdk.vercel.app`, resource `https://contour-sdk.vercel.app/api/mcp`;
- PRM and AS metadata, DCR and CIMD, PKCE S256, refresh rotation, revocation.

Its consent screen names the client and the operations: list and link projects; describe, read, and propose on linked projects; never save.

### Project registration
1. A site owner signs in to the Cloud console and creates a project: name, company name, base URL, surfaces.
2. Cloud issues a project ID and a one-time verification nonce.
3. The project serves `/.well-known/contour-project.json` = `{ projectId, nonce, agentApiResource, authorizationServer }`.
4. Cloud fetches it, with address pinning, HTTPS only, no redirects, size and time limits. It checks the ID and nonce, reads the project's AS metadata, and marks the project verified. Re-verification runs on demand.
5. The project trusts Cloud by listing `https://contour-sdk.vercel.app/oauth/client.json` in `trustedClients`. Cloud's CIMD declares `redirect_uris: ["https://contour-sdk.vercel.app/link/callback"]`, and its client name is "Contour Cloud".

### Link flow
```
entry: connect_project tool | Cloud /projects (Connect) | company <ConnectAgentPanel>
  → Cloud /link/start?project=<id>         requires Contour session; shows "Link <project> to your Contour account <email>?";
                                           on Continue creates link_state
                                           {state, contour_user, project, pkce verifier (encrypted), expiry 10 min, single use}
  → project /oauth/authorize?client_id=<Cloud CIMD>&redirect_uri=<cloud callback>&resource=<agent api>&scope=view:read data:read view:propose&code_challenge=…&state=…
       company login (company's own auth) → company consent screen names the client "Contour Cloud" and the scopes
  → Cloud /link/callback?code&state&iss    validates state (single use, same session, iss = registered AS) → token exchange with PKCE and resource
  → cloud.links upsert (contour_user, project): refresh token encrypted (AES-256-GCM, key from env, key id stored), scopes, status active
```
- **Re-linking** replaces the grant.
- **Linking a project from a second Contour account** is allowed (it is the company user's choice) and creates an independent grant.

### Unlink and revocation
- When a user unlinks in Cloud, Cloud calls the project's revocation endpoint and deletes its tokens.
- When the company revokes, its kill switch is on, or the role changes, the project answers 401 or 403. Cloud maps that to `PROJECT_ACCESS_REVOKED` or `AGENT_ACCESS_DISABLED` and marks the link `needs_reconnect` (for revocation) or leaves it active (for a kill switch).
- Refresh-token reuse detection at the project invalidates the grant. Cloud marks the link `needs_reconnect`.

## 5. Consumer MCP (Cloud `/api/mcp`)

Stateless JSON-RPC over Streamable HTTP. It supports protocol 2026-07-28 (per-request `_meta`, mirrored headers, `server/discover`, list caching fields) and the legacy `initialize` versions. Every method requires a Cloud bearer token.

| Tool | Behavior |
|---|---|
| `list_projects {}` | The caller's links: `projectId`, name, company, surfaces, status. |
| `list_available_projects {}` | Verified projects without a link for this caller: name, company, description. |
| `connect_project {projectId}` | Returns `{ linkUrl, expiresAt }` for the user to open. It never accepts credentials. |
| `describe_surface {projectId, surfaceId}` | Forwarded. |
| `read_component_data {projectId, surfaceId, readerId, input?}` | Forwarded. The response is wrapped with `project` and `untrustedContent: true`. |
| `propose_view {projectId, surfaceId, baseRevision, task, expertise, preferences?, note?, requestId}` | Forwarded. Returns the company-hosted `previewUrl`. |
| `get_view {projectId, surfaceId, proposalId?}` | Forwarded. |

No commit, reset, or undo tools exist. All tools have closed input schemas.

### Forwarding rules
- Resolve the link by (caller, projectId). If it's missing, return `NOT_FOUND`.
- Get the access token from the encrypted cache, or refresh it (rotation, with a single-flight lock per link to avoid refresh races).
- Call the project's MCP endpoint (`agentApiResource` = `{appUrl}/api/mcp`) with JSON-RPC `tools/call`. Only that registered HTTPS origin is called, with address pinning, no redirects, an 8 s timeout, and a 256 KB response cap.
- Map project errors to stable codes, and add Cloud codes: `LINK_REQUIRED`, `PROJECT_ACCESS_REVOKED`, `PROJECT_UNAVAILABLE`, `AGENT_ACCESS_DISABLED`.
- Rate-limit per caller and per project.
- Never log tokens, and never put them in model-visible output.

## 6. SDK project API

```ts
// app/api/contour/[...contour]/route.ts
export const { GET, POST } = createContourHandlers({
  projectId, appUrl,
  manifests, policies, readers, componentIds,
  resolveIdentity,                 // (request) => VerifiedHostUser | null, from the company's own session
  store: supabaseStore({ schema }),
  selector: jevSelector(),
  trustedClients: ["https://contour-sdk.vercel.app/oauth/client.json"],
  allowDynamicClients: true,       // direct project MCP for single-project users
  billing: stripeBilling(opts) | noBilling(),
});
```

**Routes** (under the mount, plus the `.well-known` rewrites the skill adds):
- OAuth: PRM, AS metadata, `authorize` (consent page rendered with the host's layout via `renderConsent`), decision, token, register, revoke.
- `/.well-known/contour-project.json`
- Agent API: `POST agent/tools/{describe_surface|read_component_data|propose_view|get_view}`
- Optional direct MCP: `POST mcp`
- Host routes: `host/proposals`, `host/proposals/:id/{apply,reject}`, `host/view/{undo,reset}`, `host/preferences`, `host/view`
- Billing, if enabled: `billing/checkout`, `stripe/webhook`

**React:** `<AdaptiveSurface>`, `<ViewPreview>`, `<ContourPreviewPage>` (built from the host's components and tokens through a `theme` prop), and `<ConnectAgentPanel cloudUrl projectId>`.

**`supabaseStore({ schema })`:** the existing transactional SQL (create proposal + consume credit, apply with CAS, commit snapshot, reserve/release/grant credit, OAuth tables, rate limits), parameterized by schema. `contour migrate --schema <s>` creates the tables, the RLS, and the function grants.

The Acme migration keeps its current `public` tables through a compatibility mapping, so no data moves.

**Behavior parity:** the SDK extraction must keep all existing tests green: 32 unit, 27 integration, 32 OAuth/MCP, 4 webhook, and 6 e2e tests.

## 7. Northwind Support (project #2)

### Baseline (tag `northwind-baseline`, no Contour code)
- **Auth:** `northwind.users` (scrypt hash, role `agent | lead | admin`, team) and an HttpOnly signed session cookie. Demo users:
  - `riley@northwind.demo`: new agent, Team Tier 1
  - `casey@northwind.demo`: senior agent, Team Tier 2
  - `dana@northwind.demo`: admin and site owner

  All use password `northwind-demo-2026`.
- **Data:** synthetic `northwind.tickets`, `customers`, `csat_scores`, `sla_timers`, `kb_articles`, and `customer_events`. Agents see their own team's tickets only, enforced in the data functions.
- **The support desk screen** has six components:
  1. SLA breach alerts (must stay visible)
  2. Ticket queue (carries the required *Assign to me* / *Reply* actions)
  3. CSAT trend
  4. Team workload
  5. Knowledge base
  6. Customer timeline

  Nav, admin, and billing pages sit outside the screen.
- **Code shape:** data functions such as `getTickets(session, filter)` and `getCsatTrend(session, range)`, components with existing variant props, and the brand's own design system.

### Integrated result (committed separately after the skill run)
- A support-desk manifest: locked alerts, the required ticket queue, variants from existing props, three templates (narrow/medium/wide), tasks (`triage_queue`, `review_quality`), and expertise (`new`, `experienced`).
- Readers over the existing data functions, keeping the team check, with owner-approved field allowlists.
- `resolveIdentity` over the Northwind session.
- The catch-all mount, `northwind.contour_*` tables, and `<AdaptiveSurface>` around the desk region only.
- A `/contour/preview/:id` page and `<ConnectAgentPanel>` in settings.
- An admin kill switch.
- Registered and verified in Cloud.
- `CONTOUR_SETUP_REPORT.md`.

## 8. `contour-setup` skill

`skills/contour-setup/SKILL.md` with reference files (`manifest-guide.md`, `reader-guide.md`, `identity-guide.md`, `checklist.md`) and scripts (`discover.mjs` for a repo inventory, `verify.mjs` to run the contract kit and the smoke test). Triggers: "add Contour", "set up Contour", "make my dashboard adaptive", "connect my app to Contour Cloud".

| Phase | Agent does | Owner checkpoint |
|---|---|---|
| 1 Discover | Inventories the framework, auth, data layer, routes, candidate screens, components and their props, data functions, permission checks, and fixed chrome. Writes a discovery summary. | none |
| 2 Propose surface | Drafts the surface, components, semantic roles, variants from props, templates, tasks, and expertise levels. | ⏸ Confirm the surface; choose locked and required components |
| 3 Data exposure | Drafts a reader per component around the existing data functions: closed inputs, field allowlist, bounds, existing permission checks. | ⏸ Approve the exact fields per reader |
| 4 Identity | Writes `resolveIdentity` over the existing session: tenant, role, role version, data access. | ⏸ Confirm which roles may use agents; set kill-switch defaults |
| 5 Wire | Installs the SDK, adds the mount and `.well-known` rewrites, runs migrations, wraps the region, adds the preview page and connect panel, and sets env. Follows repo conventions and the company design system. | none |
| 6 Register | Creates the project in Cloud (owner's Cloud session via device code), serves the verification file, and verifies. | ⏸ Go-ahead to register |
| 7 Prove | Runs the contract kit, the local describe → propose → preview → accept smoke test, `tsc`, lint, and build. | none |
| 8 Ship | Deploys, runs the production smoke test, and writes `CONTOUR_SETUP_REPORT.md` (integration summary, owner decisions, agent-visible data, revocation, rollback). | ⏸ Go-ahead to deploy |

Guardrails:
- Never mark data readable or a control unlocked without the checkpoint.
- Never publish packages.
- Never weaken a rule to make a test pass. Stop with a concrete fix instead.
- Never put secrets in code or reports.

## 9. Security invariants (each becomes a test)
1. Cloud can't commit, reset, or undo at any project. Project database constraints cap OAuth scopes at agent scopes.
2. A `projectId` outside the caller's links returns `NOT_FOUND` for every tool.
3. Link state is single-use, bound to the session, PKCE-bound, `iss`-checked, and expires after 10 minutes. Replaying it or using it from another session fails.
4. Project tokens are encrypted at rest and never appear in logs, URLs, model-visible output, or browser responses.
5. A company user linked to Contour account A is not reachable from account B unless that user links B too.
6. Revocation, kill switch, or role change at a project takes effect on the next Cloud call. Acme is unaffected by a Northwind kill switch.
7. Cloud → project calls go only to the registered, verified HTTPS resource, pinned, with no redirects and bounded.
8. A project isn't listed or linkable before domain verification.
9. All existing guarantees and security-review fixes hold.

## 10. Design quality requirements
- Every UI and copy surface in `apps/cloud`, `apps/northwind`, the SDK React components, and `apps/ops-demo` is designed and reviewed with the installed skills:
  - copy: `better-copy`, `better-writing`;
  - layout and type: `better-layouts`, `better-layout`, `better-typography`;
  - color, interface, accessibility: `better-colors`, `better-ui`, `better-interface`, `better-accessibility`;
  - the dashboards also get `designing-dashboard-uis`;
  - taste: `design-taste-frontend` and `high-end-visual-design`.
- Before the demo, an `impeccable` critique and polish pass runs on all three apps.
- Distinct identities:
  - **Cloud:** a calm, premium consumer hub (project list, link states, activity).
  - **Acme:** keeps "surveyed terrain".
  - **Northwind:** its own support-desk brand.
- SDK components inherit each host's tokens, which shows the SDK adapting to company design systems.
- Rules: no em dashes in UI copy, no eyebrow labels, semantic color only, right-aligned numerals, and designed hover/focus/empty/loading/error/permission states.
- Checks:
  - screenshots at 390/768/1440 for every primary screen;
  - automated accessibility checks (axe) with no serious or critical violations;
  - keyboard-only paths through link, consent, preview, and accept.

## 11. Testing
- **Unit:** the SDK (the migrated 32 tests) plus Cloud link state, encryption, forwarding, and error mapping.
- **Integration:** the broker suite against `supabaseStore` for both the `public` (Acme) and `northwind` schemas, plus Cloud link and forward against a running project.
- **OAuth/MCP:** the project AS suite (the migrated 32 tests, run against both projects), and a Cloud MCP suite (list, connect, describe/read/propose across two projects; cross-account and cross-project spoofing; revocation propagation; refresh single-flight).
- **E2E on production:**
  1. consumer signup;
  2. link Acme as Alex, link Northwind as Riley;
  3. one headless Claude Code session proposes on both;
  4. Accept at Northwind, Keep current at Acme;
  5. `get_view` confirms both;
  6. the Northwind kill switch blocks only Northwind.
- **Skill eval:** a headless Claude Code run of `contour-setup` on a fresh copy of `northwind-baseline`, with checkpoints answered by the harness. It passes when the build is green, the contract kit passes, and the smoke test passes, and the transcript shows each checkpoint was asked before the related change. The transcript is kept as evidence.
- **Design QA:** as in section 10.

## 12. Demo script (3 minutes)
1. **Enterprise:** show the Northwind baseline. In Claude Code: "add Contour to this app". Show discovery, the three owner checkpoints, wiring, registration, verification, and the green contract kit. Fast-forward the recording, with the checkpoints live.
2. **Consumer:** run `claude mcp add --transport http contour https://contour-sdk.vercel.app/api/mcp` and sign in to Contour (`list_projects` is empty). "Connect me to Acme and Northwind" produces two links. Sign in at each company and approve.
3. "At Northwind I'm new and triaging tickets; at Acme I'm an expert reviewing performance." Two proposals. Accept at Northwind, Keep current at Acme. `get_view` confirms.
4. **Control:** the Northwind admin flips the agent kill switch, and the agent's next Northwind call fails cleanly while Acme still works. The consoles show decisions and cost.

## 13. Order of work
1. Monorepo plus SDK extraction, with parity (all existing tests green, Acme redeployed at its new alias).
2. Cloud: accounts, owner console, registry and verification, CIMD, link flows, vault, consumer MCP.
3. Acme registered as project #1. Cross-project tests with Acme alone.
4. Northwind baseline (designed with the skills), tagged.
5. The `contour-setup` skill plus its eval harness.
6. Run the skill on Northwind, commit the result, register project #2, and deploy.
7. Design polish across all apps (section 10).
8. Two-project E2E, evidence, demo rehearsal.

## 14. Out of scope
- Publishing the SDK to npm.
- Non-Next.js framework adapters.
- Arbitrary third-party sites without a codebase.
- Business-data writes.
- Agent-side commit.
- Company reporting beyond the existing console.
- Cross-project preference sync. Preferences stay per project; Cloud doesn't infer them.
