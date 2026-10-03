"use client";

import { useState } from "react";
import { apiPost, type ApiError } from "@/components/api";
import { useCsrf } from "@/components/csrf";

/** Starts a server-owned Stripe test Checkout session; the client never chooses price or quantity. */
export function BuyCreditButton() {
  const csrf = useCsrf();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function buy() {
    setBusy(true);
    setError(null);
    const res = await apiPost<{ url?: string }>("/api/billing/checkout", {}, csrf);
    const url = res.ok ? res.data?.url : undefined;
    if (!res.ok || typeof url !== "string" || !/^https:\/\//.test(url)) {
      setBusy(false);
      setError(res.ok ? { code: "INTERNAL", message: "Checkout didn't return a payment page." } : res.error);
      return;
    }
    window.location.assign(url);
  }

  return (
    <div className="space-y-3">
      <button type="button" className="btn btn-primary" onClick={buy} disabled={busy}>
        {busy ? "Opening Stripe…" : "Buy 1 credit (Stripe test Checkout)"}
      </button>
      {error && (
        <p role="alert" className="notice notice-error">
          Checkout couldn&apos;t start: {error.message}
        </p>
      )}
    </div>
  );
}
