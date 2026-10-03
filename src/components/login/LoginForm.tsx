"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { browserSupabase } from "@/components/supabase-browser";
import { safeNextPath } from "./safe-next";

const DEMO_PASSWORD = "contour-demo-2026";
const DEMO_USERS = [
  { email: "alex@contour.demo", name: "Alex Rivera", company: "Acme", role: "Member" },
  { email: "sam@contour.demo", name: "Sam Okafor", company: "Acme", role: "Member" },
  { email: "morgan@contour.demo", name: "Morgan Lee", company: "Acme", role: "Company operator" },
  { email: "taylor@contour.demo", name: "Taylor Kim", company: "Globex", role: "Member" },
];

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const submitRef = useRef<HTMLButtonElement>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await browserSupabase().auth.signInWithPassword({ email: email.trim(), password });
    if (err) {
      setBusy(false);
      setError(
        err.status === 400 || /invalid/i.test(err.message)
          ? "That email and password don't match an account. Check them and try again."
          : "Sign-in is unavailable right now. Try again in a moment.",
      );
      return;
    }
    // Full navigation so the server sees the fresh session cookie.
    window.location.assign(safeNextPath(next));
  }

  function fill(u: (typeof DEMO_USERS)[number]) {
    setEmail(u.email);
    setPassword(DEMO_PASSWORD);
    setError(null);
    submitRef.current?.focus();
  }

  return (
    <>
      <form className="mt-8 space-y-4" onSubmit={onSubmit} noValidate aria-describedby={error ? errorId : undefined}>
        <div>
          <label htmlFor={emailId} className="field-label">
            Email
          </label>
          <input
            id={emailId}
            className="input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={passwordId} className="field-label">
            Password
          </label>
          <input
            id={passwordId}
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p id={errorId} role="alert" className="notice notice-error">
            {error}
          </p>
        )}
        <button ref={submitRef} type="submit" className="btn btn-primary w-full" disabled={busy || !email || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <section className="mt-10" aria-labelledby="demo-accounts">
        <h2 id="demo-accounts" className="text-base font-semibold">
          Demo accounts
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          Synthetic accounts for this demo. Every account uses the password <code className="font-semibold">{DEMO_PASSWORD}</code>.
        </p>
        <ul className="mt-3 divide-y divide-rule rounded-xl border border-rule bg-surface">
          {DEMO_USERS.map((u) => (
            <li key={u.email} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {u.name} <span className="font-normal text-ink-3">at {u.company}</span>
                </p>
                <p className="truncate text-xs text-ink-3">
                  {u.email}
                  {u.role !== "Member" ? `, ${u.role.toLowerCase()}` : ""}
                </p>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => fill(u)} aria-label={`Fill in ${u.name}'s demo sign-in`}>
                Use
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
