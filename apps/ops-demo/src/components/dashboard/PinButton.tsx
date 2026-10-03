"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ManualPin, Placement, UserPreferences } from "@/sdk/types";
import { apiPut } from "@/components/api";
import { useCsrf } from "@/components/csrf";
import { useToast } from "@/components/toast";
import { IconPin } from "@/components/icons";
import { regionLabel } from "./labels";

type Props = {
  placement: Placement;
  label: string;
  prefs: UserPreferences;
  pins: ManualPin[];
  onSaved: (pins: ManualPin[]) => void;
};

/** Pins the component's current region and presentation so proposals keep it. */
export function PinButton({ placement, label, prefs, pins, onSaved }: Props) {
  const csrf = useCsrf();
  const router = useRouter();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const pinned = pins.some((p) => p.componentId === placement.componentId);

  async function toggle() {
    const others = pins.filter((p) => p.componentId !== placement.componentId);
    const next: ManualPin[] = pinned
      ? others
      : [
          ...others,
          { componentId: placement.componentId, regionId: placement.regionId, visible: true, variantId: placement.variantId },
        ];
    const body: UserPreferences = {
      ...(prefs.expertise ? { expertise: prefs.expertise } : {}),
      ...(prefs.density ? { density: prefs.density } : {}),
      ...(prefs.help ? { help: prefs.help } : {}),
      pins: next,
    };
    setBusy(true);
    const res = await apiPut("/api/host/preferences", body, csrf);
    setBusy(false);
    if (!res.ok) {
      notify(`Couldn't ${pinned ? "unpin" : "pin"} ${label}: ${res.error.message}`, "error");
      return;
    }
    onSaved(next);
    notify(
      pinned
        ? `Unpinned ${label}. New proposals may move it.`
        : `Pinned ${label} to ${regionLabel(placement.regionId).toLowerCase()}. Proposals will keep it there.`,
    );
    router.refresh();
  }

  return (
    <button type="button" className="btn btn-sm btn-quiet" onClick={toggle} disabled={busy}>
      <IconPin size={14} />
      {pinned ? "Unpin" : "Pin"}
      <span className="sr-only"> {label}</span>
    </button>
  );
}
