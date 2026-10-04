# Contour discovery: Northwind Support

Produced by `node .claude/skills/contour-setup/scripts/discover.mjs .` plus a source read. No secrets are copied here.

## App root and framework

| Item | Finding |
| --- | --- |
| App root | `apps/northwind` (pnpm workspace member of `contour-demo`) |
| Framework | Next.js 16.3.8, App Router, `src/app` |
| React | 19.2.8 |
| Language | TypeScript, strict, `@/*` maps to `src/*` |
| Styling | Plain CSS (`src/app/globals.css`, `src/components/desk/desk.css`), Tailwind 4 PostCSS present |
| Package manager | pnpm (workspace), scripts: `dev` (port 3200), `build`, `lint`, `test` (vitest), `typecheck` |
| Path mapping | Skill paths `src/app` and `src/contour` used as-is |

## Authentication

| Item | Finding |
| --- | --- |
| Session | `src/lib/session.ts` `getSession()` verifies the HMAC-SHA256 signed `nw_session` cookie (`src/lib/auth.ts` `verifySession`), then reloads the user's current `role` and `team` from `northwind.users` |
| Session shape | `Session { userId, email, name, role: "agent" \| "lead" \| "admin", team }` |
| Session ID | None in the payload. A SHA-256 of the verified cookie is a stable per-sign-in identifier |
| Role version | None. `northwind.users` has no version column |
| Suspension | None. Deleting the user row is the only way to remove access |
| Page guard | `requireSession()` redirects to `/login` |
| Route guard | `src/app/api/_shared.ts` `isSameOrigin()` (Origin and `sec-fetch-site`) on every mutation |
| Login | `/login`, `POST /api/auth/login`; logout `POST /api/auth/logout` |
| Database client | `src/lib/db.ts` `getDb()` returns a service-role client already scoped with `.schema("northwind")` |

## Candidate route

`/desk` (`src/app/(workspace)/desk/page.tsx`) is the only candidate. It renders, in DOM order:

1. `SlaAlerts` (full width, above the layout)
2. `.desk-primary`: toolbar (URL filter tabs `all/open/pending`, density form) then `TicketQueue`
3. `.desk-bottom`: `KnowledgeBase` (+ guided/collapsed link) and `CustomerTimeline`
4. `aside.desk-secondary` "Service insights": `CsatTrend` and `WorkloadPanel`

URL query state: `filter`, `density`, `view`, `range`, `kb`, `limit`, `saved`, `error`.

## Component and variant map

| Component | File | Data prop | Closed presentation props | Other props |
| --- | --- | --- | --- | --- |
| SlaAlerts | `src/components/desk/SlaAlerts.tsx` | `breaches: SlaBreach[]` | `variant: banner \| expanded` | loading, error, className |
| TicketQueue | `src/components/desk/TicketQueue.tsx` (client) | `tickets: Ticket[]` | `variant: list \| cards`, `density: comfortable \| compact` | `currentUserId`, `now`; Assign to me and Reply actions; local reply draft state |
| CsatTrend | `src/components/desk/CsatTrend.tsx` | `data: CsatPoint[]` | `presentation: chart \| summary`, `range: 7d \| 30d` | `periodHrefs` |
| WorkloadPanel | `src/components/desk/WorkloadPanel.tsx` | `data: Workload[]` | `density: comfortable \| compact` | |
| KnowledgeBase | `src/components/desk/KnowledgeBase.tsx` | `articles: KbArticle[]` | `mode: guided \| collapsed` | |
| CustomerTimeline | `src/components/desk/CustomerTimeline.tsx` | `events: CustomerEvent[]` | `density: comfortable \| compact` | `now` |

Every component already has loading, error, and empty states through `PanelState`.

## Data functions and field types

All take the verified `Session` first and scope through `scopedQuery` (`src/data/shared.ts`): agents and leads see `team = session.team`, admins see all teams.

| Function | Returns | Fields |
| --- | --- | --- |
| `getTickets(session, { filter, limit })` | `Ticket[]` | id, number, subject, description, status, priority, team, customerId, customerName, customerCompany, assigneeId, assigneeName, createdAt, updatedAt, dueAt, channel |
| `getSlaBreaches(session)` | `SlaBreach[]` | ticketId, ticketNumber, subject, customerName, team, dueAt, minutesOverdue |
| `getCsatTrend(session, { range })` | `CsatPoint[]` | date, score, responses |
| `getWorkload(session)` | `Workload[]` | userId, name, team, open, pending, capacity |
| `getKbArticles(session, { topic })` | `KbArticle[]` | id, title, summary, body, topic, team, readMinutes, updatedAt |
| `getCustomerTimeline(session, { limit, customerId })` | `CustomerEvent[]` | id, customerId, customerName, customerCompany, ticketId, ticketNumber, team, kind (`reply \| opened \| resolved \| note`), description, createdAt |
| `getCustomers`, `getCustomer` | `Customer[]` | includes customer `email` (not used on `/desk`) |

Mutations (never called by readers): `assignTicket`, `replyToTicket`, `saveUserSettings`.

## Permission rules

- Every data function calls `assertSession` and `scopedQuery`; ticket mutations repeat the team scope in the UPDATE.
- `/admin` renders only for `role === "admin"`.
- `northwind` schema: RLS on, service_role only.

## Fixed chrome (stays outside the adaptive region)

- `WorkspaceNav` (`src/components/workspace-nav.tsx`): main navigation, account menu, Admin link
- Workspace footer (`src/app/(workspace)/layout.tsx`)
- `/admin`, `/settings`, `/customers`, `/reports` pages
- Billing: Northwind has no billing page or component

## Unresolved SDK requirements

1. The broker emits `previewUrl` as `${appUrl}/preview/:id`, not `/contour/preview/:id`. A same-origin compatibility redirect is needed.
2. `proposeView` reserves a prepaid adaptation credit from `<schema>.credits`. Northwind has no billing flow, so proposals return `PAYMENT_REQUIRED` (with a `/billing` URL that Northwind does not have) until credits are granted.
3. The SDK host route table has a per-grant revoke (`POST /api/host/agents/[grantId]/revoke`) but no revoke-all route; the host must expose `revokeAllGrantsForApp` itself.
4. `ViewPreview` and `ComponentBoundary` use Tailwind utility class names and `hc`/`btn` classes from the ops demo; Northwind needs host CSS for these.
5. No Cloud registration client or device flow exists in the SDK.
6. `northwind.users` needs a `role_version` counter for `Membership.roleVersion`.
