import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContourError } from '@contour/sdk/core';
import { POST } from '../../src/app/link/continue/route';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), assertCsrf: vi.fn(), beginLink: vi.fn(), rateLimit: vi.fn() }));
vi.mock('@/server/contour', () => ({ contour: { requireUser: mocks.requireUser, assertCsrf: mocks.assertCsrf } }));
vi.mock('@/server/db', () => ({ cloudDb: () => ({}) }));
vi.mock('@/server/env', () => ({ env: { appUrl: 'https://cloud.example' } }));
vi.mock('@/server/link-flow', () => ({ beginLink: mocks.beginLink }));
vi.mock('@/server/rate-limit', () => ({ rateLimit: mocks.rateLimit }));
function request() {
  return new Request('https://cloud.example/link/start', { method: 'POST', headers: { Origin: 'https://cloud.example' }, body: new URLSearchParams({ project: 'project-id', csrf_token: 'session-csrf' }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockReset().mockResolvedValue({ subjectId: 'consumer-id', sessionId: 'auth-session' });
  mocks.assertCsrf.mockReset(); mocks.rateLimit.mockReset();
  mocks.beginLink.mockReset().mockResolvedValue('https://acme.example/authorize?state=random');
});
describe('browser link continuation', () => {
  it('checks CSRF and rate limits before starting a session-bound link', async () => {
    const response = await POST(request());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://acme.example/authorize?state=random');
    expect(mocks.assertCsrf.mock.calls[0][0].headers.get('x-contour-csrf')).toBe('session-csrf');
    expect(mocks.rateLimit).toHaveBeenCalledWith('consumer-id', 'link');
    expect(mocks.beginLink).toHaveBeenCalledWith(expect.any(Object), 'consumer-id', 'project-id', 'auth-session');
  });
  it('returns the designed rate-limit state without starting another link', async () => {
    mocks.rateLimit.mockImplementation(() => { throw { code: 'RATE_LIMITED' }; });
    const response = await POST(request());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://cloud.example/projects?error=RATE_LIMITED');
    expect(response.headers.get('retry-after')).toBe('60');
    expect(mocks.beginLink).not.toHaveBeenCalled();
  });
  it('returns expired CSRF to a permission state without spending a rate-limit attempt', async () => {
    mocks.assertCsrf.mockImplementation(() => { throw new ContourError('FORBIDDEN', 'Missing or invalid CSRF token'); });
    const response = await POST(request());
    expect(response.headers.get('location')).toBe('https://cloud.example/projects?error=permission');
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.beginLink).not.toHaveBeenCalled();
  });
  it('returns an expired sign-in to Login without rendering raw API errors', async () => {
    mocks.requireUser.mockRejectedValue(new ContourError('UNAUTHENTICATED', 'Sign in required'));
    const response = await POST(request());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://cloud.example/login?next=%2Fprojects');
    expect(mocks.beginLink).not.toHaveBeenCalled();
  });
});
