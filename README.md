# Contour

**Contour lets agents tailor your interface to each user, within your rules.**

A company installs the Contour SDK and registers which parts of a screen may adapt: its own components, approved variants, layout templates and density. It locks what must never change and decides exactly which data agents may read. A user's own AI agent (for example Claude Code) connects over OAuth-protected MCP, either directly to the company or once through Contour Cloud for every company app. The agent proposes a view built only from the company's approved pieces. The dashboard shows the proposal live, and only the user can accept it.

> Personalization changes presentation only. Authentication, authorization, data, business actions and security controls stay company-owned. Agents and Contour Cloud can never save a view.

**Start here:**
- `docs/DEMO.md`: the business and user run-through, where everything is, and logins.
- `docs/EVIDENCE.md`: test and production evidence.

## Live

| App | URL |
|---|---|
| Contour Cloud: landing page, consumer accounts, project linking, one MCP for all projects, site-owner console | https://contour-sdk.vercel.app |
| Northwind Support: demo company, integrated by the setup skill, unmetered | https://northwind-support-app.vercel.app |
| Acme Operations: demo company, the reference integration, Stripe test credits | https://contour-acme.vercel.app |

## Repository

```
packages/contour-sdk      SDK: contract types, validation, candidates, broker, JEV selector, React renderer
                          (AdaptiveSurface, ViewPreview, LiveSurface, ConnectAgentPanel), OAuth 2.1 AS + MCP server,
                          Supabase store, schema template + contour-migrate CLI, contract test kit
apps/cloud                Contour Cloud (Next.js)
apps/northwind            Northwind Support (Next.js, own cookie auth). Pristine version: git tag northwind-baseline
apps/ops-demo             Acme Operations (Next.js, Supabase Auth, Stripe)
apps/northwind-eval       headless harness that runs the setup skill on the baseline
skills/contour-setup      the enterprise setup skill (8 phases, 5 owner checkpoints)
scripts/demo/northwind.sh demo loop: fresh / reset / restore / recorded / status
docs/                     build spec, design spec, plan, DEMO, EVIDENCE
```

Stack: Next.js 16, React 19, TypeScript, Tailwind 4, pnpm workspaces; Supabase (Postgres, RLS, Auth for Acme and Cloud); Vercel; Stripe test mode; TypeSafe Jev via the Vercel AI Gateway; Claude Code as the MCP client.

## Run locally

```bash
pnpm install
pnpm -F ops-demo dev      # http://localhost:3000 (needs apps/ops-demo/.env.local)
pnpm -F cloud dev         # http://localhost:3100 (apps/cloud/.env.local; CLOUD_CLIENT_MODE=dcr and CLOUD_ALLOW_LOCAL_PROJECTS=1 for local projects)
pnpm -F northwind dev     # http://localhost:3200 (apps/northwind/.env.local)
```

Each app has a `.env.example`. Secrets live only in `.env.local` files and Vercel env.

## Tests

```bash
pnpm -F @contour/sdk exec vitest run                 # SDK unit + contract kit
pnpm -F ops-demo exec vitest run tests/integration   # real Supabase: broker, RLS, approval, races, billing, live jobs, schema-scoped stores
pnpm -F cloud exec vitest run                        # Cloud: vault, link state, forwarding, tools, routes
pnpm -F northwind exec vitest run                    # Northwind: auth, team scoping, Contour integration
node --test skills/contour-setup/scripts/*.test.mjs  # skill discovery + verify
```

Production checks are listed at the end of `docs/DEMO.md`.
