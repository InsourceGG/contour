# Northwind Support

A standalone customer-support workspace with its own session authentication, scoped support data, and six desk components.

## Run locally

Use Node.js 22 or later and pnpm. From this directory:

```sh
pnpm install
pnpm dev
```

Open `http://localhost:3200`. Supply these server environment variables in the ignored `.env.local` file:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `NW_SESSION_SECRET` (at least 32 characters)
- `APP_URL=http://localhost:3200`

The service key is used exclusively in server-only modules. Application authentication uses scrypt passwords and an eight-hour HMAC-signed HttpOnly `nw_session` cookie. Current identity, role, and team are rechecked against the database on authenticated requests.

## Demo accounts

All accounts use `northwind-demo-2026`.

| Email | Name | Access |
| --- | --- | --- |
| riley@northwind.demo | Riley Chen | Tier 1 agent |
| casey@northwind.demo | Casey Morgan | Tier 2 lead |
| dana@northwind.demo | Dana Brooks | Administrator, all teams |

## Database

`supabase/northwind_base.sql` creates the application's tables, indexes, RLS restrictions, and atomic reply trigger in the `northwind` schema. Apply it to the already-linked project with `supabase db query --linked -f supabase/northwind_base.sql`. Link metadata is local and ignored.

```sh
pnpm tsx scripts/seed.ts
```

The seed uses stable identifiers and upserts synthetic data: two teams, three users, twelve customers, forty tickets, sixty days of satisfaction summaries for both teams, twelve knowledge articles, and customer events. Reseeding refreshes demo tickets, timestamps, and password hashes while preserving settings records and replies. It does not duplicate seeded records.

Readers in `src/data` take the verified session first and enforce team scope themselves. Agents and leads read their own teams; administrators read all teams. Ticket mutations enforce the same scope. Replies are saved in the customer conversation, update the ticket to pending, and append a customer timeline event in one database transaction. Email delivery is not configured.

## Verification

```sh
pnpm exec vitest run
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

With the development server running:

```sh
bash scripts/smoke.sh
node scripts/check-a11y.mjs
```

The curl smoke script uses ignored cookie jars, verifies team visibility and authorization, exercises ticket mutations and preferences, and signs out. It adds synthetic replies to the demo conversation. The accessibility script checks completed server HTML in jsdom with axe-core. It excludes CSS contrast and does not render pages or replace manual viewport, keyboard, screen-reader, and interaction checks.

See `DESIGN_REVIEW.md` for design decisions, source review, token contrast calculations, and remaining manual checks.
