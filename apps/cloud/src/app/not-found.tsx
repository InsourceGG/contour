import Link from "next/link";
export default function NotFound() { return <div className="narrow panel"><h1>Page not found</h1><p className="muted">This link is unavailable. Return to your projects to continue.</p><div className="actions"><Link className="button primary" href="/projects">View projects</Link></div></div>; }
