import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ContourError, type Scope } from '@contour/sdk/core';
import { AUTHORIZE_PARAM_NAMES, authorizePathFor, type HostUser, type RawParams } from '@contour/sdk/server';
import { APP_ID, identity } from '@/contour/identity';
import { contour } from '@/contour/server';
export const metadata: Metadata = { title: 'Allow agent access', robots: { index: false, follow: false } };
const scopeCopy: Record<Exclude<Scope, 'view:commit'>, { title: string; detail: string }> = {
  'view:read': { title: 'See how your desk is arranged', detail: 'Which desk panels you see, their order and style, and your saved view revision.' },
  'data:read': { title: 'Read support data you can already see', detail: 'Ticket numbers, subjects, status, priority, and due times; SLA alerts; satisfaction scores; team workload; knowledge article titles and summaries; and customer activity. Never customer email addresses or internal notes.' },
  'view:propose': { title: 'Suggest a desk layout for you to review', detail: 'A suggestion never changes your desk. You review it in Northwind and choose Accept or Keep current.' },
};
function Shell({ children }: { children: React.ReactNode }) {
  return <main id="main" className="workspace-main"><div className="team-list" style={{ maxWidth: 640, marginInline: 'auto' }}><p className="muted">Northwind Support</p>{children}</div></main>;
}
function ErrorView({ title, message }: { title: string; message: string }) {
  return <Shell><section className="settings-section"><h1>{title}</h1><p className="notice notice-error" role="alert" style={{ marginBlock: '18px 0' }}>{message}</p><p style={{ marginBlockStart: 18 }}><Link href="/desk">Return to the desk</Link></p></section></Shell>;
}
export default async function Authorize({ searchParams }: { searchParams: Promise<RawParams> }) {
  const raw = await searchParams;
  const validation = await contour.oauth.validateAuthorize(raw);
  if (validation.kind === 'fatal') return <ErrorView title="This connection request is invalid" message={validation.message} />;
  if (validation.kind === 'redirect_error') {
    // Never redirect automatically to an unverified client with an error; let the person choose.
    const back = contour.oauth.buildClientRedirect(validation.redirectUri, { error: validation.error, error_description: validation.description, state: validation.state });
    return <Shell><section className="settings-section"><h1>This connection request is invalid</h1><p style={{ marginBlockStart: 12 }}>{validation.description}.</p><p className="muted" style={{ marginBlockStart: 12 }}>The application asked to return to <strong>{new URL(validation.redirectUri).host}</strong>. Only continue if you started this connection.</p><p style={{ marginBlockStart: 18 }}><a href={back} rel="noreferrer">Return to the application with this error</a></p></section></Shell>;
  }
  const request = validation.request;
  let user: HostUser | null = null;
  try {
    user = await identity.currentUser();
  } catch (error) {
    if (error instanceof ContourError && error.code === 'FORBIDDEN') return <ErrorView title="No access" message="Your account can't be shared with an agent. Contact your administrator." />;
    throw error;
  }
  if (!user) redirect(identity.loginUrl(authorizePathFor(raw)));
  const deny = contour.oauth.buildClientRedirect(request.redirectUri, { error: 'access_denied', error_description: 'The user denied the request', state: request.state });
  if (!(await contour.config.agentAccessEnabled(user.tenantId, APP_ID))) {
    return <Shell><section className="settings-section"><h1>Agent access is turned off</h1><p style={{ marginBlockStart: 12 }}>A Northwind administrator has turned off agent access. No access can be granted right now.</p><p style={{ marginBlockStart: 18 }}><a href={deny}>Return to the application</a></p></section></Shell>;
  }
  const hidden = AUTHORIZE_PARAM_NAMES.map(name => typeof raw[name] === 'string' ? <input key={name} type="hidden" name={name} value={raw[name] as string} /> : null);
  const scopes = request.scopes.filter((scope): scope is Exclude<Scope, 'view:commit'> => scope !== 'view:commit');
  return <Shell><section className="settings-section" aria-labelledby="consent-heading">
    <h1 id="consent-heading">Allow {request.client.clientName} to use your Northwind desk?</h1>
    <div className="notice notice-error" style={{ marginBlock: '18px' }}><strong>Unverified application.</strong> {request.trustedClient ? 'This is Contour Cloud, listed by your company.' : `The name “${request.client.clientName}” was supplied by the application itself.`} Only continue if you started this connection. You will return to <strong>{new URL(request.redirectUri).host}</strong>{request.loopbackRedirect ? ', an application on this computer' : ''}.</div>
    <p className="muted">Signed in as <strong>{user.displayName}</strong>. Support desk only.</p>
    <form method="post" action="/oauth/authorize/decision" className="stack-form" style={{ marginBlockStart: 22 }}>
      {hidden}
      <input type="hidden" name="csrf" value={contour.oauth.csrfTokenFor(user)} />
      <input type="hidden" name="scope_choice" value="1" />
      <fieldset className="preference-list"><legend>It will be able to</legend>
        {scopes.map(scope => <label className="preference" key={scope}><input type="checkbox" name="grant_scope" value={scope} defaultChecked disabled={scope === 'view:read'} /><span><strong>{scopeCopy[scope].title}{scope === 'view:read' ? ' (required)' : ''}</strong><span>{scopeCopy[scope].detail}</span></span></label>)}
      </fieldset>
      <section aria-labelledby="never-heading"><h2 id="never-heading">It will never be able to</h2><ul className="muted"><li>Save, undo, or reset your desk view. Only you can, in Northwind.</li><li>Assign tickets, reply to customers, or change any support data.</li><li>See other teams or change anyone&apos;s permissions.</li></ul></section>
      <p className="muted">You can disconnect this agent at any time in Settings.</p>
      <div className="contour-admin-actions"><button className="button button-primary" type="submit" name="decision" value="approve">Allow</button><button className="button" type="submit" name="decision" value="deny">Deny</button></div>
    </form>
  </section></Shell>;
}
