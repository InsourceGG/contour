import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ContourError } from '@contour/sdk/core';
import { resolveHostUser } from '@/server/context';
import { contour } from '@/server/contour';
import { cloudDb } from '@/server/db';
import { linkProject } from '@/server/link-flow';

export default async function LinkStart({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project: projectId = '' } = await searchParams;
  const user = await resolveHostUser().catch(error => {
    if (error instanceof ContourError && error.code === 'UNAUTHENTICATED') {
      redirect(`/login?next=${encodeURIComponent(`/link/start?project=${encodeURIComponent(projectId)}`)}`);
    }
    throw error;
  });
  const project = await linkProject(cloudDb(), projectId);
  if (!project) return <section className="narrow panel"><h1>Project unavailable</h1><p className="muted">This project is not ready for linking. Return to Projects to choose an available company.</p><Link className="button" href="/projects">Return to Projects</Link></section>;
  return <section className="narrow panel link-confirmation">
    <div className="page-intro"><h1>Link {project.name} ({project.company}) to your Contour account?</h1><p className="muted">You are signed in as <strong>{user.email}</strong>.</p></div>
    {project.description && <p>{project.description}</p>}
    <div className="notice"><p>You will sign in at {project.company} to choose what your AI agent can access.</p><p>Your agent can describe, read and propose views. You approve each change in the company’s app.</p></div>
    <form action="/link/start" method="post">
      <input type="hidden" name="project" value={project.id} />
      <input type="hidden" name="csrf_token" value={contour.oauth.csrfTokenFor(user)} />
      <div className="actions"><button className="button primary" type="submit">Continue</button><Link className="button secondary" href="/projects">Cancel</Link></div>
    </form>
    <p className="muted">Contour stores access tokens for this connection. Your company password stays with {project.company}.</p>
  </section>;
}
