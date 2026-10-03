# Contour setup report

## Integration

| Item | Value |
| --- | --- |
| App root | `apps/northwind` (pnpm workspace `contour-demo`), branch `demo/northwind-20261003-161806` |
| Framework | Next.js 16.3.8 App Router, React 19.2.8, `src/app` (skill paths used as written) |
| Route and surface | `/desk`, app ID `northwind`, surface ID `desk`, tenant `northwind` (the company) |
| SDK | `@contour/sdk` 0.1.0, `workspace:*` (not published), `transpilePackages: ['@contour/sdk']` |
| Contour schema | `northwind_contour` (server config `schema: "northwind_contour"`); never `public` or `northwind` |
| Manifest/policy versions | `1` / `1` |

### Created files

- `src/contour/`: `manifest.ts`, `component-ids.ts`, `components.tsx`, `readers.ts`, `identity.ts`, `policy.ts`, `server.ts`, `db.ts`, `broker.ts`, `index.ts`, `handlers.ts`, `project.ts`, `surface.tsx`, `surface-data.ts`, `preview-actions.tsx`, `connect-panel.tsx`, `admin-access.ts`, `admin-controls.tsx`, `contour.css`
- `src/app/api/contour/[...contour]/route.ts` (catch-all route mount)
- `src/app/oauth/authorize/page.tsx` (company consent page)
- `src/app/(workspace)/contour/preview/[id]/page.tsx` (URL `/contour/preview/:id`; placed in the `(workspace)` route group to reuse the host layout)
- `src/app/preview/[id]/page.tsx` (compatibility redirect, see SDK gaps)
- `src/app/api/contour-admin/agent-access/route.ts`, `src/app/api/contour-admin/revoke-all/route.ts`
- `contour.config.json` (`{ "contourModule": "src/contour/index.ts" }`), `.env.example`
- `supabase/contour-host.sql`, `supabase/contour-host.down.sql`
- `tests/contour.test.ts`, `CONTOUR_DISCOVERY.md`, this report
- Not created: `src/contour/project.json` (registration skipped)

### Edited files

- `src/app/(workspace)/desk/page.tsx`: the panel region is now `<DeskSurface>`; heading, scope badge, and notices stay host chrome
- `src/app/(workspace)/settings/page.tsx`: the "Integrations" placeholder became "AI agents" (SDK `ConnectAgentPanel` plus connected agents with Disconnect)
- `src/app/(workspace)/admin/page.tsx`: "AI agent access" section (kill switch, Disconnect all agents)
- `src/app/login/page.tsx`, `src/app/api/auth/login/route.ts`, `src/app/api/_shared.ts`: validated `next` return path (same-origin relative paths only; rejects `//`, backslashes, and control characters) so consent resumes after sign-in. Authentication itself is unchanged
- `src/app/globals.css`: imports `src/contour/contour.css` and adds `@source` for the SDK's React components
- `next.config.ts`: `transpilePackages` and Contour rewrites; existing headers kept
- `package.json`, root `pnpm-lock.yaml`: `@contour/sdk: workspace:*`
- `.env.local` (git-ignored): generated `CONTOUR_CSRF_SECRET` added; value never printed

### Reuse, chrome, defaults

- Renderers are the existing `SlaAlerts`, `TicketQueue`, `CsatTrend`, `WorkloadPanel`, `KnowledgeBase`, `CustomerTimeline`, plus the existing queue toolbar (filter tabs, Queue view form) and the knowledge-base mode link. Their loading, empty, and error states, Assign to me and Reply actions, and draft behavior are unchanged. New UI uses existing classes (`settings-section`, `preference`, `button`, `notice`, `field-hint`, `neutral-badge`) and tokens only; no new styling system.
- Fixed chrome outside the region: `WorkspaceNav` (navigation, account menu, Admin link), workspace footer, page heading and notices, and the `/admin`, `/settings`, `/customers`, `/reports` pages. Northwind has no billing UI, and none was added.
- Existing URL controls (`filter`, `density`, `view`, `range`, `kb`) still work and override the saved view for that page load (`withQuery` revalidates the result).
- Default view mirrors the original desk: template `standard`, comfortable. `fixed`: sla-alerts (banner). `main`: ticket-queue (list, filter all), knowledge-base (guided), customer-timeline (comfortable). `rail`: csat-trend (chart, 7d), workload (comfortable). One visible difference: the knowledge base and timeline stack instead of sitting side by side.
- Locks: `sla-alerts` locked and required, `fixed` region order 0, banner, in every template. `ticket-queue` required, movable within `main`, actions inside its renderer. The other four are optional in `main` or `rail`.
- Templates (narrow 0, medium 768, wide 960): `standard` (wide 3 columns, main 2), `focus-triage` (4 columns, main 3), `focus-quality` (2 columns, main 1); stacked below 960. Tasks `triage_queue`, `review_quality`; expertise `new`, `experienced` (presentation only, never access).
- If Contour can't be reached, `/desk` renders the company default with host-scoped data; Settings and Admin show an unavailable message; agent access reads as disabled.

## Owner decisions

| Checkpoint | Proposal | Owner answer/source | Outcome |
| --- | --- | --- | --- |
| 1 Surface and locks | `/desk` (`desk`); SlaAlerts locked and required; TicketQueue required; four optional panels; chrome outside; regions, variants, settings, templates, tasks, levels, limits as listed above | Up front: "Surface: /desk. Lock SlaAlerts and require TicketQueue. Include CsatTrend, WorkloadPanel, KnowledgeBase, and CustomerTimeline as optional panels. Keep navigation, account, admin, and billing outside the adaptive region." At the checkpoint: "Yes. Use this surface, these locked and required components, and the proposed templates, tasks, variants and settings." | Applied |
| 2 Reader fields | Six readers with the exact allowlist below; tickets filter enum, csat default 7d, timeline default 10, no topic or customerId inputs, empty strict inputs, broker bounds 5000 ms / 64000 bytes | Up front: item 2 of the setup message. At the checkpoint: "Yes. Agents may read exactly these fields with these bounds, including the proposed defaults for the unnamed inputs (…)" | Applied |
| 3 Agent access | Roles `agent`, `lead`, `admin`; agents enabled, kill switch available and off; per-connection Disconnect and admin Disconnect all; full contour-migrate SQL for `northwind_contour` (SHA-256 `6767f9fe6a07b4196772fd75b4d5bf848571af3499cc3cb60a34092f28470e03`) and both host SQL files shown in full | "Yes. Roles agent, lead and admin may use agents; agent access starts enabled and the admin kill switch turns it off." "1. Yes, apply the contour-migrate SQL…" "2. Yes, write and apply supabase/contour-host.sql and supabase/contour-host.down.sql exactly as shown, including your read-only pre-check." "3. Yes, approve per-connection Disconnect in Settings and the admin 'Disconnect all agents'." Credits: "do not add any billing UI or grant credits… Leave a clearly marked TODO in src/contour/server.ts" | Applied. The Supabase CLI was denied in the agent session, so the owner ran the pre-check (table present, no northwind/northwind row), the migration ("northwind_contour up to date"), and `contour-host.sql` (role_version column and enabled settings row present). Billing TODO added |
| 4 Register | Northwind Support, surface `desk`, `APP_URL` origin, `CONTOUR_CLOUD_URL` with `CONTOUR_PROJECT_TOKEN` | Up front: register only if both are set. At the checkpoint: "Checkpoint 4: skip. Registration is skipped because CONTOUR_CLOUD_URL and CONTOUR_PROJECT_TOKEN are missing; the Contour team will register later." | Skipped. Registration skipped: CONTOUR_CLOUD_URL or CONTOUR_PROJECT_TOKEN is missing (both are). No Cloud contact, no receipt |
| 5 Deploy | No deployment target; local handoff | Up front: "Deploy: no." At the checkpoint: "Checkpoint 5: no deploy." | Skipped. Nothing deployed, pushed, or published |

## Agent-visible data

Every reader rebuilds the Northwind `Session` with `sessionForContext` from the live `northwind.users` row (never from input) and calls the original data function, so `assertSession` and `scopedQuery` still apply: agents and leads see their own team, admins see all teams. Objects are built field by field. Customer email is never returned by any reader.

| Reader | Function | Exact fields | Bounds | Permission rule | Untrusted text |
| --- | --- | --- | --- | --- | --- |
| `tickets.list` | `getTickets(session, { filter, limit })` | `tickets[id,number,subject,status,priority,dueAt]`, `untrustedContent` | `filter` all/open/pending/resolved/mine (default all); `limit` 10/20/40 (default 20); subject 160 chars | Session team scope; `mine` uses the session user | subject |
| `sla.active` | `getSlaBreaches(session)` | `breaches[ticketId,ticketNumber,subject,dueAt,minutesOverdue]`, `untrustedContent` | empty strict input; 20 rows; subject 160 chars | Session team scope | subject |
| `csat.trend` | `getCsatTrend(session, { range })` | `points[date,score,responses]` | `range` 7d/30d (default 7d); at most 30 points | Session team scope | none |
| `workload.team` | `getWorkload(session)` | `workload[name,open,pending,capacity]` | empty strict input; 50 rows; name 80 chars | Session team scope | none |
| `kb.articles` | `getKbArticles(session, {})` | `articles[id,title,summary,topic,readMinutes]`, `untrustedContent` | empty strict input (no topic); 20 rows; title 160, summary 400, topic 80 chars | Session team scope | title, summary, topic |
| `customers.timeline` | `getCustomerTimeline(session, { limit: 100 })` | `events[id,ticketNumber,kind,description,createdAt]`, `untrustedContent` | `limit` 5/10/20 (default 10); `kind === "note"` rows removed before the cap; description 400 chars; no customerId input | Session team scope | description |

Excluded everywhere: customer email, customer name and company, ticket description, assignee, team, channel, article body, internal notes, user IDs, credentials. Broker bounds: `readerTimeoutMs` 5000, `maxReaderOutputBytes` 64000, 60 reads per minute per user. Host rendering data (`surface-data.ts`) is separate and unchanged; the host timeline still shows internal notes to signed-in staff.

## Identity and revocation

- **Verified session mapping:** `getSession()` (HMAC and expiry check of `nw_session`, then a live users reload). `HostUser.subjectId` = `users.id`; `sessionId` = SHA-256 of the verified cookie; `tenantId` = `northwind`; `role` and `roleVersion` from the live row. Signed out returns null; a signed-in user without a row gets `FORBIDDEN`.
- **Membership:** `getMembership` reads `users.id, role, role_version` on every call; `status` `active` while the row exists (Northwind has no suspension column; deleting the user removes membership); `dataAccess` only for `agent`, `lead`, `admin`.
- **Role version:** `northwind.users.role_version` (default 1), bumped by trigger `northwind.bump_role_version` when `role` or `team` changes; other updates keep it. `sessionForContext` refuses a stale version; open proposals become INVALID at preview and apply.
- **Kill switch:** `northwind_contour.tenant_app_settings` row (`northwind`, `northwind`), currently enabled. Admin › "Allow agent access" (unchecked means the kill switch is on and agents are disabled). `POST /api/contour-admin/agent-access` requires a live session with the `admin` role from the users row, same origin, and the `x-contour-csrf` session-bound token. A missing row, another company or app, or a lookup error all mean disabled.
- **Grant revocation:** Settings › AI agents lists the user's connections with Disconnect (SDK `POST /api/host/agents/:grantId/revoke`, CSRF). Admin › "Disconnect all agents" calls `revokeAllGrantsForApp` (`POST /api/contour-admin/revoke-all`, admin, same origin, CSRF). Both revoke tokens.
- **Next-call enforcement:** each MCP call resolves the token, grant revision, kill switch, and live membership; readers recheck role and version and use the current team.
- **Agent scopes:** `view:read`, `data:read`, `view:propose` only. `view:commit`, Accept, Keep current, undo, and reset are host-only (verified session plus CSRF).
- **Billing:** `src/contour/server.ts` has `TODO(contour-billing)`. Northwind runs Contour without metering per the owner. The SDK has no no-billing option yet, so `propose_view` returns `PAYMENT_REQUIRED` until the Contour team ships it. No billing UI was added and no credits were granted.

## Verification

| Check | Command or manual procedure | Observed result |
| --- | --- | --- |
| Discovery | `node .claude/skills/contour-setup/scripts/discover.mjs .` | Pass; `CONTOUR_DISCOVERY.md` written |
| Typecheck | `pnpm exec tsc --noEmit` (also inside verify.mjs) | Pass |
| Contract kit | `node .claude/skills/contour-setup/scripts/verify.mjs . --base-url http://localhost:3200` | Pass |
| HTTP: resource metadata | same | Pass (200, resource `http://localhost:3200/api/mcp`) |
| HTTP: unauthenticated MCP | same | Pass (401 with `resource_metadata`) |
| HTTP: project document | same | Fail as expected: 404, because registration was skipped and there is no receipt. Not a verified claim |
| Unit tests | `pnpm test` | Pass, 44/44 (23 existing, 21 new in `tests/contour.test.ts`) |
| Authenticated fixture flow (isolated, in-memory store, fixture selector) | `tests/contour.test.ts` | Pass: describe, read, propose READY with preview URL, host preview ready, agent apply denied (also with a forged commit scope), host apply moves revision 0 to 1 with a matching hash, Keep current leaves revision 0, cross-user preview NOT_FOUND, role change invalidates the proposal and blocks the next read, kill switch on gives AGENT_ACCESS_DISABLED and off restores access, non-approved role denied, every reader's exact field set and caps, notes excluded, unknown input keys rejected |
| Lint | `pnpm lint` | Pass: 0 errors, 1 warning in the skill's own `discover.mjs` (not integration code) |
| Build | `pnpm build` | Pass |
| Database apply | Owner ran option B | Pre-check: table present, no northwind/northwind row. `contour-migrate` "up to date". `contour-host.sql` applied (column and enabled row present). Reported by owner; not observed by the agent |
| Signed-in HTTP flow on the real database | curl with a cookie jar | Skipped: the session's permissions blocked authenticated curl calls |
| Real proposal end to end | MCP propose against the linked database | Not run: needs an agent connection and `AI_GATEWAY_API_KEY` (missing). Would return `PAYMENT_REQUIRED` until the SDK's no-billing option exists |

### Owner manual checks

1. Sign in as Dana, Casey, and Riley; open `/desk`. Confirm the layout matches the old desk, the scope badge and team data are unchanged, and Assign to me, Reply (including a typed draft), filter tabs, Queue view spacing, the 7d/30d links, and the article list toggle all work.
2. Check keyboard and focus order (alerts, queue toolbar, queue, articles, timeline, satisfaction, workload) at under 768 px, 768 to 959 px, and 960 px or wider.
3. Settings › AI agents: the connect command shows, and Cloud linking shows the unregistered notice.
4. Admin as Dana: clear "Allow agent access", confirm the row reads disabled and consent shows "Agent access is turned off", then turn it back on. As Riley, `/admin` stays restricted.
5. Optional: connect an MCP client to `http://localhost:3200/api/mcp`, approve consent, call describe and read, then Disconnect in Settings and confirm the next call fails.

## Registration and deployment

- Registration skipped: CONTOUR_CLOUD_URL or CONTOUR_PROJECT_TOKEN is missing (both were missing). No Cloud project ID, no verification, no `project.json`; `/.well-known/contour-project.json` returns 404; `trustedClients` is empty. Settings explains that Cloud linking is unavailable. The Contour team will register later; after registration, `src/contour/project.json` with `{ projectId, nonce }` enables the document automatically (`src/contour/project.ts`).
- Deployment skipped by owner decision. Nothing pushed, published, or deployed; no remote configuration changed.

## Rollback and remaining work

Disable first: Admin › clear "Allow agent access" (kill switch on), then "Disconnect all agents".

Full removal, in order, from `apps/northwind`:

1. `supabase db query --linked -f supabase/contour-host.down.sql --workdir ../ops-demo`
2. `node node_modules/@contour/sdk/bin/contour-migrate.mjs --schema northwind_contour --drop --apply --workdir ../ops-demo`
3. Remove `src/contour/`, `src/app/api/contour/`, `src/app/api/contour-admin/`, `src/app/oauth/`, `src/app/(workspace)/contour/`, `src/app/preview/`, `contour.config.json`, `tests/contour.test.ts`, both `supabase/contour-host*.sql` files, the `transpilePackages` and `rewrites` additions in `next.config.ts`, the two Contour lines at the top of `src/app/globals.css`, and the dependency (`pnpm remove @contour/sdk`). Restore the original region with `git checkout main -- 'src/app/(workspace)/desk/page.tsx' 'src/app/(workspace)/settings/page.tsx' 'src/app/(workspace)/admin/page.tsx'`. Optionally revert the login `next` support (`src/app/login/page.tsx`, `src/app/api/auth/login/route.ts`, `src/app/api/_shared.ts`) and remove `CONTOUR_CSRF_SECRET` from `.env.local`. Host data and auth stay intact.

### SDK gaps

1. **Billing mode:** no no-billing option; `propose_view` requires a prepaid credit and returns `PAYMENT_REQUIRED` with `billingUrl` `/billing`, which Northwind does not have. Fix: SDK billing mode, configured at `TODO(contour-billing)` in `src/contour/server.ts`.
2. **Preview URL:** the broker emits `${appUrl}/preview/:id`; Northwind serves `/contour/preview/:id` via `src/app/preview/[id]/page.tsx`. Fix: SDK `previewPath` option.
3. **Revoke all:** no host route for `revokeAllGrantsForApp`; Northwind added `/api/contour-admin/revoke-all`.
4. **Client CSRF header:** `CSRF_HEADER` is exported only from the server-only entry, so the client files hard-code `x-contour-csrf`.
5. **Styling:** `ViewPreview` and `ComponentBoundary` use ops-demo Tailwind token classes (`text-ink-2`, `bg-surface`, `btn`, `hc`), mapped with host CSS in `src/contour/contour.css`.
6. **Registration:** the SDK has no Cloud registration or device-flow client.
7. **Preferences schema:** `user_preferences.expertise` allows only `beginner`/`expert`, while this manifest uses `new`/`experienced`; Northwind does not store expertise preferences, so it is unaffected today.
8. **Login return path:** `requireSession()` in the workspace layout still redirects to `/login` without `next`, so a signed-out preview link lands on `/desk` after sign-in. Consent preserves its return path.
