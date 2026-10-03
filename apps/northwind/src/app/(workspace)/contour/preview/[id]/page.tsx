import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContourError, type PreviewData } from '@contour/sdk/core';
import { requireSession } from '@/lib/session';
import { getBroker } from '@/contour/broker';
import { manifest } from '@/contour/manifest';
import { PreviewActions, PreviewComparison } from '@/contour/preview-actions';
import { contour } from '@/contour/server';
import { loadDeskData } from '@/contour/surface-data';
export const metadata: Metadata = { title: 'Review proposed desk view' };
const stateCopy: Record<Exclude<PreviewData['state'], 'ready'>, string> = {
  applied: 'You already accepted this proposal.',
  rejected: 'You kept your current view instead of this proposal.',
  expired: 'This proposal expired before it was accepted.',
  stale: 'Your desk view changed after this proposal was made.',
  invalid: 'This proposal no longer passes company rules.',
};
export default async function ContourPreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const user = await contour.requireUser();
  let preview: PreviewData | null = null;
  try {
    preview = await getBroker().getPreview(contour.contextFromUser(user), id);
  } catch (error) {
    // Another user's proposal is indistinguishable from a missing one.
    if (!(error instanceof ContourError && (error.code === 'NOT_FOUND' || error.code === 'INVALID_INPUT'))) throw error;
  }
  if (!preview) notFound();
  const { proposal, state, stateReason, current, proposed, changes } = preview;
  const [data, proposedData] = await Promise.all([loadDeskData(session, current.config), loadDeskData(session, proposed)]);
  const ready = state === 'ready';
  const task = manifest.tasks.find(t => t.id === proposal.task)?.label ?? proposal.task;
  const expertise = manifest.expertiseLevels.find(e => e.id === proposal.expertise)?.label ?? proposal.expertise;
  return <div className="contour-preview">
    <Link className="back-link" href="/desk">Back to desk</Link>
    <div className="page-heading"><div><h1>{ready ? 'Review your proposed desk view' : 'This proposal can’t be applied'}</h1><p>{ready ? 'Compare it with your current view. Nothing changes until you accept.' : 'Your current desk view is unchanged.'}</p></div></div>
    {!ready && <p className="notice notice-error" role="status">{stateReason ?? stateCopy[state]}</p>}
    <section className="settings-section" aria-labelledby="why-heading"><h2 id="why-heading">Why this view</h2><p>{proposal.rationale}</p>
      <dl className="contour-preview-facts"><dt>Task</dt><dd>{task}</dd><dt>Expertise</dt><dd>{expertise}</dd><dt>Made for</dt><dd>Revision {proposal.baseRevision}</dd><dt>Expires</dt><dd><time dateTime={proposal.expiresAt}>{new Date(proposal.expiresAt).toLocaleString('en-US', { timeZone: 'UTC' })} UTC</time></dd></dl>
      <p className="muted">Task and expertise only change how the desk is arranged. They never change what you can see or do.</p></section>
    <PreviewComparison current={current} proposed={proposed} changes={changes} data={data} proposedData={proposedData} />
    {ready && <PreviewActions proposalId={proposal.id} configHash={proposal.configHash} csrfToken={contour.oauth.csrfTokenFor(user)} />}
  </div>;
}
