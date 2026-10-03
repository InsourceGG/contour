import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { Brand } from '@/components/brand';
import { SubmitButton } from '@/components/submit-button';
import { safeNextPath } from '@/app/api/_shared';
export const metadata: Metadata = { title: 'Sign in' };
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next: requested } = await searchParams;
  const next = safeNextPath(requested);
  if (await getSession()) redirect(next ?? '/desk');
  return <main id="main" className="login-layout"><section className="login-story"><Brand /><div><h1>A clear view.<br />A better response.</h1><p>Keep the conversation moving with a shared desk for every customer, ticket, and next step.</p><div className="login-note"><span aria-hidden="true" className="login-note-line" /><p>One team. Every conversation.<br /><span>The Northwind support workspace.</span></p></div></div><span className="login-story-footer">Northwind · Customer support</span></section>
  <section className="login-form-panel" aria-labelledby="sign-in-title"><div className="login-form-inner"><h2 id="sign-in-title">Welcome back</h2><p>Sign in to your support desk.</p><form action="/api/auth/login" method="post" className="stack-form">
    {next && <input type="hidden" name="next" value={next} />}
    {error && <p className="notice notice-error" id="login-error" role="alert">{error === 'unavailable' ? 'Sign in is unavailable. Try again in a moment.' : error === 'limited' ? 'Too many attempts. Wait 15 minutes and try again.' : 'Email or password is incorrect. Check both and try again.'}</p>}
    <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" placeholder="riley@northwind.demo" required maxLength={254} aria-invalid={error === 'credentials' || undefined} aria-describedby={error ? 'login-error' : undefined} /></div>
    <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={256} aria-invalid={error === 'credentials' || undefined} aria-describedby={error ? 'login-error' : undefined} /></div>
    <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
  </form><details className="demo-logins"><summary>Try the demo workspace</summary><p>Use <code>northwind-demo-2026</code> with any demo account:</p><ul><li><strong>Riley</strong><span>riley@northwind.demo · Tier 1 agent</span></li><li><strong>Casey</strong><span>casey@northwind.demo · Tier 2 senior agent</span></li><li><strong>Dana</strong><span>dana@northwind.demo · Administrator</span></li></ul><p className="muted">All customer records in this workspace are synthetic.</p></details></div></section></main>;
}
