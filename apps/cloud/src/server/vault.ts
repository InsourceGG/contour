import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type VaultKeys = {
  current: { id: string; key: Buffer };
  previous?: { id: string; key: Buffer }[];
};

function resolveKeys(keys?: VaultKeys): VaultKeys {
  if (!keys) {
    const encoded = process.env.CLOUD_VAULT_KEY;
    const id = process.env.CLOUD_VAULT_KEY_ID;
    if (!encoded || !id || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
      throw new Error('Invalid vault key configuration');
    }
    keys = { current: { id, key: Buffer.from(encoded, 'base64') } };
  }
  const all = [keys.current, ...(keys.previous ?? [])];
  if (all.some(({ id, key }) => !id || !Buffer.isBuffer(key) || key.length !== 32) ||
      new Set(all.map(({ id }) => id)).size !== all.length) {
    throw new Error('Invalid vault key configuration');
  }
  return keys;
}

export function encrypt(plaintext: string, keys?: VaultKeys): { ct: string; keyId: string } {
  const { current } = resolveKeys(keys);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', current.key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ct: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url'), keyId: current.id };
}

export function decrypt(ct: string, keyId: string, keys?: VaultKeys): string {
  const resolved = resolveKeys(keys);
  const selected = [resolved.current, ...(resolved.previous ?? [])].find(({ id }) => id === keyId);
  if (!selected) throw new Error('Unknown vault key ID');
  if (!/^[A-Za-z0-9_-]+$/.test(ct)) throw new Error('Invalid vault ciphertext');
  const bytes = Buffer.from(ct, 'base64url');
  if (bytes.length < 28 || bytes.toString('base64url') !== ct) throw new Error('Invalid vault ciphertext');
  try {
    const decipher = createDecipheriv('aes-256-gcm', selected.key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Invalid vault ciphertext');
  }
}
