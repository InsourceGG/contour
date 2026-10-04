import type { Metadata } from 'next';
import { requireSession } from '@/lib/session';
import { DeskSurface } from '@/contour/surface';
import { loadDeskData, loadSavedView, withQuery } from '@/contour/surface-data';
import { contour } from '@/contour/server';
export const metadata: Metadata = { title: 'Desk' };
type Query = { filter?: string; density?: string; view?: string; range?: string; kb?: string; saved?: string; error?: string; limit?: string; applied?: string };
export default async function Desk({ searchParams }: { searchParams: Promise<Query> }) {
  const session = await requireSession();
  const query = await searchParams;
  // The saved Contour view arranges the panels; the desk's own links and forms still override it per page load.
  const saved = await loadSavedView();
  const config = withQuery(saved.config, query);
  const data = await loadDeskData(session, config);
  // Live proposals need the session-bound host CSRF token; without Contour the desk stays static.
  const csrfToken = saved.snapshot ? await contour.requireUser().then(user => contour.oauth.csrfTokenFor(user), () => null) : null;
  const now = new Date().toISOString();
  return <><div className="page-heading"><div><h1>Support desk</h1><p>Keep every conversation moving forward.</p></div><div className="page-context"><time dateTime={now}>{new Date(now).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</time><span className="scope-badge">{session.role === 'admin' ? 'All teams' : session.team}</span></div></div>
  {query.saved && <p className="notice notice-success" role="status">Your ticket was updated.</p>}
  {query.error && <p className="notice notice-error" role="alert">Unable to update this ticket. Check that you have access and try again.</p>}
  {query.applied && <p className="notice notice-success" role="status">Your new desk view is saved.</p>}
  {saved.notice && <p className="notice notice-error" role="status">{saved.notice}</p>}
  <DeskSurface config={config} data={data} csrfToken={csrfToken} /></>;
}
