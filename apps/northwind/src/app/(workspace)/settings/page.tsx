import type { Metadata } from 'next';
import { requireSession } from '@/lib/session';
import { getUserSettings } from '@/data/settings';
import { SubmitButton } from '@/components/submit-button';
export const metadata: Metadata = { title: 'Settings' };
export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const session = await requireSession();
  const settings = await getUserSettings(session);
  const { saved, error } = await searchParams;
  return <><div className="page-heading"><div><h1>Settings</h1><p>Make the workspace work for you.</p></div></div><div className="settings-layout"><form action="/api/settings" method="post" className="stack-form">
    {saved && <p className="notice notice-success" role="status">Profile and notification preferences saved.</p>}
    {error && <p id="settings-error" className="notice notice-error" role="alert">{error === 'name' ? 'Use a display name between 2 and 80 characters.' : 'Unable to save your settings. Try again.'}</p>}
    <section className="settings-section"><h2>Profile</h2><div className="profile-fields"><div className="field"><label htmlFor="displayName">Display name</label><input id="displayName" name="displayName" defaultValue={settings.displayName} required minLength={2} maxLength={80} autoComplete="name" aria-invalid={error === 'name' || undefined} aria-describedby={error === 'name' ? 'settings-error' : undefined} /></div><div className="field"><label htmlFor="profile-email">Email</label><input id="profile-email" type="email" defaultValue={session.email} readOnly aria-describedby="email-hint" /><span id="email-hint" className="field-hint">Contact your administrator to change your email.</span></div></div></section>
    <section className="settings-section"><fieldset className="preference-list"><legend>Notifications</legend>
    <label className="preference"><input type="checkbox" name="emailNotifications" defaultChecked={settings.emailNotifications} /><span><strong>Email me about assigned tickets</strong><span>Updates for conversations you are responsible for.</span></span></label>
    <label className="preference"><input type="checkbox" name="slaNotifications" defaultChecked={settings.slaNotifications} /><span><strong>Notify me about SLA breaches</strong><span>Time-sensitive tickets that need a response.</span></span></label>
    <label className="preference"><input type="checkbox" name="dailyDigest" defaultChecked={settings.dailyDigest} /><span><strong>Send a daily summary</strong><span>A daily overview of activity in your team.</span></span></label>
    </fieldset></section><div><SubmitButton>Save changes</SubmitButton></div>
  </form><aside className="settings-aside"><h2>Workspace access</h2><p>{session.role === 'admin' ? 'You have administrator access to all teams.' : `You have ${session.role === 'lead' ? 'team lead' : 'agent'} access to ${session.team}.`}</p><section className="integration-placeholder"><h2>Integrations</h2><p>A place for connected tools and workspace services as your team grows.</p><span className="neutral-badge">No integrations connected</span></section></aside></div></>;
}
