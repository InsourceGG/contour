"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { overviewManifest } from "@/host/manifest";
import { componentLabels } from "@/host/components";
import type { DensityPreference, HelpPreference, ManualPin, UserPreferences } from "@/sdk/types";
import { apiPut, type ApiError } from "@/components/api";
import { useCsrf } from "@/components/csrf";
import { useToast } from "@/components/toast";
import { IconPin } from "@/components/icons";
import { HELP_LABEL, regionLabel } from "@/components/dashboard/labels";

export function PreferencesForm({ prefs }: { prefs: UserPreferences }) {
  const csrf = useCsrf();
  const router = useRouter();
  const { notify } = useToast();
  const id = useId();
  const [expertise, setExpertise] = useState(prefs.expertise ?? "");
  const [density, setDensity] = useState<DensityPreference | "">(prefs.density ?? "");
  const [help, setHelp] = useState<HelpPreference | "">(prefs.help ?? "");
  const [pins, setPins] = useState<ManualPin[]>(prefs.pins);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const dirty =
    expertise !== (prefs.expertise ?? "") ||
    density !== (prefs.density ?? "") ||
    help !== (prefs.help ?? "") ||
    JSON.stringify(pins) !== JSON.stringify(prefs.pins);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: UserPreferences = {
      ...(expertise ? { expertise } : {}),
      ...(density ? { density } : {}),
      ...(help ? { help } : {}),
      pins,
    };
    const res = await apiPut("/api/host/preferences", body, csrf);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    notify("Preferences saved.");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="panel mt-3 space-y-6 p-4 md:p-6">
      <div className="grid gap-5 md:grid-cols-3">
        <div>
          <label htmlFor={`${id}-exp`} className="field-label">
            Expertise
          </label>
          <select id={`${id}-exp`} className="select" value={expertise} onChange={(e) => setExpertise(e.target.value)}>
            <option value="">Ask each time</option>
            {overviewManifest.expertiseLevels.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-den`} className="field-label">
            Density
          </label>
          <select id={`${id}-den`} className="select" value={density} onChange={(e) => setDensity(e.target.value as DensityPreference | "")}>
            <option value="">No preference</option>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-help`} className="field-label">
            Help
          </label>
          <select id={`${id}-help`} className="select" value={help} onChange={(e) => setHelp(e.target.value as HelpPreference | "")}>
            <option value="">No preference</option>
            {(["auto", "show", "hide"] as const).map((h) => (
              <option key={h} value={h}>
                {HELP_LABEL[h]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className="field-label">Pinned panels</legend>
        {pins.length === 0 ? (
          <p className="text-sm text-ink-2">No pins. Use Pin on any dashboard panel to keep it where it is when new views are proposed.</p>
        ) : (
          <ul className="divide-y divide-rule rounded-xl border border-rule bg-white">
            {pins.map((p) => {
              const label = componentLabels[p.componentId] ?? p.componentId;
              const spec = overviewManifest.components.find((c) => c.id === p.componentId);
              return (
                <li key={p.componentId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <span className="flex items-start gap-2 text-sm">
                    <IconPin size={14} className="mt-1 text-accent" />
                    <span>
                      <strong>{label}</strong>
                      <span className="text-ink-2">
                        {p.regionId ? ` in ${regionLabel(p.regionId).toLowerCase()}` : ""}
                        {p.variantId ? `, ${spec?.variantDescriptions[p.variantId]?.toLowerCase() ?? p.variantId}` : ""}
                      </span>
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    onClick={() => setPins(pins.filter((x) => x.componentId !== p.componentId))}
                  >
                    Remove pin<span className="sr-only"> for {label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      {error && (
        <p role="alert" className="notice notice-error">
          Preferences weren&apos;t saved: {error.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save preferences"}
        </button>
        {dirty && <span className="meta">Unsaved changes</span>}
      </div>
    </form>
  );
}
