export default function Loading() {
  return <div aria-busy="true" aria-label="Loading workspace"><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-alert" /><div className="loading-grid"><div className="skeleton skeleton-queue" /><div className="skeleton skeleton-queue" /></div><span className="sr-only" role="status">Loading your workspace…</span></div>;
}
