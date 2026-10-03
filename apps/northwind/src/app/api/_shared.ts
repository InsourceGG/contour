import { NextResponse } from 'next/server';
/** Block cross-origin browser submissions, including login CSRF. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') return false;
  return !origin || origin === new URL(process.env.APP_URL || request.url).origin;
}
/** A same-origin path to return to after sign-in, or null. Rejects absolute, protocol-relative, backslash, and control-character URLs. */
export function safeNextPath(value: unknown): string | null {
  // URL parsing strips tabs and newlines, which could turn "/\t/host" into "//host".
  return typeof value === 'string' && value.length <= 2048 && value.startsWith('/') && !value.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(value) ? value : null;
}
export function goTo(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, process.env.APP_URL || request.url), 303);
}
export function actionResult(request: Request, result: { error?: string; message?: string }, status = 200) {
  if (request.headers.get('accept')?.includes('application/json')) return NextResponse.json(result, { status });
  return goTo(request, `/desk?${result.error ? 'error=action' : 'saved=1'}`);
}
