import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from '../helpers/fake-db';
import { verifyOwnedProject } from '../../src/server/registry';

const verified = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../src/server/verify', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/server/verify')>();
  return { ...actual, verifyProject: verified.call };
});
const owner = 'owner-a';
const id = 'f684ed29-a13c-4613-ae4a-cfbb337b7377';
const metadata = { mcpResource: 'https://acme.example/api/mcp', asIssuer: 'https://acme.example',
  tokenEndpoint: 'https://acme.example/token', authorizationEndpoint: 'https://acme.example/authorize',
  revocationEndpoint: 'https://acme.example/revoke', registrationEndpoint: 'https://acme.example/register' };
const registered = { id, owner_id: owner, status: 'verified', base_url: 'https://acme.example', verify_nonce: 'nonce',
  as_issuer: metadata.asIssuer, mcp_resource: metadata.mcpResource,
  token_endpoint: metadata.tokenEndpoint, revocation_endpoint: metadata.revocationEndpoint };
beforeEach(() => { verified.call.mockReset(); verified.call.mockResolvedValue(metadata); });

describe('registered OAuth binding', () => {
  it.each(['asIssuer', 'mcpResource', 'tokenEndpoint', 'revocationEndpoint'] as const)('refuses changing %s without changing the stored registry', async field => {
    const db = createFakeDb({ projects: [registered] });
    verified.call.mockResolvedValue({ ...metadata, [field]: 'https://replacement.example/endpoint' });
    await expect(verifyOwnedProject(db, owner, id)).rejects.toMatchObject({ code: 'PROJECT_BINDING_CHANGED' });
    expect(db.tables.get('projects')![0]).toEqual(registered);
  });
  it('allows re-verification when its established token destinations remain unchanged', async () => {
    const db = createFakeDb({ projects: [registered] });
    await verifyOwnedProject(db, owner, id);
    expect(db.tables.get('projects')![0]).toMatchObject({ ...registered, authorization_endpoint: metadata.authorizationEndpoint, registration_endpoint: metadata.registrationEndpoint, verified_at: expect.any(String) });
  });
  it('filters verification by the actual owner before contacting the company', async () => {
    const db = createFakeDb({ projects: [registered] });
    await expect(verifyOwnedProject(db, 'other-owner', id)).rejects.toThrow('Project unavailable');
    expect(verified.call).not.toHaveBeenCalled();
  });
  it('does not overwrite a binding that changed during metadata fetching', async () => {
    const db = createFakeDb({ projects: [registered] });
    verified.call.mockImplementation(async () => {
      db.tables.get('projects')![0].token_endpoint = 'https://replacement.example/token';
      return metadata;
    });
    await expect(verifyOwnedProject(db, owner, id)).rejects.toMatchObject({ code: 'PROJECT_BINDING_CHANGED' });
    expect(db.tables.get('projects')![0].token_endpoint).toBe('https://replacement.example/token');
  });
});
