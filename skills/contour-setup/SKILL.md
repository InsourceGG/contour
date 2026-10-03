---
name: contour-setup
description: Integrate the Contour SDK into an existing app when the owner says "add Contour", "set up Contour", "make my dashboard adaptive", or "connect my app to Contour Cloud". Discover the app, ask owner decisions, wire its own components and identity, verify, and request registration and deployment approval.
---

# Add Contour to an existing app

Make one approved dashboard region adaptive. Keep the company app in charge of identity, permissions, data, and accepting proposals. Work proactively between the five checkpoints below.

## Before starting

Read repo instructions, package scripts, and the installed framework documentation. Use the repo's package manager, paths, naming, and feature-branch conventions. Examples below use `src/app` and `src/contour`; for a root `app/` repo, adapt both paths consistently and record the mapping.

Use `@contour/sdk` from the workspace with `workspace:*` in this demo. Never publish a package. Read its installed exports before wiring. The binding server API is `defineContourServer(config)` and then `createContourHandlers(server, { broker, projectId, wellKnownNonce })`. Do not use the older single-object mount example or invent SDK exports.

Use the host's existing components, tokens, layout, and styles. Do not introduce a styling system. Keep navigation, account controls, admin pages, and billing outside the adaptive region. Preserve actions, draft state, focus order, empty, loading, error, and permission states. Use plain copy without em dashes.

## Checkpoint protocol

At each checkpoint, print its exact marker as a standalone assistant text line, show a compact proposal table with defaults, and ask the exact question below. MUST ask and wait for the owner's answer before any gated edits or action. A draft is text in the conversation, not an edited integration file.

If the owner already supplied an explicit answer, still print the marker, table, and question before the gated action. Quote the matching prior answer and apply it without asking again. A prior answer only covers the proposal it actually approves. Ask again if the proposal changes materially. Silence is never approval.

Do not combine checkpoints into one question. Record each decision in the report. A declined registration or deployment still requires its question and marker; record the skip and continue work that remains authorized.

## Phase 1: Discover

Run `node <skill-dir>/scripts/discover.mjs <appDir>`. Inspect the results and source: framework/router, verified session, data functions and permission checks, candidate screens, component props, and fixed chrome. Discovery uses heuristics; confirm imports, aliases, and authorization by reading code.

Create `CONTOUR_DISCOVERY.md`: app root, framework, auth, candidate routes, component/variant map, data functions and field types, permission rules, fixed chrome, and unresolved SDK requirements. Do not copy secrets. No checkpoint.

## Phase 2: Propose the surface

Read [manifest-guide.md](references/manifest-guide.md). Propose one surface, semantic roles, existing variants, closed settings, regions/templates/breakpoints, tasks, expertise, and dependency rules. Mirror the current safe layout in the default view. For Northwind propose surface ID `desk`, route `/desk`, tasks `triage_queue` and `review_quality`, and expertise `new` and `experienced`.

Print `⏸ CHECKPOINT 1: surface and locks`.

| Decision | Proposed default |
| --- | --- |
| Surface | Discovered primary dashboard region; Northwind `/desk` |
| Locked and required | Safety alerts; Northwind `SlaAlerts` in the first fixed region |
| Required, movable | Main action queue; Northwind `TicketQueue` |
| Other components | Discovered panels, optional within approved regions |
| Fixed chrome | Navigation, account, admin, and billing stay outside |

Ask: **"Use this surface and these locked and required components? Reply yes or list changes."**

Only after the answer, create `src/contour/manifest.ts` and `src/contour/components.tsx`. Export `manifest` and the client-side component adapters. Export `componentIds` from `src/contour/component-ids.ts` so server code never imports client components. Do not change the target screen yet.

## Phase 3: Approve data exposure

Read [reader-guide.md](references/reader-guide.md). Draft a `ReaderDef` per approved data component over its existing data function. Keep the existing permission checks. Set closed inputs, finite counts, text bounds, and explicit output projections.

Print `⏸ CHECKPOINT 2: reader fields`.

| Reader | Existing function | Exact approved output fields | Bounds/defaults |
| --- | --- | --- | --- |
| One row per reader | Verified-session data function | Enumerate every field, including nested fields | Input enums, row and text caps |

Populate this table from actual types. Propose no credentials, private notes, or customer email by default. Flag user-written text as untrusted. Present the whole allowlist, never only a summary.

Ask: **"May agents read exactly these fields with these bounds? Reply yes or list fields to remove or change."**

Only after the answer, create `src/contour/readers.ts`, exporting `readers`. An approved `fields` list is metadata; enforce it in each returned object. Keep richer host rendering data separate.

## Phase 4: Map identity and agent access

Read [identity-guide.md](references/identity-guide.md). Propose the existing verified session mapped to `HostUser` and live `Membership`: subject, tenant, session ID, current role/version, status, and data access. Never match people by email. Recheck membership on every call.

Print `⏸ CHECKPOINT 3: agent access`.

| Decision | Proposed default |
| --- | --- |
| Identity | Existing verified company session, no new login system |
| Allowed roles | Discovered roles with current data access; list exact role names |
| Kill switch | On initially, so `agentAccessEnabled` returns false |
| Revocation | Current membership/version plus grant revocation, checked on next call |

Ask: **"Allow these roles to use agents, with the kill switch on by default? Reply yes or specify roles and the switch default."**

Only after the answer, create `src/contour/identity.ts`, `src/contour/policy.ts`, and `src/contour/server.ts`. Export `identity`, `policy` (`CandidatePolicy`), and `contour` (`defineContourServer`). Implement an admin-only persisted kill switch. Northwind role names are `agent`, `lead`, `admin`. On means disabled, never enabled. Add any needed identity/version and switch SQL to `supabase/contour-host.sql`; preserve existing auth and team rules.

## Phase 5: Wire the app

Read [wiring-guide.md](references/wiring-guide.md). Install workspace SDK and peer dependencies using existing conventions. Create:

- `src/contour/db.ts`: unscoped server-only database client from existing credentials.
- `src/contour/broker.ts`: registry, store from `contour.store`, selector, broker.
- `src/contour/index.ts`: verification registration exports `manifest`, `policy`, `readers`, `componentIds`. Keep this import free of request-only session calls and client rendering.
- `contour.config.json`: `{ "contourModule": "src/contour/index.ts" }`.
- `src/contour/handlers.ts`: route table and catch-all dispatcher.
- `src/app/api/contour/[...contour]/route.ts`: export HTTP handlers.
- `src/app/oauth/authorize/page.tsx`: company consent page using SDK validation.
- `src/contour/surface.tsx`, `src/contour/surface-data.ts`: host-rendered wrapper and permission-scoped data loading.
- `src/app/contour/preview/[id]/page.tsx`, `src/contour/preview-actions.tsx`: company preview, Accept, and Keep current.
- `src/contour/connect-panel.tsx`: SDK `ConnectAgentPanel` using host settings styles.
- `src/app/api/contour-admin/agent-access/route.ts`: authenticated admin-only switch with same-origin and CSRF checks.

Edit the chosen screen to wrap only its approved region with `AdaptiveSurface`. Edit the existing settings page to show the connect panel and grant revocation controls, and the admin page to show the switch. Keep original actions and URL filters working. Add the rewrites and `transpilePackages` to the existing `next.config.*`. Add names and descriptions to `.env.example`; set real values only in ignored local env files or the owner's environment manager.

Run `pnpm exec contour-migrate --schema <approved-schema> --apply` against the authorized database, keeping RLS and least-privilege grants. For Northwind use `northwind`, never `public` or `cloud`. Apply host SQL through the repo's existing migration flow. No new external service is needed when the repo already has its database. Do not invent a provider or replace existing infrastructure.

## Phase 6: Register in Cloud

Read [registration-guide.md](references/registration-guide.md). Prepare the registration details before contacting Cloud.

Print `⏸ CHECKPOINT 4: register`.

| Decision | Proposed default |
| --- | --- |
| Project | Host product/company name, approved surface IDs |
| Origin | Owner's configured HTTPS app origin |
| Cloud | `CONTOUR_CLOUD_URL` |
| Authorization | Owner session/device flow, or supplied `CONTOUR_PROJECT_TOKEN` |
| Missing credentials | Skip registration and report the missing names |

Ask: **"Register this project with Contour Cloud and verify its origin? Reply yes or skip."**

Only after the answer, create the Cloud project, obtain its ID/nonce, and save `src/contour/project.json` with only `{ projectId, nonce }`. Wire these into `createContourHandlers`, serve the verification document, and ask Cloud to verify. A configured origin that cannot serve the nonce cannot be reported verified. When env is absent or the owner declines, skip explicitly, leave the connect action disabled with a useful explanation, and do not fabricate a project ID.

## Phase 7: Prove the integration

Read [checklist.md](references/checklist.md). Run `node <skill-dir>/scripts/verify.mjs <appDir>` and add `--base-url <local-origin>` for the three HTTP smoke checks. An unavailable contract kit exits 2 and blocks a verified claim.

Run repo lint and a build for this integration unless repo instructions prohibit them. The scripted checks do not prove the full authenticated flow. Test describe, read, propose with a fixture selector, preview GET, and apply through the authenticated company host route in an isolated fixture. No external agent receives commit scope. Respect repo rules on browser verification; hand manual UI checks to the owner when required. Record skipped checks and reasons. Never weaken a permission rule or allowlist to pass a test.

## Phase 8: Ship or hand off

Print `⏸ CHECKPOINT 5: deploy`.

| Decision | Proposed default |
| --- | --- |
| Target | Existing deployment project and approved environment |
| Changes | Reviewed integration diff and migration summary |
| Checks | Actual results, unresolved failures, and manual checks |
| Rollback | Switch off agents, revoke grants, restore original region |

Ask: **"Deploy this integration to the listed target? Reply yes or no."**

Deploy only after approval. If approved, use the repo's deployment flow and run the production HTTP smoke checks. If declined, stop at the local handoff. Always create `CONTOUR_SETUP_REPORT.md` using the template below. Do not claim registration, tests, or deployment succeeded without evidence.

## Guardrails

- Never mark data readable or a control unlocked without its checkpoint.
- Keep expertise and task separate from authorization. Adapt presentation only.
- Agents and Cloud may read and propose; only a verified host session may Accept, undo, or reset.
- Keep auth, team/tenant scoping, CSRF, grant/version checks, and revocation intact.
- Never publish packages, put secrets in source/reports, or weaken a rule to pass checks.
- If an SDK export or required route is missing, report the exact gap and fix needed. Do not add a permissive stand-in.

## Report template

```markdown
# Contour setup report

## Integration
App/root, chosen route and surface ID, SDK version, schema, created/edited files.
Original components/tokens reused, fixed chrome, defaults, locks, required actions.

## Owner decisions
| Checkpoint | Proposal | Owner answer/source | Outcome |
| --- | --- | --- | --- |
| 1 through 5, one row each | Exact proposal | Explicit answer | Applied or skipped |

## Agent-visible data
| Reader | Function | Exact fields | Bounds | Permission rule | Untrusted text |
| --- | --- | --- | --- | --- | --- |

## Identity and revocation
Verified session mapping, tenant, roles/version source, switch default/control,
grant revoke/revoke-all controls, next-call enforcement, excluded fields.

## Verification
| Check | Command or manual procedure | Observed result |
| --- | --- | --- |
Discovery, typecheck, contract kit, HTTP smoke, authenticated fixture flow,
lint/build, and owner UI checks. Distinguish pass, fail, unavailable, and skipped.

## Registration and deployment
Cloud origin/project ID, verification status, deploy target/result or skip reason.
Do not include credentials, tokens, cookie values, or the nonce.

## Rollback and remaining work
Disable agent access, revoke affected grants, revert integration commit/wrapper,
keep host data and auth intact. List exact SDK gaps and manual checks.
```
