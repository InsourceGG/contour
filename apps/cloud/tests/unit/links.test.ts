import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from '../helpers/fake-db.js';
import { decrypt } from '../../src/server/vault.js';
import { createLinkState, consumeLinkState, upsertLink, getActiveLink, listLinks, markLink, deleteLink } from '../../src/server/links.js';
const contourUser = '3e9397e6-39db-441b-9ca6-aa0d6e1c669b';
const projectId = 'c233f5d5-3853-4b01-9a75-ff51ee2671e1';
beforeEach(() => {
  vi.stubEnv('CLOUD_VAULT_KEY', Buffer.alloc(32, 1).toString('base64'));
  vi.stubEnv('CLOUD_VAULT_KEY_ID', 'k1');
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe('link state', () => {
  it('returns random state and verifier, hashed state, encrypted verifier, S256 challenge and ten minute expiry', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    const db = createFakeDb();
    const first = await createLinkState(db, { contourUser, projectId });
    const second = await createLinkState(db, { contourUser, projectId });
    expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.state).not.toBe(second.state);
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).toBe(createHash('sha256').update(first.verifier).digest('base64url'));
    const row = db.tables.get('link_states')![0]!;
    expect(row.state_hash).toBe(createHash('sha256').update(first.state).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(first.state);
    expect(JSON.stringify(row)).not.toContain(first.verifier);
    expect(decrypt(row.verifier_ct, row.key_id)).toBe(first.verifier);
    expect(row.expires_at).toBe('2026-10-03T12:10:00.000Z');
  });
  it('consumes exactly once even for concurrent requests', async () => {
    const db = createFakeDb();
    const created = await createLinkState(db, { contourUser, projectId });
    const results = await Promise.allSettled([consumeLinkState(db, { state: created.state, contourUser }), consumeLinkState(db, { state: created.state, contourUser })]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    const succeeded = results.find(value => value.status === 'fulfilled') as PromiseFulfilledResult<unknown>;
    expect(succeeded.value).toEqual({ projectId, verifier: created.verifier });
    const failed = results.find(value => value.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason.code).toBe('INVALID_STATE');
  });
  it('rejects another user without consuming the original state', async () => {
    const db = createFakeDb(); const created = await createLinkState(db, { contourUser, projectId });
    await expect(consumeLinkState(db, { state: created.state, contourUser: 'another-user' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(consumeLinkState(db, { state: created.state, contourUser })).resolves.toEqual({ projectId, verifier: created.verifier });
  });
  it('rejects expired states at the expiry boundary and unknown states', async () => {
    vi.useFakeTimers(); const db = createFakeDb();
    const created = await createLinkState(db, { contourUser, projectId });
    vi.advanceTimersByTime(600_000);
    await expect(consumeLinkState(db, { state: created.state, contourUser })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(consumeLinkState(db, { state: 'unknown', contourUser })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
describe('links', () => {
  it('encrypts tokens, replaces a grant and clears an omitted access cache', async () => {
    const db = createFakeDb();
    await upsertLink(db, { contourUser, projectId, refreshToken: 'refresh-a', accessToken: 'access-a', accessExpiresAt: '2026-10-03T13:00:00Z', scopes: ['view:read'], subjectHint: 'Jordan' });
    const row = await getActiveLink(db, contourUser, projectId);
    expect(row?.status).toBe('active'); expect(row?.subject_hint).toBe('Jordan');
    expect(JSON.stringify(row)).not.toContain('refresh-a'); expect(JSON.stringify(row)).not.toContain('access-a');
    expect(decrypt(row!.refresh_ct, row!.key_id)).toBe('refresh-a');
    expect(decrypt(row!.access_ct!, row!.key_id)).toBe('access-a');
    await upsertLink(db, { contourUser, projectId, refreshToken: 'refresh-b', scopes: ['view:propose'] });
    expect(db.tables.get('links')).toHaveLength(1);
    const relinked = await getActiveLink(db, contourUser, projectId);
    expect(relinked?.access_ct).toBeNull(); expect(relinked?.access_expires_at).toBeNull(); expect(relinked?.subject_hint).toBeNull();
    expect(decrypt(relinked!.refresh_ct, relinked!.key_id)).toBe('refresh-b');
  });
  it('isolates users and active links when marking and deleting', async () => {
    const db = createFakeDb();
    for (const user of [contourUser, 'other']) await upsertLink(db, { contourUser: user, projectId, refreshToken: 'refresh', scopes: [] });
    await markLink(db, contourUser, projectId, 'needs_reconnect');
    expect(await getActiveLink(db, contourUser, projectId)).toBeNull();
    expect(await getActiveLink(db, 'other', projectId)).not.toBeNull();
    await markLink(db, contourUser, projectId, 'active');
    expect(await getActiveLink(db, contourUser, projectId)).not.toBeNull();
    await deleteLink(db, contourUser, projectId);
    expect(await getActiveLink(db, contourUser, projectId)).toBeNull();
    expect(await getActiveLink(db, 'other', projectId)).not.toBeNull();
  });
  it('lists only the caller links as project summaries without exposing tokens', async () => {
    const db = createFakeDb({ projects: [{ id: projectId, name: 'Acme', company: 'Acme Inc', surfaces: ['overview'] }] });
    await upsertLink(db, { contourUser, projectId, refreshToken: 'refresh', scopes: [] });
    await upsertLink(db, { contourUser: 'other', projectId, refreshToken: 'secret', scopes: [] });
    await markLink(db, contourUser, projectId, 'revoked');
    expect(await listLinks(db, contourUser)).toEqual([{ projectId, name: 'Acme', company: 'Acme Inc', surfaces: ['overview'], status: 'revoked' }]);
  });
  it('sanitizes database failures', async () => {
    const db = { from: () => ({ insert: () => Promise.resolve({ error: { message: 'secret-token' } }) }), rpc: () => Promise.resolve({ error: { message: 'secret-token' } }) };
    await expect(createLinkState(db, { contourUser, projectId })).rejects.toMatchObject({ code: 'DB_ERROR', message: 'Unable to create link state' });
    await expect(consumeLinkState(db, { contourUser, state: 'state' })).rejects.toMatchObject({ code: 'DB_ERROR', message: 'Unable to consume link state' });
  });
});
