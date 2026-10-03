import type { Metadata } from 'next';
import { requireSession } from '@/lib/session';
import { getCustomers } from '@/data/customers';
export const metadata: Metadata = { title: 'Customers' };
export default async function Customers() {
  const session = await requireSession();
  const customers = await getCustomers(session);
  return <><div className="page-heading"><div><h1>Customers</h1><p>The people behind your conversations.</p></div><span className="scope-badge">{session.role === 'admin' ? 'All teams' : session.team} · {customers.length} customers</span></div>
  {customers.length ? <div className="table-surface"><table className="data-table"><caption className="sr-only">Customers visible to your team</caption><thead><tr><th scope="col">Customer</th><th scope="col" className="customer-company">Company</th><th scope="col">Plan</th>{session.role === 'admin' && <th scope="col">Team</th>}</tr></thead><tbody>{customers.map(customer => <tr key={customer.id}><td><div className="customer-name"><span className="avatar" aria-hidden="true">{customer.name.split(' ').map(n => n[0]).join('').slice(0,2)}</span><div><strong>{customer.name}</strong><span className="muted">{customer.email}</span></div></div></td><td className="customer-company">{customer.company}</td><td><span className="neutral-badge">{customer.plan}</span></td>{session.role === 'admin' && <td>{customer.team}</td>}</tr>)}</tbody></table></div> : <section className="empty-page"><h2>No customers in this team yet</h2><p>Customer records will appear here when conversations are added.</p></section>}</>;
}
