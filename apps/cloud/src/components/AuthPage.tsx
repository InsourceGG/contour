import Link from "next/link";
import { authCsrfForPage } from "@/server/auth-csrf";
import { safeNext } from "@/server/forms";
import { SubmitButton } from "./SubmitButton";
export type Search = Promise<Record<string, string | string[] | undefined>>;
const errors: Record<string,string> = {
  "email-rate": "Email delivery has reached its limit. Try again later, or sign in to an existing account with your password.",
  link_session: "Your connection session ended. Sign in, then start linking the project again.",
  credentials: "Unable to sign in or create this account. Check your email and password, or use an email sign-in link.",
  fields: "Enter your email and password. New passwords need at least 8 characters.",
  permission: "This form has expired. Reload the page and try again.",
  magic: "Unable to send a sign-in link. Check your email and try again in a moment.",
  expired: "This sign-in link has expired. Request another link below.",
};
export async function AuthPage({ signup, searchParams }: { signup: boolean; searchParams: Search }) {
  const query = await searchParams, next = safeNext(query.next), csrf = await authCsrfForPage();
  const error = typeof query.error === "string" ? errors[query.error] : undefined;
  return <div className="auth-layout">
    <div className="auth-story"><h1>{signup ? "One account for your projects." : "Welcome back."}</h1><p className="lede">{signup ? "Connect your company projects, then give your AI agent one place to find them." : "Your projects and agent connections, together in one place."}</p><p className="muted">You always review and accept changes in the company’s own app.</p></div>
    <section className="panel auth-panel" aria-labelledby="auth-heading">
      <h2 id="auth-heading">{signup ? "Create your account" : "Sign in to Contour"}</h2>
      {error && <p id="auth-error" className="notice error" role="alert">{error}</p>}
      {query.sent && <p className="notice" role="status">Check your email for {query.sent === "confirmation" ? "a confirmation" : "a sign-in"} link. You can close this page until it arrives.</p>}
      <form action="/auth/password" method="post" className="form-stack">
        <input type="hidden" name="csrf" value={csrf}/><input type="hidden" name="mode" value={signup ? "signup" : "login"}/><input type="hidden" name="next" value={next}/>
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" className="input" type="email" autoComplete="username" required placeholder="you@company.com" aria-invalid={query.error === "fields" || query.error === "credentials" ? true : undefined} aria-describedby={error ? "auth-error auth-help" : undefined}/></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" className="input" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 8 : undefined} aria-invalid={query.error === "fields" || query.error === "credentials" ? true : undefined} aria-describedby={error ? "auth-error auth-help" : "auth-help"}/></div>
        <p id="auth-help" className="muted small">{signup ? "Use at least 8 characters." : "Company demo accounts also work here."}</p>
        <SubmitButton>{signup ? "Create account" : "Sign in"}</SubmitButton>
      </form>
      {!signup && <details className="magic-details"><summary>Sign in with an email link</summary><form action="/auth/magic" method="post" className="form-stack"><input type="hidden" name="csrf" value={csrf}/><input type="hidden" name="next" value={next}/><div className="field"><label htmlFor="magic-email">Account email</label><input id="magic-email" name="email" className="input" type="email" autoComplete="email" required/></div><SubmitButton className="button">Send sign-in link</SubmitButton></form></details>}
      <p className="auth-switch">{signup ? "Already have an account? " : "New to Contour? "}<Link href={`${signup ? "/login" : "/signup"}?next=${encodeURIComponent(next)}`}>{signup ? "Sign in" : "Create account"}</Link></p>
    </section>
  </div>;
}
