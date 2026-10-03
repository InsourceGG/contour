'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section className="empty-page"><h1>Unable to load this workspace</h1><p>Your changes are safe. Try loading the page again.</p><button type="button" className="button button-primary" onClick={() => reset()}>Try again</button></section>;
}
