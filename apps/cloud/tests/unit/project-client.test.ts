import { describe, expect, it, vi } from 'vitest';
import { cloudClientDocument, clientIdFor } from '../../src/server/project-client';
import { createFakeDb } from '../helpers/fake-db';
import type { ProjectRecord } from '../../src/server/forward';
import type { FetchJson } from '../../src/server/pinned-fetch';

const project: ProjectRecord = { id: 'f684ed29-a13c-4613-ae4a-cfbb337b7377', name: 'Acme', company: 'Acme',
  mcpResource: 'https://acme.example/api/mcp', asIssuer: 'https://acme.example', tokenEndpoint: 'https://acme.example/token',
  revocationEndpoint: null, registrationEndpoint: 'https://acme.example/register' };
const appUrl = 'http://localhost:3100';
function fixture() {
  return createFakeDb({ projects: [{ id: project.id, status: 'verified', registration_endpoint: project.registrationEndpoint, dcr_client_id: null }] });
}
describe('Cloud OAuth client', () => {
  it('publishes the precise production CIMD metadata', () => {
    expect(cloudClientDocument('https://cloud.example/')).toEqual({ client_id: 'https://cloud.example/oauth/client.json',
      client_name: 'Contour Cloud', redirect_uris: ['https://cloud.example/link/callback'],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' });
  });
  it('uses CIMD in production without a database or request', async () => {
    const fetchJson = vi.fn<FetchJson>();
    expect(await clientIdFor(project, { db: fixture(), fetchJson, appUrl: 'https://cloud.example', mode: 'cimd' })).toBe('https://cloud.example/oauth/client.json');
    expect(fetchJson).not.toHaveBeenCalled();
  });
  it('registers once, stores the project client and uses it on later calls', async () => {
    const db = fixture();
    const fetchJson = vi.fn<FetchJson>(async () => ({ status: 201, json: { client_id: 'dcr-client', redirect_uris: [`${appUrl}/link/callback`], token_endpoint_auth_method: 'none' }, headers: new Headers() }));
    const deps = { db, fetchJson, appUrl, mode: 'dcr' };
    expect(await Promise.all([clientIdFor(project, deps), clientIdFor(project, deps)])).toEqual(['dcr-client', 'dcr-client']);
    expect(await clientIdFor(project, deps)).toBe('dcr-client');
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(db.tables.get('projects')![0].dcr_client_id).toBe('dcr-client');
    const [, init] = fetchJson.mock.calls[0];
    expect(init).toMatchObject({ method: 'POST', maxBytes: 262144, timeoutMs: 8000 });
    expect(JSON.parse(init.body!)).toMatchObject({ client_name: 'Contour Cloud', redirect_uris: [`${appUrl}/link/callback`] });
    expect(JSON.parse(init.body!)).not.toHaveProperty('client_id');
  });
  it.each([{ client_id: 'bad', redirect_uris: ['https://other.example'] }, { client_id: 'secret', client_secret: 'secret', redirect_uris: [`${appUrl}/link/callback`] }])('rejects a mismatched or confidential registration', async json => {
    const fetchJson: FetchJson = async () => ({ status: 201, json, headers: new Headers() });
    await expect(clientIdFor(project, { db: fixture(), fetchJson, appUrl, mode: 'dcr' })).rejects.toMatchObject({ code: 'PROJECT_UNAVAILABLE' });
  });
});
