import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { getTeams } from '@/data/teams';
export const metadata: Metadata = { title: 'Team management' };
export default async function Admin() {
  const session = await requireSession();
  if (session.role !== 'admin') return <section className="empty-page"><h1>Administrator access required</h1><p>Team management is available to workspace administrators. Contact your administrator if you need access.</p><Link className="button button-primary" href="/desk">Return to desk</Link></section>;
  const teams = await getTeams(session);
  return <><div className="page-heading"><div><h1>Team management</h1><p>People, responsibilities, and workspace access.</p></div><span className="neutral-badge">Read-only directory</span></div><div className="team-list">{teams.map(team => <section key={team.id} className="settings-section"><div className="team-title"><div><h2>{team.name}</h2><p>{team.description}</p></div><span className="scope-badge">{team.members.length} {team.members.length === 1 ? 'member' : 'members'}</span></div>{team.members.map(member => <div className="team-member" key={member.id}><span className="avatar" aria-hidden="true">{member.name.split(' ').map(n => n[0]).join('').slice(0,2)}</span><div><strong>{member.name}</strong><span className="muted">{member.email}</span></div><span className="neutral-badge">{member.role === 'admin' ? 'Administrator' : member.role === 'lead' ? 'Team lead' : 'Agent'}</span></div>)}</section>)}</div></>;
}
