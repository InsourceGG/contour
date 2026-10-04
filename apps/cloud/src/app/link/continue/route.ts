import { ContourError } from '@contour/sdk/core';
import { CSRF_HEADER } from '@contour/sdk/server';
import { contour } from '@/server/contour';
import { cloudDb } from '@/server/db';
import { env } from '@/server/env';
import { beginLink } from '@/server/link-flow';
import { rateLimit } from '@/server/rate-limit';

export async function POST(request: Request) {
  try {
    const user = await contour.requireUser();
    const form = await request.formData();
    const headers = new Headers(request.headers);
    headers.set(CSRF_HEADER, String(form.get('csrf_token') ?? ''));
    contour.assertCsrf(new Request(request.url, { method: 'POST', headers }), user);
    rateLimit(user.subjectId, 'link');
    const authorization = await beginLink({ db: cloudDb(), appUrl: env.appUrl }, user.subjectId, String(form.get('project') ?? ''), user.sessionId);
    return Response.redirect(authorization, 303);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'RATE_LIMITED') {
      return new Response(null, { status: 303, headers: { Location: new URL('/projects?error=RATE_LIMITED', env.appUrl).toString(), 'Retry-After': '60', 'Cache-Control': 'no-store' } });
    }
    if (error instanceof ContourError && error.code === 'UNAUTHENTICATED') return Response.redirect(new URL('/login?next=%2Fprojects', env.appUrl), 303);
    if (error instanceof ContourError && error.code === 'FORBIDDEN') return Response.redirect(new URL('/projects?error=permission', env.appUrl), 303);
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'LINK_FAILED';
    return Response.redirect(new URL(`/projects?error=${encodeURIComponent(code)}`, env.appUrl), 303);
  }
}
