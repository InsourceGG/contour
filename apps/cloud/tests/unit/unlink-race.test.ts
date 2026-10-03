import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, type FakeCloudDb } from '../helpers/fake-db';
import { POST } from '../../src/app/projects/unlink/route';

const mocks = vi.hoisted(() => ({ db: null as FakeCloudDb | null, fetch: vi.fn(), user: 'consumer-a', projectId: 'f684ed29-a13c-4613-ae4a-cfbb337b7377' }));
vi.mock('@/server/db', () => ({ cloudDb: () => mocks.db }));
vi.mock('@/server/forms', () => ({
  authenticatedForm: async () => ({ user: { subjectId: mocks.user }, form: new URLSearchParams({ project_id: mocks.projectId }) }),
  go: (path: string) => Response.redirect(new URL(path, 'https://cloud.example'), 303),
  formFailure: () => new Response('Request failed', { status: 500 }),
}));
vi.mock('@/server/pinned-fetch', () => ({ pinnedFetchJson: mocks.fetch }));
vi.mock('@/server/vault', () => ({ decrypt: () => 'dummy-refresh-token' }));
vi.mock('@/server/project-client', () => ({ clientIdFor: async () => 'stored-client' }));

const project = { id: mocks.projectId, name: 'Operations', company: 'Acme', status: 'disabled',
  verified_at: '2026-10-03T00:00:00Z', mcp_resource: 'https://acme.example/api/mcp', as_issuer: 'https://acme.example',
  token_endpoint: 'https://acme.example/token', revocation_endpoint: 'https://acme.example/revoke', dcr_client_id: 'stored-client' };
const link = { contour_user: mocks.user, project_id: mocks.projectId, refresh_ct: 'original-ciphertext', key_id: 'test' };
function fixture() { return createFakeDb({ projects: [project], links: [link, { ...link, contour_user: 'other-consumer' }] }); }
beforeEach(() => { mocks.db = fixture(); mocks.fetch.mockReset(); mocks.fetch.mockResolvedValue({ status: 200, json: {}, headers: new Headers() }); });

describe('unlink grant ownership and races', () => {
  it('revokes a caller-owned disabled project and deletes only this consumer connection', async () => {
    const response = await POST(new Request('https://cloud.example/projects/unlink', { method: 'POST' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`https://cloud.example/projects?unlinked=${mocks.projectId}`);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls[0][0]).toBe(project.revocation_endpoint);
    expect(Object.fromEntries(new URLSearchParams(mocks.fetch.mock.calls[0][1].body))).toMatchObject({ token: 'dummy-refresh-token', client_id: 'stored-client', token_type_hint: 'refresh_token' });
    expect(mocks.db!.tables.get('links')).toEqual([{ ...link, contour_user: 'other-consumer' }]);
    expect(mocks.db!.tables.get('audit_events')![0]).toMatchObject({ contour_user: mocks.user, kind: 'project_unlinked' });
  });
  it('preserves a newer relink created while remote revocation is in progress', async () => {
    mocks.fetch.mockImplementation(async () => {
      mocks.db!.tables.get('links')![0].refresh_ct = 'replacement-ciphertext';
      return { status: 200, json: {}, headers: new Headers() };
    });
    const response = await POST(new Request('https://cloud.example/projects/unlink', { method: 'POST' }));
    expect(response.headers.get('location')).toBe('https://cloud.example/projects?error=changed');
    expect(mocks.db!.tables.get('links')![0].refresh_ct).toBe('replacement-ciphertext');
    expect(mocks.db!.tables.get('audit_events') ?? []).toHaveLength(0);
  });
  it('removes Cloud access after a company outage and reports unconfirmed revocation', async () => {
    mocks.fetch.mockRejectedValue(new Error('upstream details'));
    const response = await POST(new Request('https://cloud.example/projects/unlink', { method: 'POST' }));
    expect(response.headers.get('location')).toBe(`https://cloud.example/projects?unlinked=${mocks.projectId}&revocation=unconfirmed`);
    expect(mocks.db!.tables.get('links')).toEqual([{ ...link, contour_user: 'other-consumer' }]);
  });
  it('does not contact the company for a project another consumer owns', async () => {
    mocks.db!.tables.set('links', [{ ...link, contour_user: 'other-consumer' }]);
    const response = await POST(new Request('https://cloud.example/projects/unlink', { method: 'POST' }));
    expect(response.headers.get('location')).toBe('https://cloud.example/projects?error=not-found');
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.db!.tables.get('links')).toHaveLength(1);
  });
});
