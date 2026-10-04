import Link from 'next/link';
export default function Reports() {
  return <><div className="page-heading"><div><h1>Reports</h1><p>Service quality, over time.</p></div><span className="neutral-badge">Coming soon</span></div><section className="empty-page"><div className="empty-illustration" aria-hidden="true"><span /><span /><span /><span /><span /></div><h2>Reporting is on the way</h2><p>For now, review customer satisfaction and team workload on the desk.</p><Link className="button button-primary" href="/desk">Open desk</Link></section></>;
}
