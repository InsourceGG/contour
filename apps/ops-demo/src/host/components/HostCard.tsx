"use client";

import { useId, type ReactNode } from "react";
import { useSurfaceChrome } from "@contour/sdk/react";
import type { Placement } from "@contour/sdk/core";
import { IconLock, IconPin } from "@/components/icons";

type Props = {
  placement: Placement;
  title: string;
  subtitle?: ReactNode;
  /** Extra header content owned by the component (e.g. a period label). */
  meta?: ReactNode;
  children: ReactNode;
};

/** Shared frame for company components: heading, preview label, lock/pin markers and host actions. */
export function HostCard({ placement, title, subtitle, meta, children }: Props) {
  const headingId = useId();
  const { preview, renderActions, pinnedIds, lockedIds } = useSurfaceChrome();
  const pinned = pinnedIds?.has(placement.componentId) ?? false;
  const locked = lockedIds?.has(placement.componentId) ?? false;
  return (
    <section
      className="hc"
      aria-labelledby={headingId}
      data-variant={placement.variantId}
      data-pinned={pinned ? "true" : undefined}
      data-locked={locked ? "true" : undefined}
    >
      <header className="hc-head">
        <div className="min-w-0">
          <h3 id={headingId} className="hc-title">
            {title}
            {preview && <span className="sr-only"> (preview)</span>}
          </h3>
          {subtitle && <p className="hc-sub">{subtitle}</p>}
        </div>
        <div className="hc-tools">
          {meta}
          {preview && (
            <span className="badge" aria-hidden="true">
              Preview
            </span>
          )}
          {locked && (
            <span className="badge badge-ink" title="Position and visibility are set by company policy">
              <IconLock size={12} />
              Locked by policy
            </span>
          )}
          {pinned && (
            <span className="badge badge-accent">
              <IconPin size={12} />
              Pinned
            </span>
          )}
          {!preview && renderActions?.(placement)}
        </div>
      </header>
      {children}
    </section>
  );
}

export function Unavailable({ what }: { what: string }) {
  return (
    <p className="text-[length:var(--cs-fs-sm)] text-ink-2">
      {what} isn&apos;t available right now. Your other panels are unaffected; reload to try again.
    </p>
  );
}
