import { NextResponse } from 'next/server';
/** Block cross-origin browser submissions, including login CSRF. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') return false;
  return !origin || origin === new URL(process.env.APP_URL || request.url).origin;
}
export function goTo(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, process.env.APP_URL || request.url), 303);
}
export function actionResult(request: Request, result: { error?: string; message?: string }, status = 200) {
  if (request.headers.get('accept')?.includes('application/json')) return NextResponse.json(result, { status });
  return goTo(request, `/desk?${result.error ? 'error=action' : 'saved=1'}`);
}
