import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { getTeams } from '@/data/teams';
import { AgentAccessControls } from '@/contour/admin-controls';
import { agentAccessEnabled, APP_ID } from '@/contour/identity';
import { contour } from '@/contour/server';
export const metadata: Metadata = { title: 'Team management' };
/** Current kill switch state for the verified admin, or null if Contour can't be reached. */
async function loadAgentAccess() {
  try {
    const user = await contour.requireUser();
    if (user.role !== 'admin') return null;
    return { enabled: await agentAccessEnabled(user.tenantId, APP_ID), csrfToken: contour.oauth.csrfTokenFor(user) };
  } catch (error) {
    console.error('[contour] agent access controls unavailable:', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}
export default async function Admin() {
  const session = await requireSession();
  if (session.role !== 'admin') return <section className="empty-page"><h1>Administrator access required</h1><p>Team management is available to workspace administrators. Contact your administrator if you need access.</p><Link className="button button-primary" href="/desk">Return to desk</Link></section>;
  const [teams, agentAccess] = await Promise.all([getTeams(session), loadAgentAccess()]);
  return <><div className="page-heading"><div><h1>Team management</h1><p>People, responsibilities, and workspace access.</p></div><span className="neutral-badge">Read-only directory</span></div><div className="team-list">{agentAccess ? <AgentAccessControls {...agentAccess} /> : <section className="settings-section"><h2>AI agent access</h2><p className="muted">Agent access controls are unavailable right now. Agents stay disabled while the setting can&apos;t be read.</p></section>}{teams.map(team => <section key={team.id} className="settings-section"><div className="team-title"><div><h2>{team.name}</h2><p>{team.description}</p></div><span className="scope-badge">{team.members.length} {team.members.length === 1 ? 'member' : 'members'}</span></div>{team.members.map(member => <div className="team-member" key={member.id}><span className="avatar" aria-hidden="true">{member.name.split(' ').map(n => n[0]).join('').slice(0,2)}</span><div><strong>{member.name}</strong><span className="muted">{member.email}</span></div><span className="neutral-badge">{member.role === 'admin' ? 'Administrator' : member.role === 'lead' ? 'Team lead' : 'Agent'}</span></div>)}</section>)}</div></>;
}
