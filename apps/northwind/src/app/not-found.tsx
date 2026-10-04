import Link from 'next/link';
export default function NotFound() { return <main id="main" className="empty-page"><h1>Page not found</h1><p>This page may have moved. Return to the support desk to continue.</p><Link className="button button-primary" href="/desk">Open desk</Link></main>; }
