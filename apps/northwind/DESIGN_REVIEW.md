# Northwind Support interface review

## Scope and Coverage

Mode: **full, source-only**. Reviewed the login, desk, customers, reports stub, settings, admin directory and permission state, ticket conversation, account menu, sign out, not-found, workspace loading/error, and all six desk components. Stack: Next.js App Router, React, TypeScript, Tailwind v4 with project CSS, self-hosted variable Geist, semantic OKLCH tokens.

This review deliberately excludes browser navigation, screenshots, rendered geometry, and browser accessibility automation, as requested by the user. The intended 390, 768, and 1440 px layouts were assessed through DOM order and CSS rules. Those sizes were **not rendered or visually verified**. Source review is not a WCAG conformance assessment.

All twelve required SKILL.md files were read: better-copy, better-writing, better-layouts, better-layout, better-typography, better-colors, better-ui, better-interface, better-accessibility, designing-dashboard-uis, design-taste-frontend, and high-end-visual-design. Relevant references included accessibility focus/keyboard, semantics, forms, screen readers, hit areas, motion/zoom; layout adaptivity; typography wrapping and accessible details; color contrast; and UI surfaces, animation, and performance.

Northwind reads as a professional support workspace: ink-blue chrome, white work surfaces, restrained Geist hierarchy, and color reserved for actions and ticket urgency. The dashboard skill influenced status chips, aligned SLA numbers, timelines, workload comparisons, and contextual actions. The layout, writing, accessibility, and typography skills influenced progressive disclosure, concise recovery copy, native controls, stable status regions, and full-text disclosure. The taste skills influenced brand distinction and restrained surface craft; their marketing photography, giant typography, cinematic motion, and ornamental container patterns are unsuitable for this expressly dense support product.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Layout landmarks/skip link; native navigation, details, labels, checkboxes and forms; queue focus reveal, composer focus restoration, Escape and modifier-Enter; SVG description/data table; shared state semantics; forced-color/reduced-motion CSS | Confirmed source issues corrected; keyboard/screen-reader execution not verified |
| Layout | `globals.css`, `desk.css`, all page/component DOM; structural breakpoints at 70rem, 60rem, 48rem, 40rem, and 25rem; min-width constraints, mobile stacking and table-local overflow | Confirmed source issues corrected; 390/768/1440 rendering not verified |
| Writing | All static page/component strings, recovery states, action results and SQL reply-event description | Confirmed source issues corrected; direct practical register retained |
| Typography | WOFF2 local font loading; intended weights; heading scale; unitless line-height; tabular values; disclosure for truncated subjects; bounded reading measure; 16px mobile input rules | No actionable source findings; actual font rendering/wrapping not verified |
| Colors | Semantic token declarations and source-derived foreground/background pairs, primary-button states, status redundancy, input boundaries and focus token | Confirmed input-boundary issue corrected; rendered/composited contrast not verified |
| UI | Density and presentation variants, contextual row actions, tooltip lifecycle, permission/loading/empty/error/success states; specific short transitions and optional press motion | Confirmed source issues corrected; actual hover/focus/animation behavior not verified |

Variant coverage: SLA `banner`/`expanded`; queue `list`/`cards` and `comfortable`/`compact`; satisfaction `7d`/`30d` and `chart`/`summary`; workload and timeline `comfortable`/`compact`; knowledge base `guided`/`collapsed`. Shared `loading`, `error`, and empty branches were inspected in source. The queue initially reveals ten tickets and has an explicit load-more action; search and assignment filters reset the visible count.

Additional security source inspection covered scrypt parameters/random salt/timing-safe comparison, HMAC session signing/expiry/tamper handling, HttpOnly/SameSite cookies, current database identity recheck, server-only privileged DB access, origin checks, team-scoped readers and assign mutations, admin-only team listing, composite team foreign keys, RLS, and restricted service-role grants. No actionable authorization issue was identified in the inspected paths. This does not replace execution of the authentication/authorization tests.

## Findings

No actionable interface findings remain in the final inspected source. The following confirmed findings were corrected during implementation and reread; they are recorded as review evidence rather than outstanding work.

| # | Severity before correction | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | HIGH | Accessibility | `src/components/desk/TicketQueue.tsx:83` | Reply textarea remained editable while the submitted snapshot was saving; success reset the form | `disabled={pending === "reply"}` | Prevents unsaved edits made during an in-flight save from being cleared by the success reset |
| 2 | MEDIUM | Colors | `src/app/globals.css:12`, `src/app/globals.css:94`, `src/components/desk/desk.css:65`, `src/components/desk/desk.css:102` | White input surfaces had light boundaries computing approximately 2.07:1 or 2.19:1 against white | Shared `--input-line: oklch(0.65 0.02 258)`, computing 3.23:1 against white | The boundary is the visual signal identifying fields on white panels; source token contrast now exceeds the 3:1 non-text threshold |
| 3 | MEDIUM | Layout | `src/app/(workspace)/desk/page.tsx:32`, `src/components/desk/CsatTrend.tsx:8`, `src/components/desk/CsatTrend.tsx:30` | Two satisfaction-period selectors; component links reset existing queue presentation/filter choices | One selector with `periodHrefs` generated from the current desk parameters | Removes duplicated decisions and preserves context when changing the period |
| 4 | MEDIUM | Accessibility | `src/components/desk/desk.css:60`, `src/components/desk/desk.css:71` | Queue anchor used 24px clearance beneath sticky chrome | Queue and row anchors use 140px scroll clearance | Gives anchor navigation enough source-declared clearance for the responsive header |
| 5 | MEDIUM | Accessibility | `src/components/desk/desk.css:96`, `src/components/desk/desk.css:97`, `src/components/desk/TicketQueue.tsx:20` | Supplemental tooltips had `pointer-events: none` | Hover/focus content accepts pointer events, has a gap bridge, and dismisses on Escape | Makes supplemental hover content hoverable and dismissible; rendered behavior remains a manual check |
| 6 | LOW | Writing | `src/components/desk/KnowledgeBase.tsx:13`, `supabase/northwind_base.sql:112` | Empty KB suggested selecting an unavailable topic control; reply event claimed delivery | Empty KB explains when team articles appear; event says a reply was added to the conversation | Recovery text matches available controls and persisted-reply wording matches the implemented action |

## Considered but Rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| `src/app/globals.css:50`, `src/components/workspace-nav.tsx:11` | Replace sticky full-width application chrome with a floating pill | Fixed chrome is an explicit requirement; the dense-product layout guidance allows deliberate application chrome |
| `src/components/desk/WorkloadPanel.tsx:20`, `src/components/desk/CsatTrend.tsx:36` | Remove workload tracks or hand-authored SVG as decorative patterns | They represent actual scoped numeric data; the brief explicitly requests workload bars and an SVG CSAT chart, with textual equivalents provided |
| `src/app/globals.css:6`, `src/components/desk/desk.css:27` | Add dark appearance, photography, atmospheric motion and larger containers | The product is a dense professional desk; design-taste explicitly excludes dashboards. These additions are not requirements and would add complexity without improving the principal task |
| `src/components/desk/desk.css:69`, `src/components/desk/TicketQueue.tsx:71` | Report truncated ticket subjects as inaccessible | Native disclosure and an actual conversation link expose the complete subject and context; narrow CSS also permits wrapping |
| `src/components/desk/desk.css:20`, `src/app/globals.css:117` | Treat all compact controls and small metadata as automatic AA failures | Native controls, explicit hit areas, wrapping checkbox labels, and the table exception require contextual assessment; no rendered target-size or clipping failure was demonstrated |

## Verification

**Completed in this review:**

- Read all listed page/component/data/auth source and the schema. Used `nl -ba`, `cat`, and `rg` for source-backed locations and corrected-code rereads.
- Used Python OKLCH-to-linear-sRGB conversion and WCAG luminance calculation against declared solid tokens. Ratios: ink/white **15.77:1**, muted/white **6.67:1**, muted/canvas **6.25:1**, brand/white **8.47:1**, brand/brand-soft **7.58:1**, danger/danger-soft **7.56:1**, warning/warning-soft **6.78:1**, success/success-soft **8.16:1**, focus/white **5.43:1**, corrected input boundary/white **3.23:1**. These are source token calculations, not rendered-pair measurements.
- Ran `rg -n -- '—|–|eyebrow|kicker|SUPABASE_SECRET_KEY' src`: only the server-side service-key access was returned, with no forbidden visible dash or eyebrow pattern detected.
- Ran `rg -n 'contour|Contour|@contour|sdk' src package.json`: no matches. The baseline source/dependencies contain no integration code.

Additional implementation verification: `node scripts/check-a11y.mjs` checked 13 curl HTML snapshots with axe-core/jsdom, including three role-specific desks, compact cards, settings, admin/permission state, login, customers, reports, and a ticket conversation. All 13 had zero violations. CSS contrast was excluded; no browser was opened.

**Not verified in this review:**

- Screenshots and rendered layouts at **390, 768, 1440 px**; 200% text resize, 320px reflow, actual font loading, color gamut/browser compositing, and full focus-perimeter contrast. These remain manual checks.
- Browser keyboard traversal, screen-reader announcements, pointer transfer over tooltip bridges, hover/focus geometry, reduced-motion execution, and motion inspection. Source provides the relevant paths but is insufficient to prove their runtime behavior.
- Browser axe/Lighthouse checks. Browser automation was omitted because the user will verify manually. Any separate axe-core/jsdom inspection of curl HTML checks DOM semantics only and cannot establish rendered contrast, geometry, or interactive keyboard behavior.
- Unit tests, typecheck, lint, build, database application, seed execution, and curl smoke tests were owned by the primary implementation task and are summarized in its task report; this review does not duplicate or independently claim those results.

## Verdict

Approval is limited to the explicitly inspected **source-only** scope. No browser-rendered quality, visual breakpoint verification, or complete accessibility conformance is claimed; the manual checks above remain unverified.

**Approve**
