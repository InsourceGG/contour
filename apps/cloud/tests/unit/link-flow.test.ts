import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beginLink, finishLink } from '../../src/server/link-flow';
import { createFakeDb } from '../helpers/fake-db';
import type { FetchJson } from '../../src/server/pinned-fetch';

const user = 'be8e43f1-8cf2-42d9-b9b2-3fae27d108a9';
const id = 'f684ed29-a13c-4613-ae4a-cfbb337b7377';
const project = { id, status: 'verified', name: 'Operations', company: 'Acme', description: '',
  mcp_resource: 'https://acme.example/api/mcp', as_issuer: 'https://acme.example', token_endpoint: 'https://acme.example/token',
  authorization_endpoint: 'https://acme.example/authorize', revocation_endpoint: null };
function fixture() { return createFakeDb({ projects: [project] }); }
const appUrl = 'https://cloud.example';
const clientIdFor = async () => `${appUrl}/oauth/client.json`;
beforeEach(() => { vi.stubEnv('CLOUD_VAULT_KEY', Buffer.alloc(32, 42).toString('base64')); vi.stubEnv('CLOUD_VAULT_KEY_ID', 'test'); });
describe('link flow', () => {
  it('creates a user-bound PKCE state and resource-bound authorization URL', async () => {
    const db = fixture();
    const url = new URL(await beginLink({ db, appUrl, clientIdFor }, user, id));
    expect(url.origin + url.pathname).toBe(project.authorization_endpoint);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', client_id: `${appUrl}/oauth/client.json`,
      redirect_uri: `${appUrl}/link/callback`, scope: 'view:read data:read view:propose', resource: project.mcp_resource, code_challenge_method: 'S256' });
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    expect(db.tables.get('link_states')![0]).toMatchObject({ contour_user: user, project_id: id });
    expect(db.tables.get('link_states')![0].verifier_ct).not.toBe(url.searchParams.get('code_challenge'));
  });
  it('exchanges, encrypts and audits, then rejects replay before making a second request', async () => {
    const db = fixture();
    const start = new URL(await beginLink({ db, appUrl, clientIdFor }, user, id));
    const fetchJson = vi.fn<FetchJson>(async () => ({ status: 200, json: { access_token: 'access-secret', refresh_token: 'refresh-secret', token_type: 'Bearer', expires_in: 300, scope: 'view:read data:read view:propose' }, headers: new Headers() }));
    const callback = new URL(`${appUrl}/link/callback?code=code&state=${start.searchParams.get('state')}&iss=${encodeURIComponent(project.as_issuer)}`);
    expect(await finishLink({ db, appUrl, clientIdFor, fetchJson }, user, callback)).toBe(`/projects?linked=${id}`);
    const [endpoint, init] = fetchJson.mock.calls[0];
    expect(endpoint).toBe(project.token_endpoint);
    expect(init).toMatchObject({ method: 'POST', maxBytes: 262144, timeoutMs: 8000 });
    expect(Object.fromEntries(new URLSearchParams(init.body))).toMatchObject({ grant_type: 'authorization_code', code: 'code', resource: project.mcp_resource, redirect_uri: `${appUrl}/link/callback` });
    expect(db.tables.get('links')![0]).toMatchObject({ contour_user: user, project_id: id, status: 'active' });
    expect(JSON.stringify(db.tables.get('links'))).not.toContain('refresh-secret');
    expect(db.tables.get('audit_events')![0]).toMatchObject({ contour_user: user, project_id: id, kind: 'project_linked' });
    await expect(finishLink({ db, appUrl, clientIdFor, fetchJson }, user, callback)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
  it('rejects another user and a mismatched issuer before any exchange', async () => {
    const db = fixture();
    const start = new URL(await beginLink({ db, appUrl, clientIdFor }, user, id));
    const fetchJson = vi.fn<FetchJson>();
    const callback = new URL(`${appUrl}/link/callback?code=code&state=${start.searchParams.get('state')}&iss=https://other.example`);
    await expect(finishLink({ db, appUrl, clientIdFor, fetchJson }, 'other-user', callback)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(finishLink({ db, appUrl, clientIdFor, fetchJson }, user, callback)).rejects.toMatchObject({ code: 'ISSUER_MISMATCH' });
    expect(fetchJson).not.toHaveBeenCalled();
  });
  it('consumes denied consent state and records no grant', async () => {
    const db = fixture();
    const start = new URL(await beginLink({ db, appUrl, clientIdFor }, user, id));
    const callback = new URL(`${appUrl}/link/callback?error=access_denied&state=${start.searchParams.get('state')}`);
    expect(await finishLink({ db, appUrl, clientIdFor }, user, callback)).toBe(`/projects?declined=${id}`);
    expect(db.tables.get('links') ?? []).toHaveLength(0);
    await expect(finishLink({ db, appUrl, clientIdFor }, user, callback)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
  it('requires the same auth session across browser linking, even for the same consumer', async () => {
    const db = fixture();
    const start = new URL(await beginLink({ db, appUrl, clientIdFor }, user, id, 'original-session'));
    const callback = new URL(`${appUrl}/link/callback?error=access_denied&state=${start.searchParams.get('state')}`);
    await expect(finishLink({ db, appUrl, clientIdFor }, user, callback, 'replacement-session')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await finishLink({ db, appUrl, clientIdFor }, user, callback, 'original-session')).toBe(`/projects?declined=${id}`);
    await expect(finishLink({ db, appUrl, clientIdFor }, user, callback, 'original-session')).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
  it('sanitizes failed exchanges and refuses scopes Cloud cannot request', async () => {
    for (const response of [{ status: 400, json: { error: 'invalid_grant', error_description: 'secret' } },
      { status: 200, json: { access_token: 'secret', refresh_token: 'secret', token_type: 'Bearer', expires_in: 300, scope: 'view:read view:commit' } }]) {
      const db = fixture();
      const start = new URL(await beginLink({ db, appUrl, clientIdFor }, user, id));
      const fetchJson: FetchJson = async () => ({ ...response, headers: new Headers() });
      const callback = new URL(`${appUrl}/link/callback?code=code&state=${start.searchParams.get('state')}`);
      const error = await finishLink({ db, appUrl, clientIdFor, fetchJson }, user, callback).catch(error => error);
      expect(error.message).not.toContain('secret');
      expect(db.tables.get('links') ?? []).toHaveLength(0);
    }
  });
});
