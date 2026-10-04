"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconInfo } from "@/components/icons";

const MAX_POLLS = 6;
const INTERVAL_MS = 3000;

/**
 * Shown after returning from Stripe. The redirect proves nothing: the credit
 * only appears once the server has verified the signed webhook, so we poll.
 */
export function CheckoutStatus({ initialAvailable, latestOrderGranted }: { initialAvailable: number; latestOrderGranted: boolean }) {
  const router = useRouter();
  const [polls, setPolls] = useState(0);
  const [baseline] = useState(initialAvailable);
  const arrived = latestOrderGranted || initialAvailable > baseline;

  useEffect(() => {
    if (arrived || polls >= MAX_POLLS) return;
    const t = window.setTimeout(() => {
      router.refresh();
      setPolls((n) => n + 1);
    }, INTERVAL_MS);
    return () => window.clearTimeout(t);
  }, [arrived, polls, router]);

  return (
    <div role="status" className={`notice ${arrived ? "notice-success" : "notice-info"}`}>
      <IconInfo size={18} />
      <div>
        <p className="font-semibold">Stripe received your payment. Your credit appears once our server verifies Stripe&apos;s signed confirmation.</p>
        <p className="text-ink-2">
          {arrived
            ? "Verified. Your new credit is in your balance."
            : polls >= MAX_POLLS
              ? "Still waiting for verification. This can take a minute; reload the page to check again."
              : "Checking for verification…"}
        </p>
      </div>
    </div>
  );
}
