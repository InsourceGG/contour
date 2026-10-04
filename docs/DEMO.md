# Contour demo run-through

Two short stories:
1. **The business:** Northwind adds Contour to its support desk with one agent session.
2. **The user:** Riley's own AI agent tailors that desk to how Riley works, within Northwind's rules.

Both take about three minutes.

## Where everything is

| What | Live URL | Local | Code |
|---|---|---|---|
| **Contour Cloud** (landing page, consumer accounts, project linking, one MCP for every project, site-owner console) | https://contour-sdk.vercel.app | `pnpm -F cloud dev` (port 3100) | `apps/cloud` |
| **Northwind Support** (demo company #2, integrated by the setup skill) | https://northwind-support-app.vercel.app | `pnpm -F northwind dev` (port 3200) | `apps/northwind` (pristine version: git tag `northwind-baseline`) |
| **Acme Operations** (demo company #1, the reference integration) | https://contour-acme.vercel.app | `pnpm -F ops-demo dev` (port 3000) | `apps/ops-demo` |
| **The SDK** | n/a | n/a | `packages/contour-sdk` |
| **The setup skill** | n/a | n/a | `skills/contour-setup` |
| **Demo scripts** | n/a | `pnpm demo:northwind:{fresh,reset,restore,recorded,status}` | `scripts/demo/northwind.sh` |
| Evidence | n/a | n/a | `docs/EVIDENCE.md`, `docs/evidence/` |

### Logins (synthetic demo data)

| App | User | Password | Role |
|---|---|---|---|
| Northwind | `riley@northwind.demo` | `northwind-demo-2026` | New support agent, Tier 1 |
| Northwind | `casey@northwind.demo` | `northwind-demo-2026` | Senior agent, Tier 2 |
| Northwind | `dana@northwind.demo` | `northwind-demo-2026` | Admin and site owner |
| Acme | `alex@contour.demo`, `sam@contour.demo` | `contour-demo-2026` | Members |
| Acme | `morgan@contour.demo` | `contour-demo-2026` | Company operator (console) |
| Contour Cloud | `jordan@contour.demo` | `contour-demo-2026` | Consumer |

## Story 1: the business sets it up (Dana, Northwind's owner)

**Prepare** (once, before presenting):
```bash
pnpm demo:northwind:reset     # clean slate: drops northwind_contour tables, rolls back host SQL, removes the demo workspace
pnpm demo:northwind:fresh     # disposable workspace at ../contour-demo with Northwind at its pristine baseline
```

**Present:**
1. Open the pristine Northwind (`cd ../contour-demo && pnpm -F northwind dev`, then http://localhost:3200, logged in as Riley). It's a normal support desk with no AI features.
2. `cd ../contour-demo/apps/northwind && claude`, then paste Dana's prompt (`fresh` prints it). It starts with "Add Contour to this app".
3. The agent runs the `contour-setup` skill:
   - **Discover:** reads the codebase and finds the six desk components, their variant props, the session-first data functions, and the signed-cookie login.
   - **⏸ Checkpoint 1, surface and locks:** a table proposing the desk. SLA alerts are locked and the ticket queue is required. You answer yes.
   - **⏸ Checkpoint 2, what agents may read:** an exact per-reader field list. Customer email and internal notes are never exposed. You answer yes.
   - **⏸ Checkpoint 3, roles and database:** who may use agents, plus the exact SQL with its rollback file. You answer yes. Then run the three owner commands it prints, or let it run them if you allow `supabase`.
   - **Wire:** the SDK route mount, the readers, the identity mapping, the adaptive desk, the preview page, the "Connect your AI agent" panel in Settings, and the admin kill switch.
   - **Prove:** typecheck, lint, build, the contract kit, and tests.
   - **⏸ Checkpoints 4 and 5:** register with Cloud, and deploy. Answer skip or no for a local demo.
   - It writes `CONTOUR_SETUP_REPORT.md`, covering what agents can see, how to revoke, and how to roll back.
4. Show the result: `/desk` now adapts, Settings has "Connect your AI agent", and Admin has "Allow agent access" and "Disconnect all agents".

**Shortcut** (to skip the live setup): `pnpm demo:northwind:recorded` loads the committed result of a real skill run (tag `northwind-integrated`). The full transcript of that run is in `docs/evidence/skill-run-northwind.jsonl`.

**Reset to run it again:** `pnpm demo:northwind:reset`.

> **Important:** the demo workspace and the deployed Northwind share one database. `reset` removes the Contour tables the deployed app needs. Either finish a fresh live setup (it reinstalls them), or run `pnpm demo:northwind:restore` before showing Story 2 on the deployed URL.

## Story 2: the user tailors it (Riley, a new agent)

**Option A: connect straight to the company**
```bash
claude mcp add --transport http northwind https://northwind-support-app.vercel.app/api/mcp
```
In Claude Code, run `/mcp`, pick **northwind**, then **Authenticate**. Sign in as Riley at Northwind and approve on Northwind's consent screen (describe, read, propose; never save).

**Option B: connect once, reach every company (Contour Cloud)**
```bash
claude mcp add --transport http contour https://contour-sdk.vercel.app/api/mcp
```
Authenticate as `jordan@contour.demo`. Then ask the agent to "connect me to Northwind". It returns a Cloud link. Open it, confirm "Link Support desk (Northwind) to your Contour account", sign in at Northwind as Riley, and approve. Repeat for Acme (sign in as `alex@contour.demo`). `list_projects` now shows both. You can also link from the Cloud web app: https://contour-sdk.vercel.app/projects shows both projects under "Available projects".

**Present:**
1. Open Riley's desk at https://northwind-support-app.vercel.app/desk, next to Claude Code.
2. Ask the agent: *"I'm new at Northwind and I'm triaging tickets right now. Make my desk easier to work with."*
3. The agent calls `describe_surface`, reads the queue and SLA alerts, and calls `propose_view`. **Watch the desk:**
   - A bar appears: "Your agent is preparing a view for Triage queue", with skeletons over the panels that may change.
   - The proposed layout animates in place, with "Changed" markers and inline **Accept** / **Keep current**. SLA alerts don't move, because they're locked by Northwind.
4. Type something in a ticket reply, then click **Accept**. The layout switches, and your draft stays exactly as you typed it.
5. Ask the agent to "check my saved view": `get_view` shows the new revision.
6. **Show the guardrails:**
   - Ask the agent to "hide the SLA alerts". It's rejected, because alerts are locked by policy.
   - Ask it to "save the view yourself". There's no tool for it; only Riley can accept.
   - As Dana, untick **Allow agent access** in Admin. The agent's next call fails with "agent access disabled", while Riley's desk keeps working. Tick it again.
   - Press **Undo** or **Reset to default** on the desk at any time.

## How it works in one paragraph

The company installs `@contour/sdk` and registers which parts of a screen may adapt, using its own components and approved variants, layouts and densities, with locked and required parts it never gives up. It also registers which data each part may expose to agents, through readers that keep its existing permission checks. A user's agent connects over OAuth-protected MCP, either directly or through Contour Cloud. It can describe the screen, read only what the user may already see, and propose a view. The SDK builds three valid candidates from the company's policy, and a small judgment model (TypeSafe Jev) picks the best fit for the user's stated task and expertise. Every result is validated against the company's rules. The user sees the proposal live in the company's own app and is the only one who can accept it. Undo and reset are always available, and the company sees adoption, cost and decisions in its console.

## Troubleshooting

- **"Agent access disabled":** Dana's switch in Northwind Admin, or Morgan's in the Acme console, is off.
- **`PAYMENT_REQUIRED` on Acme:** Acme meters proposals. Buy a test credit at `/billing` with card 4242 4242 4242 4242. Northwind is unmetered.
- **Re-run the business story:** `pnpm demo:northwind:reset`, then `pnpm demo:northwind:fresh`.
- **Deployed Northwind says agent features are unavailable after a reset:** run `pnpm demo:northwind:restore`.
- **A proposal is already waiting on the desk:** proposals expire after 15 minutes, or click "Keep current".
- **Verify both stories end to end on production:** `cd apps/northwind && NORTHWIND_E2E=1 NORTHWIND_E2E_URL=https://northwind-support-app.vercel.app pnpm exec playwright test tests/e2e/agent-flow.spec.ts`, and `cd apps/cloud && ../ops-demo/node_modules/.bin/tsx scripts/prod-check-cloud.mts`.
