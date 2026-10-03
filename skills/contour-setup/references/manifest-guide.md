# Derive a manifest from the host

Inventory JSX imports and read the component definitions. Use stable IDs, separate from React export names. Do not put React functions, credentials, or reader implementations in serializable metadata.

## Props to approved presentation choices

| Northwind component | Manifest ID | `variants` from existing prop | Closed settings |
| --- | --- | --- | --- |
| SlaAlerts | sla-alerts | variant: banner, expanded | none; locked banner default |
| TicketQueue | ticket-queue | variant: list, cards | density: comfortable, compact; filter: all, open, pending, resolved, mine; limit: 10, 20, 40 |
| CsatTrend | csat-trend | presentation: chart, summary | range: 7d, 30d |
| WorkloadPanel | workload | density: comfortable, compact | none |
| KnowledgeBase | knowledge-base | mode: guided, collapsed | topic: discovered finite topics, only if needed |
| CustomerTimeline | customer-timeline | density: comfortable, compact | limit: 5, 10, 20 |

`variantId` is one closed choice per component. If multiple props govern presentation, choose one as the variant and encode the others as closed enum settings. Build adapters that map those values to real props. Data, session IDs, hrefs, callbacks, and arbitrary `className` are never agent-controlled settings. Global density may supply density props when the component has no independent override. Document the choice rather than creating ambiguous combinations.

For `ComponentSpec`, every `variantDescriptions` key must match a variant exactly. Settings use `{ type: "object", additionalProperties: false, properties, required }`; prefer `{ enum: [...] }` for each setting. Every required key needs a valid default. Use only the SDK's supported `SettingSchema` forms, not arbitrary JSON Schema constructs.

Example entry, inside `manifest.components` after checkpoint 1:

```ts
import type { ComponentSpec } from "@contour/sdk/core";

export const queueSpec: ComponentSpec = {
  id: "ticket-queue",
  semanticRole: "ticket_queue",
  description: "Visible team tickets with Assign to me and Reply actions.",
  variants: ["list", "cards"],
  variantDescriptions: {
    list: "Rows using the host's existing queue.",
    cards: "Cards using the host's existing queue.",
  },
  settingsSchema: {
    type: "object", additionalProperties: false,
    properties: { density: { enum: ["comfortable", "compact"] } },
    required: ["density"],
  },
  defaultSettings: { density: "comfortable" },
  readerId: "tickets.list", requiredScope: "data:read",
  locked: false, required: true, allowedRegions: ["main", "secondary"],
};
```

Required means always visible. Locked means default region, order, visibility, and variant remain fixed. Mark SLA alerts both locked and required, assign them to `fixed` order 0 in every template, and never move the queue's required actions outside its renderer.

## Regions, templates, and breakpoints

Use regions such as `fixed`, `main`, `rail`, `secondary`, with labels drawn from the host. Define three useful task layouts, for example `standard`, `focus-triage`, `focus-quality`. Each `LayoutTemplate` has `id`, `label`, `description`, `regions`, and **all three** `breakpoints`: `narrow`, `medium`, `wide`. These are not three templates each supporting one breakpoint.

Each breakpoint supplies `minWidth`, `columns`, `regionOrder`, `regionSpan`, `regionCapacity`. Use the host's existing thresholds, typically 0/768/1200. Every region occurs exactly once in reading/focus order. Spans are integers in 1..columns. Capacity must fit required components at every breakpoint, including locked components in their default region. Preserve semantic DOM order and the host's mobile behavior.

Build `defaultConfig: ViewConfig` with schemaVersion `"1"`, matching manifestVersion, a known templateId, a known densityToken, and one placement per registered component, including hidden ones. Placements contain `componentId`, `regionId`, zero-based `order`, known `variantId`, `visible`, and validated `settings`.

Use `tokenIds: ["density.comfortable", "density.compact"]` mapped to existing host spacing. Other tokens must match `^[a-z]+\.[a-z0-9-]+$`; never accept arbitrary CSS from agents.

## Tasks, expertise, and dependencies

Tasks are explicit intent (`triage_queue`, `review_quality`), with `id`, `label`, `description`. Expertise levels (`new`, `experienced`) describe help/detail preference and never confer data access. Do not derive expertise from role.

`DependencyRule` contains `componentId`, optional `whenVariants`, `requiresVisible`, and `reason`. Add a dependency only for an actual functional need. For example, if a host timeline mode needs queue context, require the queue visible. Do not invent dependencies to force aesthetics.

`CandidatePolicy` has `taskLayouts`, levels keyed **guided/balanced/dense**, `helpComponentId`, `helpShowVariant`, and `densityTokens`. Task layouts set templateId, placements, optional settings/helpTopic. Levels set label, summary, defaultDensity, variants, optional settings, and helpVariant. Northwind's knowledge base can serve as help: use its real guided/collapsed variants. Expertise IDs are not policy level keys. Candidate generation still honors all locks and required components.

## Complete SurfaceManifest and validation

Populate `schemaVersion: "1"`, `appId`, `surfaceId`, `label`, `description`, `manifestVersion`, `policyVersion`, `components`, `tokenIds`, `templates`, `dependencies`, `tasks`, `expertiseLevels`, `defaultConfig`, and `limits` (`maxPlacements`, `maxNoteLength`, `proposalTtlSeconds`, `historyLimit`). Keep limits finite and appropriate to the six-panel screen.

Validate with the actual core functions:

```ts
import { defineAdaptiveApp, validateManifest } from "@contour/sdk/core";
import { manifest } from "./manifest";
import { readers } from "./readers";
import { componentIds } from "./component-ids";

const options = {
  readerIds: new Set(readers.keys()),
  implementedComponentIds: componentIds,
};
const issues = validateManifest(manifest, options);
if (issues.length) throw new Error(JSON.stringify(issues));
export const registry = defineAdaptiveApp([manifest], options);
```

Reject duplicate component/template/surface IDs, unknown readers or renderers, missing required scopes/defaults, unsupported variants/settings/tokens, unknown dependency endpoints, broken default placements, and templates unable to fit required components. Match app/surface IDs to `^[a-z0-9-]{2,40}$` and component IDs to `^[a-z][a-z0-9_-]{0,63}$`. Validate every generated task/level candidate, not only the default. Fix the manifest, never relax validation.
