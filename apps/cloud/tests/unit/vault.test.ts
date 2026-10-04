import { afterEach, describe, expect, it, vi } from 'vitest';
import { decrypt, encrypt, type VaultKeys } from '../../src/server/vault.js';
const keys: VaultKeys = { current: { id: 'k1', key: Buffer.alloc(32, 1) } };
afterEach(() => vi.unstubAllEnvs());
describe('vault', () => {
  it('round-trips Unicode and empty text with fresh IVs', () => {
    for (const value of ['', 'secret 🌲']) {
      const a = encrypt(value, keys);
      expect(a.keyId).toBe('k1');
      expect(decrypt(a.ct, a.keyId, keys)).toBe(value);
      expect(encrypt(value, keys).ct).not.toBe(a.ct);
      expect(Buffer.from(a.ct, 'base64url').length).toBe(28 + Buffer.byteLength(value));
    }
  });
  it('rejects ciphertext tampering', () => {
    const { ct, keyId } = encrypt('secret', keys);
    const bytes = Buffer.from(ct, 'base64url');
    bytes[bytes.length - 1]! ^= 1;
    expect(() => decrypt(bytes.toString('base64url'), keyId, keys)).toThrow();
  });
  it('rejects unknown key IDs', () => {
    const { ct } = encrypt('secret', keys);
    expect(() => decrypt(ct, 'unknown', keys)).toThrow();
  });
  it('decrypts with a previous key after rotation', () => {
    const old = encrypt('before rotation', keys);
    const rotated = { current: { id: 'k2', key: Buffer.alloc(32, 2) }, previous: [keys.current] };
    expect(decrypt(old.ct, old.keyId, rotated)).toBe('before rotation');
    expect(encrypt('after rotation', rotated).keyId).toBe('k2');
  });
  it('uses environment keys and rejects malformed key configuration', () => {
    vi.stubEnv('CLOUD_VAULT_KEY', Buffer.alloc(32, 3).toString('base64'));
    vi.stubEnv('CLOUD_VAULT_KEY_ID', 'env-key');
    const value = encrypt('env secret');
    expect(decrypt(value.ct, value.keyId)).toBe('env secret');
    vi.stubEnv('CLOUD_VAULT_KEY', 'short');
    expect(() => encrypt('secret')).toThrow();
  });
});
