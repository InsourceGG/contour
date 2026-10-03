# Contour app setup checklist

For a company integrating Contour into one of its own screens. Work through it top to bottom. Each item names the file in this reference implementation that shows how it's done.

## 1. Choose the surface and lock what must not move
- [ ] Pick one company-owned screen or bounded region and give it a stable `surfaceId` (here: `overview`).
- [ ] Keep global navigation, authentication, account and security controls, pricing, and destructive actions **outside** the adaptable region (`src/components/AppShell*`).
- [ ] Mark required components with `required: true` (never hidden) and policy-fixed ones with `locked: true` (region, order, variant, and visibility fixed). In this demo, alerts are locked and required, and the task queue is required because it carries the required Acknowledge action.

## 2. Register components (manifest)
- [ ] For each component: a stable `id`, a `semanticRole`, a description, approved `variants` with descriptions, a **closed** `settingsSchema` (enum/boolean/bounded integer/bounded string only), `defaultSettings`, `allowedRegions`, and an optional `readerId` + `requiredScope` (`src/host/manifest.ts`).
- [ ] Define approved templates with `narrow`/`medium`/`wide` breakpoints: region order (this is the reading and focus order), spans, and per-breakpoint capacity. No freeform coordinates.
- [ ] Declare cross-component dependencies (e.g. annotated revenue needs visible metrics).
- [ ] Provide a fully valid `defaultConfig` that includes every component.
- [ ] Map each component ID to a React implementation (`src/host/components/index.ts`) and list it in `src/host/component-ids.ts`.
- [ ] Run the contract suite: `pnpm -F @contour/sdk exec vitest run`. `defineAdaptiveApp` throws at startup on any registration error.

## 3. Write the candidate policy
- [ ] Map each supported task to an approved arrangement and each explanation level to approved variants (`src/host/policy.ts`). Density follows the user's explicit preference; expertise never forces density or hides required controls.
- [ ] Keep the task and expertise vocabulary small and explicit. Unknown values return `ASK`.

## 4. Implement readers against your backend
- [ ] One narrow server function per reader, with a closed input schema, minimum scope, field allowlist, page/row bounds, and a semantic description (`src/host/readers/index.ts`).
- [ ] Take tenant and subject **only** from `VerifiedContext`. Never accept identifiers, field names, filters, SQL, GraphQL, or URLs as input.
- [ ] Enforce row and field permissions inside the reader (see the restricted-task rule).
- [ ] Classify reader output. Free text written by other users is untrusted content and is labeled as such.

## 5. Map identity
- [ ] Host session: verify the user with your auth provider on the server and resolve tenant membership and role from server records (`src/server/context.ts`). Request parameters, browser state, MCP arguments, and model text never establish identity.
- [ ] Agent access: an OAuth 2.1 authorization server that issues audience-bound, scoped tokens to MCP clients (`packages/contour-sdk/src/server/oauth/*`, configured with `defineContourServer`). Grants are per user × client × tenant × app with allowed surfaces. Agents get `view:read`, `data:read`, and `view:propose` only. They never get commit.
- [ ] Re-check membership and grant state on every broker call. Don't cache authorization.

## 6. Data store and isolation
- [ ] Apply `supabase/migrations/*`. RLS is enabled on every table. Owner-scoped SELECT policies require `auth.uid()` plus an active membership, and preference updates use `USING` + `WITH CHECK`.
- [ ] Keep the service-role key server-only. Every privileged query applies explicit tenant/app/subject/surface filters (`src/server/store.ts`).
- [ ] Run the isolation tests with two users in one tenant and a third in another: `pnpm exec vitest run tests/integration`.

## 7. Model selection
- [ ] Configure the JEV selector (`JEV_MODEL`, `AI_GATEWAY_API_KEY`, `JEV_CONFIDENCE_FLOOR`, `JEV_TIMEOUT_MS`). Pin a model version before tuning.
- [ ] Run the labeled evaluation set and keep a held-out subset (`pnpm tsx --conditions react-server scripts/eval-jev.ts 3 [--holdout]`). Calibrate the floor from the results. Confidence is a fit judgment, not a security threshold.
- [ ] Confirm that every failure mode (timeout, provider error, malformed output, low confidence) keeps the current view.

## 8. Billing (if metering adaptation jobs)
- [ ] Use a server-configured Stripe price. Create Checkout Sessions for server-owned pending orders bound to the verified subject, tenant, and app (`src/app/api/billing/checkout`).
- [ ] Verify webhook signatures on the raw body, re-retrieve the session, check paid status, price, amount, and currency, then grant one credit atomically with dedupe on the event ID and the order (`src/app/api/stripe/webhook`, `contour_grant_credit`).
- [ ] Reserve a credit before each job. Consume it in the same transaction that persists a READY proposal, and release it on KEEP, ASK, or failure.

## 9. Compatibility and rollback
- [ ] Bump `manifestVersion` or `policyVersion` on any contract change. Pending proposals become `INVALID`, and saved views from older versions fall back to the current default with a recoverable status.
- [ ] A role change (`memberships.role_version`) invalidates pending proposals. Revoking data access takes effect on the next request.
- [ ] Rollback means redeploying the previous manifest version. Saved snapshots are data, not code, so they can be revalidated.
- [ ] Operators can disable all agent access instantly from `/console` and revoke all grants.

## 10. Before go-live
- [ ] Browser checks at 390/768/1440 px: keyboard-only preview and apply, focus order, contrast, reduced motion (`tests/e2e`).
- [ ] Human review of the rendered variants. Validators only enforce encoded rules; they can't certify usability.
- [ ] Agree on retention (proposals expire after 24 h; decision metadata is kept 30 days; 20 history revisions), consent text, and reporting cohort thresholds with your privacy team.
