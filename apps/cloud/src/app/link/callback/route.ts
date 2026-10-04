import { ContourError } from '@contour/sdk/core';
import { resolveHostUser } from '@/server/context';
import { cloudDb } from '@/server/db';
import { env } from '@/server/env';
import { finishLink } from '@/server/link-flow';

export async function GET(request: Request) {
  try {
    const user = await resolveHostUser();
    const destination = await finishLink({ db: cloudDb(), appUrl: env.appUrl }, user.subjectId, new URL(request.url), user.sessionId);
    return Response.redirect(new URL(destination, env.appUrl), 303);
  } catch (error) {
    if (error instanceof ContourError && error.code === 'UNAUTHENTICATED') {
      // OAuth responses can carry credentials. Restart from Projects after sign-in.
      return Response.redirect(new URL('/login?next=%2Fprojects&error=link_session', env.appUrl), 303);
    }
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'LINK_FAILED';
    return Response.redirect(new URL(`/projects?error=${encodeURIComponent(code)}`, env.appUrl), 303);
  }
}
