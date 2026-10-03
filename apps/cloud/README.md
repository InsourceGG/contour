# Contour Cloud

Consumer accounts, a verified project registry, and one MCP connection for linked company projects. Cloud can describe, read and propose. Accepting a proposal always happens in the company's app.

## Local setup

Copy `.env.example` to `.env.local` and supply the shared Supabase project credentials, a CSRF secret and a stable vault key. Use `CLOUD_CLIENT_MODE=dcr` and `CLOUD_ALLOW_LOCAL_PROJECTS=1` only for local development.

```sh
pnpm install
pnpm -F cloud seed
pnpm -F cloud dev
```

The app runs on port 3100. The seed creates `jordan@contour.demo` with the password `contour-demo-2026` if that account does not already exist. Existing company demo accounts also work because Cloud uses the same Supabase Auth project.

Apply `supabase/cloud.sql` to the shared database. Cloud's OAuth authorization-server tables are supplied by the SDK's separate `cloud` schema migration; this app does not create them. Both migrations are required.

## Production

Set these variables on the server:

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public HTTPS origin, without a trailing slash |
| `NEXT_PUBLIC_SUPABASE_URL` | Shared Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase public API key |
| `SUPABASE_SECRET_KEY` | Server-only Supabase admin key |
| `CONTOUR_CSRF_SECRET` | Stable secret for session-bound form tokens |
| `CLOUD_VAULT_KEY` | Base64-encoded 32-byte key for encrypted company tokens |
| `CLOUD_VAULT_KEY_ID` | Required identifier for the vault key, such as `k1` |
| `CLOUD_CLIENT_MODE` | `cimd`, which is also the default |

Leave `CLOUD_ALLOW_LOCAL_PROJECTS` unset in production. Preserve the vault key: changing it without a key migration makes existing project grants unreadable. Add `${APP_URL}/auth/callback` to Supabase's permitted auth redirect URLs and configure email delivery for confirmations and magic links. Production projects fetch Cloud's public client metadata from `${APP_URL}/oauth/client.json`.

## Checks

```sh
pnpm -F cloud exec vitest run
pnpm -F cloud exec tsc --noEmit
pnpm -F cloud lint
pnpm -F cloud build
CLOUD_E2E=1 pnpm -F cloud exec vitest run tests/integration/link-forward.test.ts
```

The gated integration test owns its test consumers, registry project and OAuth grants, starts Acme on port 3000 and Cloud on 3100, and removes its fixtures afterwards. Both ports must be free. It requires the shared database migrations, company demo seed, and Acme's `alex@contour.demo` account with zero available proposal credits. It checks that balance without changing it. Functional flows use Playwright request contexts.

For the requested screenshot capture, prefix the integration command with `CLOUD_SCREENSHOTS=1`. This opt-in uses headless Chromium for the five specified screens at 390, 768 and 1440 pixels, in light and dark themes. Captures and automated accessibility results go to gitignored `.screenshots/`.

## Operational limits

Rate limits and token-refresh single flights run in process memory. Use a shared limiter and coordination store before running multiple instances. A company that is offline may not confirm upstream revocation; unlinking still removes the encrypted grant from Cloud and the UI asks the person to review company access. A verified issuer, MCP resource, token endpoint or revocation endpoint cannot be changed in place; register a new project and obtain fresh consent instead.
