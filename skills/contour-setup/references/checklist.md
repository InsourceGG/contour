# Final checks

Use actual observed results. Missing SDK functionality is a failure or unavailable check, never a pass.

- [ ] Five exact checkpoint markers and explicit questions precede each gated edit/action. Prior answers are quoted and applied only to the matching proposal.
- [ ] Only the approved region is adaptive; chrome, required actions, baseline permission checks, drafts, and existing URL filters remain intact.
- [ ] Every manifest component has a renderer, reader reference, supported variant, closed settings, and valid default. Required/locked components fit every template/breakpoint.
- [ ] All task/level candidates validate. Task and expertise never confer access.
- [ ] Readers parse closed inputs, bound rows/text/output/time, project only the approved allowlist, label untrusted text, and never call mutations. Customer email is excluded unless explicitly approved.
- [ ] MCP readers reconstruct a verified live Session from context rather than requiring a browser cookie or accepting team/user inputs.
- [ ] HostUser/session IDs are verified and stable; Membership uses current tenant/app, role/version, status, and dataAccess. Role/team changes and deleted/suspended membership block on the next call.
- [ ] Kill switch defaults match the decision; on means agent access disabled. Admin toggle and grant revocation enforce identity, origin, and CSRF.
- [ ] SDK tables use only the approved schema with RLS and least-privilege grants. No secret is in source, browser bundles, reports, or transcripts.
- [ ] Catch-all dispatch and rewrites preserve resource metadata, authorization endpoints, MCP, and host routes. OAuth consent is company-hosted and accepts only verified identities.
- [ ] Registration module exports manifest, policy, readers, componentIds, and imports without request-only calls or client components. contour.config.json selects it.
- [ ] `node <skill-dir>/scripts/verify.mjs <appDir>` passes typecheck and `runContractKit({ manifest, policy, readers, componentIds })`. Exit 2 means contract kit unavailable and blocks the claim.
- [ ] With a running app, `--base-url <origin>` checks metadata GET 200 with resource, unauthenticated MCP POST 401 with resource_metadata challenge, and project document GET 200. A skipped registration normally means project document 404 and this full smoke check cannot pass; record that limitation.
- [ ] In an isolated authorized fixture, describe/read/propose using an SDK fixture Selector, follow returned company preview URL (200), and apply through an authenticated host route with CSRF and matching configHash/idempotencyKey. Confirm the saved revision changed. Keep current/reject must leave it unchanged. Do not use real user preferences as a test fixture.
- [ ] Check negative paths: agent commit denied; cross-user/tenant preview hidden; unapproved fields/inputs rejected; role change, revocation, and kill switch enforced. To test agents when the switch default is on, enable only an isolated fixture and restore it afterward.
- [ ] Run repo lint/build when appropriate to the integration and allowed by repo rules. Record manual UI checks for host styles, keyboard/focus order, actions, and responsive preview. Do not open a browser where repo instructions forbid it.
- [ ] Cloud created/verified status reflects real responses. Deployment is approved separately or explicitly skipped. The owner receives CONTOUR_SETUP_REPORT.md with data exposure, revocation, rollback, and remaining SDK gaps.
