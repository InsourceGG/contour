# Wire the Next.js host

Read installed Next.js docs for route handlers, async params/cookies, rewrites, and transpilePackages. The task-2 API overrides the older spec snippet. `createContourHandlers` returns a route table; do not destructure `{ GET, POST }` directly unless the installed table actually provides those keys.

## Dependencies and server registration

Add `@contour/sdk: workspace:*` to the host package in this monorepo, with its existing React/Next/Supabase/zod peers. Keep Node 22 or newer and install using pnpm. Add `tsx` as a dev dependency if the registration module is TypeScript; verify uses it with the `react-server` condition. Never publish SDK packages.

`server.ts` uses the exact config names below. Here `appDb` is a host-created **unscoped SupabaseClient** using the existing server-only service credential; the SDK selects `schema`. Northwind's `getDb()` already returns a scoped query client, so do not pass it as `db` or scope it again. Create the unscoped client through the existing DB module's conventions.

```ts
import "server-only";
import { defineContourServer } from "@contour/sdk/server";
import { getAppDb } from "./db";
import { identity, agentAccessEnabled } from "./identity";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
export const contour = defineContourServer({
  get appUrl() { return new URL(required("APP_URL")).origin; },
  appId: "northwind", resourceName: "Northwind Support",
  surfaces: ["desk"], get db() { return getAppDb(); }, schema: "northwind",
  get csrfSecret() { return required("CONTOUR_CSRF_SECRET"); },
  identity, agentAccessEnabled,
  get trustedClients() {
    const cloudUrl = process.env.CONTOUR_CLOUD_URL;
    return cloudUrl ? [`${new URL(cloudUrl).origin}/oauth/client.json`] : [];
  },
  consent: {
    productName: "Northwind Support",
    dataCategories: ["Authorized support tickets", "Service metrics", "Knowledge articles"],
  },
});
```

Read config lazily through getters, as `apps/ops-demo/src/server/env.ts` does. Do not evaluate `new URL(process.env...)` or required secrets at import time; validate them when server config is used. In `db.ts`, implement host helper `getAppDb()` to create/cache the unscoped client only when called. Build trustedClients only when a Cloud origin is configured; use an empty array when registration was skipped. Never treat a missing secret as an empty string. `db.ts` is host integration code, not a new SDK API.

In `broker.ts`, call `defineAdaptiveApp([manifest], { readerIds: new Set(readers.keys()), implementedComponentIds: componentIds })`, then `createAdaptiveBroker({ registry, policies: { desk: policy }, readers, store: contour.store, selector, confidenceFloor, appUrl })` from `@contour/sdk/core`. `createJevSelector` from `@contour/sdk/jev` takes getters:

```ts
const selector = createJevSelector({
  apiKey: () => process.env.AI_GATEWAY_API_KEY ?? "",
  model: () => process.env.JEV_MODEL ?? "typesafe-ai/jev",
  timeoutMs: () => Number(process.env.JEV_TIMEOUT_MS ?? 4000),
});
```

Use the owner's existing credentials. Use fixture selectors only in isolated tests, never as a production provider fallback.

Export only `manifest`, `policy`, `readers`, `componentIds` from `index.ts`. Importing it must not call `cookies()`, start the server, instantiate the selector, load client TSX, or require production env. `readers` may import host data functions, but must access env/identity lazily inside `read`. This lets verify load the registration without a Next request. `contour.config.json` points to this module with an app-relative path.

## Catch-all route adapter

Create `src/contour/handlers.ts`. Construct the SDK table with `createContourHandlers(contour, { broker, projectId, wellKnownNonce })`, reading the receipt only if present. Use undefined registration fields when skipped. Map approved rewrites into canonical SDK paths, not arbitrary external URLs.

The following dispatcher uses the route table keys in the extracted SDK. Confirm these keys against the installed `handlers.ts`; the API function signature is fixed, but missing route coverage must be reported.

```ts
import { createContourHandlers } from "@contour/sdk/server";
import { contour } from "./server";
import { broker } from "./broker";

const table = createContourHandlers(contour, { broker }); // add approved receipt when registered
export async function dispatch(
  req: Request,
  ctx: { params: Promise<{ contour: string[] }> },
): Promise<Response> {
  const { contour: segments } = await ctx.params;
  let path = `/${segments.join("/")}`;
  const params: Record<string, string | string[]> = {};
  const prm = "/.well-known/oauth-protected-resource";
  const as = "/.well-known/oauth-authorization-server";
  if (path === prm || path.startsWith(`${prm}/`)) {
    params.path = segments.slice(2); path = prm;
  } else if (path === as || path.startsWith(`${as}/`)) {
    params.path = segments.slice(2); path = as;
  } else {
    const proposal = path.match(/^\/api\/host\/proposals\/([^/]+)\/(apply|reject)$/);
    const grant = path.match(/^\/api\/host\/agents\/([^/]+)\/revoke$/);
    if (proposal) { params.id = proposal[1]; path = `/api/host/proposals/[id]/${proposal[2]}`; }
    if (grant) { params.grantId = grant[1]; path = "/api/host/agents/[grantId]/revoke"; }
  }
  const handler = table[`${req.method} ${path}`];
  if (!handler) return Response.json({ error: "not_found" }, { status: 404 });
  return handler(req, { params: Promise.resolve(params) });
}
```

Create `src/app/api/contour/[...contour]/route.ts`:

```ts
import { dispatch } from "@/contour/handlers";
export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;
export const OPTIONS = dispatch;
```

Keep Node runtime. Host routes remain session, origin, and CSRF protected inside SDK handlers. Do not give MCP clients a path to a host commit handler.

## Rewrites and migration

Merge into the existing Next config, preserving its rewrites and transpilePackages:

```ts
import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@contour/sdk"],
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/contour/.well-known/oauth-protected-resource/:path*" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/contour/.well-known/oauth-authorization-server/:path*" },
      { source: "/.well-known/contour-project.json", destination: "/api/contour/.well-known/contour-project.json" },
      { source: "/api/mcp", destination: "/api/contour/api/mcp" },
      { source: "/api/oauth/:path*", destination: "/api/contour/api/oauth/:path*" },
      { source: "/oauth/authorize/decision", destination: "/api/contour/oauth/authorize/decision" },
      { source: "/api/host/:path*", destination: "/api/contour/api/host/:path*" },
    ];
  },
};
export default config;
```

Add `src/app/oauth/authorize/page.tsx` using the host layout and `contour.oauth.validateAuthorize(raw)` for the validated consent details. Redirect signed-out visitors through `identity.loginUrl`. Use `contour.oauth.csrfTokenFor(user)` and SDK decision POST. Inspect `AuthorizeValidation` in the installed SDK for its exact fields; do not fabricate a React consent export. Show only agent scopes (`view:read`, `data:read`, `view:propose`) and preserve all PKCE/resource/state checks.

Before running `contour-migrate --apply` or any host SQL against a non-local database, checkpoint 3 must show and approve the exact SQL and target schema. Inspect the installed migration SQL without applying it first. General approval of roles or database access is insufficient. After approval, run `pnpm exec contour-migrate --schema northwind --apply` with the existing authorized database configuration. Use the SDK CLI's installed help for connection options. Keep schema isolation, RLS, and least-privilege grants. Apply approved host role-version and switch changes separately through repo migrations. Do not seed real records or drop tables.

## Adaptive region and preview

Create a client boundary `surface.tsx` that imports `AdaptiveSurface`, the serializable manifest, and the host component adapters. Its parent loads the broker snapshot with a verified **host** `VerifiedContext`; sets subject/tenant/app/surface from live identity, `channel: "host"`, `clientId: "host"`, roleVersion as string, and host scopes. Never construct host context from external bearer tokens.

```tsx
import { AdaptiveSurface } from "@contour/sdk/react";
// Inside the host's client boundary, with validated config and scoped host data:
<AdaptiveSurface manifest={manifest} config={snapshot.config}
  data={data} componentMap={componentMap} />
```

`componentMap` entries receive `{ placement, data, density, preview }`. Map `placement.variantId` and settings to existing props. Pass trusted currentUserId/time/navigation data from the host, never from the agent. Respect preview mode by disabling mutation actions. Preserve queue drafts through the SDK `ComponentStateProvider` and the host's existing draft-state conventions; inspect its actual props before use. Do not import server data/identity into client components.

In `src/app/contour/preview/[id]/page.tsx`, await `params`, resolve the company session, get `broker.getPreview(ctx, id)`, load authorized current/proposed host data separately, and render `ViewPreview` from `@contour/sdk/react` with `manifest`, `current`, `proposed`, `changes`, `data`, `proposedData`, `componentMap`. Put those client props in a host preview boundary. Missing or other-user proposals return not found. Show stale/expired/invalid status and omit Accept unless ready.

The host `preview-actions.tsx` posts Accept to `/api/host/proposals/:id/apply` with `{ configHash, idempotencyKey }`, and Keep current to `/api/host/proposals/:id/reject`. Include the SDK's actual CSRF header/token format, same-origin credentials, current identity, and error handling. SDK must produce `/contour/preview/:id` as previewUrl; if it still emits `/preview/:id`, add a same-origin compatibility redirect page or request the SDK fix. Never claim the default changed until apply succeeds.

Use `ConnectAgentPanel` from `@contour/sdk/react` in the existing settings section with `cloudUrl` and `projectId`. Confirm its installed props; if the export is absent, report the exact SDK gap rather than creating a lookalike export. With registration skipped, show a disabled connection state and missing configuration names. Reuse host classes and tokens, including consent/preview styling, without a new framework.

## Live proposals

Poll the authenticated `GET /api/host/live` route from the dashboard and pass its result to `LiveSurface`. In a catch-all installation, use the corresponding mounted route, such as `/api/contour/api/host/live`. The SDK route requires a host session and `view:read`, returns `Cache-Control: no-store`, and limits each user to 150 requests per minute.

```tsx
import { LiveSurface, useContourLive } from "@contour/sdk/react";
import type { PreviewData } from "@contour/sdk/core";

// Inside the host's existing client boundary, with its session CSRF token:
const live = useContourLive({ endpoint: "/api/host/live", intervalMs: 1200 });
const approvalKeys = useRef(new Map<string, string>());

async function decide(preview: PreviewData, action: "apply" | "reject") {
  const id = preview.proposal.id;
  const key = approvalKeys.current.get(id) ?? crypto.randomUUID();
  approvalKeys.current.set(id, key);
  const response = await fetch(`/api/host/proposals/${encodeURIComponent(id)}/${action}`, {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "content-type": "application/json", "x-contour-csrf": csrf },
    body: JSON.stringify(action === "apply"
      ? { configHash: preview.proposal.configHash, idempotencyKey: key } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw result.error; // Keep distinct stale, expired and invalid errors.
  router.refresh(); // Fetch the saved snapshot after a successful decision.
}

<LiveSurface manifest={manifest} config={snapshot.config} data={data}
  componentMap={componentMap} live={live}
  onAccept={(preview) => decide(preview, "apply")}
  onKeep={(preview) => decide(preview, "reject")} />
```

Import `useRef` from React and `useRouter` from `next/navigation` in this client boundary; obtain `csrf` through the host's existing session token provider. Adjust proposal paths to the mount just as for the polling endpoint. Set `comparisonHref` when the host's full comparison page differs from `/preview/:id`.

Working proposals show a polite status and token-based skeletons over adaptable panels. READY proposals render inline with changed-panel badges, Accept, Keep current, and full comparison. When an editable field has focus, the saved layout stays in place until blur or Review. Drafts and filters should use stable component identity and the existing `ComponentStateProvider`. Remove older revision polling so it cannot race this hook. Polling pauses in hidden tabs and backs off on errors; all motion respects reduced-motion preferences. A proposal never saves itself, and agent credentials can never call the host commit route.

## Environment

| Name | Purpose | Exposure |
| --- | --- | --- |
| APP_URL | Host origin, no trailing slash | Server config |
| NEXT_PUBLIC_SUPABASE_URL | Existing database URL | Existing convention |
| SUPABASE_SECRET_KEY | Existing privileged DB client | Server only |
| NW_SESSION_SECRET | Existing Northwind signed sessions | Server only |
| CONTOUR_CSRF_SECRET | Strong independent CSRF secret | Server only |
| CONTOUR_CLOUD_URL | Owner's Cloud origin | Approved origin may be passed to panel |
| CONTOUR_PROJECT_TOKEN | Optional owner registration authorization | Server/script only, never panel |
| AI_GATEWAY_API_KEY | Selector credential | Server only |
| JEV_MODEL, JEV_TIMEOUT_MS | Selector model and timeout; lazy defaults above | Server only |

Keep actual values in ignored env files or the established environment manager. Never add `NEXT_PUBLIC_` to secrets. No token values in reports or logs. For later Vercel deployment, upgrade the outdated CLI with `npm i -g vercel@latest` or `pnpm add -g vercel@latest` before using its current deployment features.
