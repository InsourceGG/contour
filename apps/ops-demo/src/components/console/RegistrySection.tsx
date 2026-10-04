import type { SurfaceManifest } from "@contour/sdk/core";
import { componentLabels } from "@/host/components";

/** What the company registered: components, variants, guardrails, readers and templates. */
export function RegistrySection({ manifest, manifestHash }: { manifest: SurfaceManifest; manifestHash: string }) {
  return (
    <div className="space-y-5">
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="text-ink-3">Surface</dt>
          <dd className="font-semibold">
            {manifest.label} ({manifest.appId}/{manifest.surfaceId})
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Manifest version</dt>
          <dd className="font-semibold">{manifest.manifestVersion}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Policy version</dt>
          <dd className="font-semibold">{manifest.policyVersion}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-ink-3">Manifest hash</dt>
          <dd className="font-semibold break-all" title={manifestHash}>
            {manifestHash.slice(0, 16)}…
          </dd>
        </div>
      </dl>

      <div className="panel table-scroll">
        <table className="data-table">
          <caption className="px-3 pt-3">Registered components</caption>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Role</th>
              <th scope="col">Approved variants</th>
              <th scope="col">Guardrails</th>
              <th scope="col">Allowed regions</th>
              <th scope="col">Data reader</th>
            </tr>
          </thead>
          <tbody>
            {manifest.components.map((c) => (
              <tr key={c.id}>
                <th scope="row" className="font-semibold">
                  {componentLabels[c.id] ?? c.id}
                  <span className="meta block font-normal">{c.id}</span>
                </th>
                <td>{c.semanticRole}</td>
                <td>{c.variants.join(", ")}</td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    {c.locked && <span className="badge badge-ink">Locked</span>}
                    {c.required && <span className="badge badge-warning">Required</span>}
                    {!c.locked && !c.required && <span className="text-ink-3">Adaptable</span>}
                  </span>
                </td>
                <td>{c.allowedRegions.join(", ")}</td>
                <td>
                  {c.readerId ? (
                    <>
                      {c.readerId}
                      <span className="meta block">needs {c.requiredScope ?? "no scope"}</span>
                    </>
                  ) : (
                    <span className="text-ink-3">Static content</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel table-scroll">
        <table className="data-table">
          <caption className="px-3 pt-3">Approved layout templates (columns per breakpoint)</caption>
          <thead>
            <tr>
              <th scope="col">Template</th>
              {manifest.templates[0]?.breakpoints.map((b) => (
                <th key={b.id} scope="col">
                  {b.id} (from {b.minWidth}px)
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {manifest.templates.map((t) => (
              <tr key={t.id}>
                <th scope="row" className="font-semibold">
                  {t.label}
                  <span className="meta block font-normal">{t.description}</span>
                </th>
                {t.breakpoints.map((b) => (
                  <td key={b.id} className="text-sm">
                    {b.columns} col: {b.regionOrder.map((r) => `${r} ${b.regionSpan[r] ?? "?"}`).join(", ")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {manifest.dependencies.length > 0 && (
        <div>
          <h3 className="font-semibold">Dependency rules</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-2">
            {manifest.dependencies.map((d, i) => (
              <li key={i}>
                {d.componentId}
                {d.whenVariants ? ` (${d.whenVariants.join(", ")})` : ""} requires {d.requiresVisible} to be visible. {d.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
