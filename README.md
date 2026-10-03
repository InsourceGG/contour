# Contour

**Controlled UI customization for companies, driven by users and their personal agents.**

A company registers parts of its UI (components, approved variants, tokens, templates, permission-checked readers). A user, or the user's own AI agent connected over authenticated MCP, asks for a view that fits their task and expertise. Contour generates valid candidates from company code, and a bounded JEV judgment picks one. The user previews it and accepts it in the host app. The company keeps control of design, usability, data, and permissions, and gets an operator console to monitor, analyze, and switch agent access off.

> Personalization changes presentation only. Authentication, authorization, business logic, data fetching, required actions, and security controls stay company-owned. The model selects among code-generated candidates. It can't introduce JavaScript, JSX, CSS, queries, credentials, or new business actions.

## What's in this repo

| Layer | Where | Owns |
|---|---|---|
| SDK core (`@contour/sdk/core`) | `packages/contour-sdk/src/core/` | Manifest and config types, closed schemas, registration validation, deterministic relational validation, candidate generation, diffs, hashing, the broker |
| SDK renderer (`@contour/sdk/react`) | `packages/contour-sdk/src/react/` | `AdaptiveSurface`, `ViewPreview`, component boundaries and per-component state |
| SDK server (`@contour/sdk/server`) | `packages/contour-sdk/src/server/` | `defineContourServer(config)`: OAuth 2.1 AS (DCR, CIMD, PKCE, rotation, revocation, consent decision), MCP endpoint and broker tools, schema-parameterized Supabase store, CSRF and host-route helpers, `createContourHandlers`, `pinnedFetchJson` |
| SDK selector (`@contour/sdk/jev`) | `packages/contour-sdk/src/jev/` | Bounded TypeSafe Jev adapter (env-free) |
| Company integration (reference "ops-demo") | `apps/ops-demo/src/host/` | Manifest (6 components, 3 templates × 3 breakpoints), candidate policy, React component implementations, server readers |
| Host server wiring | `apps/ops-demo/src/server/` | `contour.ts` (the SDK server config), verified identity (`context.ts`), agent switch, MCP tool copy, JEV env wiring, console, Stripe |
| Preference store | `apps/ops-demo/supabase/migrations/` | RLS on every table, transactional RPCs: proposal + credit consumption, approval + compare-and-swap commit, undo/reset, credit grant |
| Host app | `apps/ops-demo/src/app/` | Dashboard, authenticated preview/approval, OAuth consent page, settings (pins, history, decision record, connected agents), billing, operator console; OAuth/MCP route files call into `contour` |

Required stack: **Supabase** (database, host auth, preferences, billing ledger), **Vercel** (frontend, broker, MCP endpoint, Stripe webhook, cron), and **Stripe** (test-mode Checkout for adaptation-job credits). Model selection uses **TypeSafe Jev** through the Vercel AI Gateway (`/v1/evaluate`).

## The loop

```
Personal agent (Claude Code) ──OAuth 2.1 + PKCE──▶ /api/mcp ──▶ broker ──▶ readers / proposal service
   describe_surface · read_component_data · propose_view · get_view        (no commit tool)

propose_view: closed-schema input → verified identity + membership → reserve 1 credit →
  3 candidates from company policy (task × explanation level × explicit density, pins reapplied) →
  full validation → JEV Choice {guided|balanced|dense|KEEP|ASK} → confidence floor →
  READY proposal persisted + credit consumed in one transaction → preview URL

Host browser ──session──▶ /preview/:id ──Accept (CSRF, same origin)──▶ contour_apply_proposal
  (recheck owner, state, expiry, hash, manifest/policy/role, base revision → CAS → history → audit)
```

KEEP and ASK never create an approval. Timeouts, provider errors, malformed output, and low confidence all keep the current view and release the credit.

## Run locally

```bash
pnpm install                    # pnpm workspace: apps/* and packages/*
cp apps/ops-demo/.env.example apps/ops-demo/.env.local   # fill in Supabase, Stripe test, and AI Gateway keys
cd apps/ops-demo
supabase link --project-ref <ref>
for f in supabase/migrations/*.sql; do supabase db query --linked -f "$f"; done
cd ../..
pnpm -F ops-demo seed           # demo tenants, identities, synthetic data
pnpm -F ops-demo dev
```

Demo identities (synthetic, password `contour-demo-2026`): `alex@contour.demo` and `sam@contour.demo` (Acme members), `morgan@contour.demo` (Acme company operator), and `taylor@contour.demo` (Globex, used for cross-tenant tests).

Connect Claude Code as the personal agent:

```bash
claude mcp add --transport http contour https://contour-sdk.vercel.app/api/mcp
# then in Claude Code: /mcp → contour → Authenticate (signs you in to the host app and asks for consent)
```

See `docs/AGENT_GUIDE.md` for tools, scopes, preview semantics, and error codes, and `docs/SETUP_CHECKLIST.md` for company integration.

## Tests

```bash
pnpm -F @contour/sdk exec vitest run                 # contract, validation, candidates, JEV adapter, server config
pnpm -F ops-demo exec vitest run tests/integration   # real Supabase: broker loop, isolation, RLS, approval, races, recovery, injection, billing ledger, live JEV
pnpm -F ops-demo exec vitest run tests/oauth-mcp.test.ts   # OAuth + MCP against a running server (CONTOUR_TEST_URL)
pnpm -F ops-demo exec playwright test                # browser: preview/accept, state preservation, widths, keyboard
pnpm -F ops-demo exec tsx --conditions react-server scripts/eval-jev.ts 3 [--holdout]   # labeled JEV evaluation
```

Acceptance evidence is recorded in `docs/EVIDENCE.md`.
