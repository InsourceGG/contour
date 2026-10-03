import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { getTickets, getSlaBreaches, getCsatTrend, getWorkload, getKbArticles, getCustomerTimeline } from '@/data';
import { SlaAlerts, TicketQueue, CsatTrend, WorkloadPanel, KnowledgeBase, CustomerTimeline } from '@/components/desk';
export const metadata: Metadata = { title: 'Desk' };
type Query = { filter?: string; density?: string; view?: string; range?: string; kb?: string; saved?: string; error?: string; limit?: string };
export default async function Desk({ searchParams }: { searchParams: Promise<Query> }) {
  const session = await requireSession();
  const query = await searchParams;
  const filter = ['open', 'pending', 'resolved', 'mine'].includes(query.filter || '') ? query.filter as 'open' | 'pending' | 'resolved' | 'mine' : 'all';
  const density = query.density === 'compact' ? 'compact' : 'comfortable';
  const variant = query.view === 'cards' ? 'cards' : 'list';
  const range = query.range === '30d' ? '30d' : '7d';
  const kb = query.kb === 'collapsed' ? 'collapsed' : 'guided';
  const limit = 40;
  const [tickets, breaches, csat, workload, articles, events] = await Promise.all([
    getTickets(session, { filter, limit }), getSlaBreaches(session), getCsatTrend(session, { range }),
    getWorkload(session), getKbArticles(session, {}), getCustomerTimeline(session, { limit: 6 }),
  ]);
  const now = new Date().toISOString();
  const href = (changes: Record<string, string>) => {
    const values = new URLSearchParams({ filter, density, view: variant, range, kb, limit: String(limit), ...changes });
    return `/desk?${values.toString()}`;
  };
  return <><div className="page-heading"><div><h1>Support desk</h1><p>Keep every conversation moving forward.</p></div><div className="page-context"><time dateTime={now}>{new Date(now).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</time><span className="scope-badge">{session.role === 'admin' ? 'All teams' : session.team}</span></div></div>
  {query.saved && <p className="notice notice-success" role="status">Your ticket was updated.</p>}
  {query.error && <p className="notice notice-error" role="alert">Unable to update this ticket. Check that you have access and try again.</p>}
  <SlaAlerts breaches={breaches} variant="banner" />
  <div className="desk-layout"><div className="desk-primary"><div><div className="desk-toolbar"><nav className="filter-tabs" aria-label="Ticket queue filters">{[['all','All tickets'],['open','Open'],['pending','Pending']].map(([value,label]) => <Link href={href({ filter: value })} key={value} aria-current={filter === value ? 'page' : undefined}>{label}</Link>)}</nav><div className="view-options"><details><summary>Queue view</summary><div className="view-option-menu"><form action="/desk" method="get"><input type="hidden" name="filter" value={filter}/><input type="hidden" name="range" value={range}/><input type="hidden" name="kb" value={kb}/><label>Spacing<select name="density" defaultValue={density}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><button className="button button-small" type="submit">Apply view</button></form></div></details></div></div><TicketQueue tickets={tickets} key={`${filter}-${variant}`} currentUserId={session.userId} density={density} variant={variant} now={Date.parse(now)} /></div>
  <div className="desk-bottom"><div><KnowledgeBase articles={articles} mode={kb}/><Link className="panel-variant-link" href={href({kb: kb === 'guided' ? 'collapsed' : 'guided'})}>{kb === 'guided' ? 'Use compact article list' : 'Use guided article list'}</Link></div><CustomerTimeline events={events} density={density} now={Date.parse(now)}/></div></div>
  <aside className="desk-secondary" aria-label="Service insights"><div><CsatTrend data={csat} range={range} presentation="chart" periodHrefs={{"7d": href({range:"7d"}), "30d": href({range:"30d"})}}/></div><WorkloadPanel data={workload} density={density}/></aside></div></>;
}
