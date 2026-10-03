"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/components/api";

const POLL_MS = 15_000;

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
 * Safe boundary for layout swaps: poll the saved revision; if it changed
 * (e.g. accepted in another tab) refresh — unless the user is typing, in
 * which case defer and offer "apply now".
 */
export function useViewPoller(currentRevision: number): ViewPoller {
  const router = useRouter();
  const [pending, setPending] = useState<number | null>(null);
  const revisionRef = useRef(currentRevision);

  useEffect(() => {
    revisionRef.current = currentRevision;
  }, [currentRevision]);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      if (document.hidden) return;
      const res = await apiGet<{ revision: number }>("/api/host/view");
      if (stopped || !res.ok || typeof res.data?.revision !== "number") return;
      if (res.data.revision === revisionRef.current) return;
      if (isEditing()) setPending(res.data.revision);
      else router.refresh();
    }
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [router]);

  const applyNow = useCallback(() => {
    setPending(null);
    router.refresh();
  }, [router]);

  return { pendingRevision: pending !== null && pending !== currentRevision ? pending : null, applyNow };
}

export function SafeBoundaryBar({ poller }: { poller: ViewPoller }) {
  const visible = poller.pendingRevision !== null;
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      {visible && (
        <div className="flex max-w-xl flex-wrap items-center gap-3 rounded-xl bg-ink px-4 py-3 text-surface shadow-[0_12px_32px_rgb(19_33_43/0.3)]">
          <p className="text-sm">
            <strong>A new view is ready.</strong> We held it so your typing isn&apos;t interrupted.
          </p>
          <button type="button" className="btn btn-sm btn-primary" onClick={poller.applyNow}>
            Apply now
          </button>
        </div>
      )}
    </div>
  );
}
