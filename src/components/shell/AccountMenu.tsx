"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { browserSupabase } from "@/components/supabase-browser";
import { useClearComponentState } from "@/sdk/react/component-state";
import { IconChevron } from "@/components/icons";

type Props = { displayName: string; email: string; tenant: string; role: string };

/** Disclosure-style account menu (button + panel, Escape closes, focus returns). */
export function AccountMenu({ displayName, email, tenant, role }: Props) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const clearState = useClearComponentState();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    setError(null);
    const { error: err } = await browserSupabase().auth.signOut();
    if (err) {
      setSigningOut(false);
      setError("Sign-out didn't complete. Try again.");
      return;
    }
    clearState();
    router.replace("/login");
    router.refresh();
  }

  const initials = displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="flex min-h-10 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-rule/45"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-[12px] font-semibold text-surface" aria-hidden="true">
          {initials}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-semibold">{displayName}</span>
          <span className="block text-xs text-ink-3">{tenant}</span>
        </span>
        <span className="sr-only sm:hidden">
          {displayName}, {tenant}
        </span>
        <IconChevron size={14} className="text-ink-3" />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-rule bg-surface p-4 shadow-[0_12px_32px_rgb(19_33_43/0.14)]"
      >
        <p className="font-semibold">{displayName}</p>
        <p className="text-sm break-all text-ink-2">{email}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-3">Company</dt>
          <dd>{tenant}</dd>
          <dt className="text-ink-3">Role</dt>
          <dd>{role === "operator" ? "Company operator" : "Member"}</dd>
        </dl>
        {error && (
          <p role="alert" className="mt-3 text-sm text-critical">
            {error}
          </p>
        )}
        <button type="button" className="btn mt-4 w-full" onClick={signOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
