"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function isEditing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"].includes(el.type);
  }
  return false;
}

export type ViewPoller = { pendingRevision: number | null; applyNow: () => void };

/**
 * Safe boundary for layout swaps: observe the live hook's saved revision; if it changed
 * (e.g. accepted in another tab) refresh, unless the user is typing, in
 * which case defer until blur or an explicit review.
 */
export function useLiveRevision(currentRevision: number, observedRevision: number | null): ViewPoller {
  const router = useRouter();
  const [pending, setPending] = useState<number | null>(null);
  const refreshingRef = useRef<number | null>(null);

  useEffect(() => {
    if (observedRevision === null || observedRevision <= currentRevision) return;
    let cancelled = false;
    function review() {
      if (cancelled) return;
      if (isEditing()) {
        setPending(observedRevision);
      } else if (refreshingRef.current !== observedRevision) {
        refreshingRef.current = observedRevision;
        setPending(null);
        router.refresh();
      }
    }
    const id = window.setTimeout(review, 0);
    let blurTimer: number | undefined;
    const onBlur = () => {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(review, 0);
    };
    document.addEventListener("focusout", onBlur);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
      window.clearTimeout(blurTimer);
      document.removeEventListener("focusout", onBlur);
    };
  }, [currentRevision, observedRevision, router]);

  const applyNow = useCallback(() => {
    setPending(null);
    refreshingRef.current = observedRevision;
    router.refresh();
  }, [observedRevision, router]);

  return { pendingRevision: pending !== null && pending > currentRevision ? pending : null, applyNow };
}

export function SafeBoundaryBar({ poller }: { poller: ViewPoller }) {
  const visible = poller.pendingRevision !== null;
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      {visible && (
        <div className="flex max-w-xl flex-wrap items-center gap-3 rounded-xl bg-ink px-4 py-3 text-surface shadow-[0_12px_32px_rgb(19_33_43/0.3)]">
          <p className="text-sm">
            <strong>Your saved view changed.</strong> Review when you&apos;re done typing.
          </p>
          <button type="button" className="btn btn-sm btn-primary" onClick={poller.applyNow}>
            Review saved view
          </button>
        </div>
      )}
    </div>
  );
}
