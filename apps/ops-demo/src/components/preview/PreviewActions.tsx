"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, newKey, type ApiError } from "@/components/api";
import { useCsrf } from "@/components/csrf";
import { useToast } from "@/components/toast";

/**
 * Accept / Keep current / Close. Accept submits only the proposal id and its
 * stored hash; the server applies the stored config, never a client copy.
 */
export function PreviewActions({ proposalId, configHash }: { proposalId: string; configHash: string }) {
  const csrf = useCsrf();
  const router = useRouter();
  const { notify } = useToast();
  const [busy, setBusy] = useState<"accept" | "keep" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // Same key for retries of this approval so a double submit can't double-apply.
  const acceptKey = useRef<string | null>(null);

  async function accept() {
    acceptKey.current ??= newKey();
    setBusy("accept");
    setError(null);
    const res = await apiPost<{ revision?: number }>(
      `/api/host/proposals/${encodeURIComponent(proposalId)}/apply`,
      { configHash, idempotencyKey: acceptKey.current },
      csrf,
    );
    if (!res.ok) {
      setBusy(null);
      setError(res.error);
      return;
    }
    const rev = res.data?.revision;
    router.push(typeof rev === "number" ? `/?applied=${rev}` : "/");
  }

  async function keep() {
    setBusy("keep");
    setError(null);
    const res = await apiPost(`/api/host/proposals/${encodeURIComponent(proposalId)}/reject`, {}, csrf);
    if (!res.ok) {
      setBusy(null);
      setError(res.error);
      return;
    }
    notify("Kept your current view.");
    router.push("/");
  }

  return (
    <div className="sticky bottom-0 z-30 -mx-4 border-t border-rule bg-paper/95 px-4 py-3 backdrop-blur-sm md:-mx-6 md:px-6 xl:-mx-10 xl:px-10">
      {error && (
        <div role="alert" className="notice notice-error mb-3">
          <div>
            <p className="font-semibold">The view was not changed.</p>
            <p className="text-ink-2">{describe(error)}</p>
            {["STALE_REVISION", "EXPIRED_PROPOSAL", "PROPOSAL_NOT_READY", "INVALID_CONFIG", "INCOMPATIBLE_MANIFEST", "HASH_MISMATCH"].includes(
              error.code,
            ) && (
              <button type="button" className="btn btn-sm mt-2" onClick={() => router.refresh()}>
                Refresh this page
              </button>
            )}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" onClick={accept} disabled={busy !== null}>
          {busy === "accept" ? "Applying…" : "Accept proposed view"}
        </button>
        <button type="button" className="btn" onClick={keep} disabled={busy !== null}>
          {busy === "keep" ? "Keeping…" : "Keep current view"}
        </button>
        <Link href="/" className="btn btn-quiet">
          Close
        </Link>
        <p className="meta w-full sm:ml-auto sm:w-auto">You can undo after accepting.</p>
      </div>
    </div>
  );
}

function describe(e: ApiError): string {
  switch (e.code) {
    case "STALE_REVISION":
      return "Your view changed in another tab or session after this proposal was made. Request a new proposal to compare against your latest view.";
    case "EXPIRED_PROPOSAL":
      return "This proposal expired before it was accepted. Request a new one.";
    case "HASH_MISMATCH":
      return "The proposal on the server doesn't match what this page showed. Refresh to review it again.";
    case "INVALID_CONFIG":
      return "This proposal no longer passes company rules, so it can't be applied.";
    case "INCOMPATIBLE_MANIFEST":
      return "The screen, its policy or your role changed since this proposal was made.";
    case "PROPOSAL_NOT_READY":
      return "This proposal was already accepted, declined or replaced.";
    case "IDEMPOTENCY_CONFLICT":
      return "A conflicting request was already submitted. Refresh and try again.";
    case "RATE_LIMITED":
      return "Too many requests. Wait a minute and try again.";
    default:
      return e.message;
  }
}
