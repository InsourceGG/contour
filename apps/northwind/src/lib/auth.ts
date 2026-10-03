import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Session } from "@/data/types";

export const SESSION_MAX_AGE = 8 * 60 * 60;
const identity = z.object({ userId: z.string().min(1), email: z.email(), name: z.string().min(1), role: z.enum(["agent", "lead", "admin"]), team: z.string().min(1) });
const payloadSchema = identity.extend({ iat: z.number().int(), exp: z.number().int() });
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key)));
}
/** Hash a password with a unique random salt and scrypt N=16384, r=8, p=1. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$16384$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
/** Compare a password without revealing the matching prefix of its hash. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt" || parts[1] !== "16384" || !/^[a-f0-9]{32}$/.test(parts[2]) || !/^[a-f0-9]{128}$/.test(parts[3])) return false;
  const expected = Buffer.from(parts[3], "hex");
  return timingSafeEqual(await derive(password, parts[2]), expected);
}
/** Sign a bounded session with HMAC-SHA256. Times are Unix seconds. */
export function signSession(session: Session, secret: string, now = Math.floor(Date.now() / 1000)): string {
  if (secret.length < 32) throw new Error("NW_SESSION_SECRET must contain at least 32 characters.");
  const data = identity.parse(session);
  const payload = Buffer.from(JSON.stringify({ ...data, iat: now, exp: now + SESSION_MAX_AGE })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
/** Verify the signature, identity shape, issue time, and expiry of an untrusted cookie. */
export function verifySession(cookie: string, secret: string, now = Math.floor(Date.now() / 1000)): Session | null {
  if (secret.length < 32 || cookie.length > 4096) return null;
  const parts = cookie.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")));
    if (!parsed.success || parsed.data.exp <= now || parsed.data.iat > now || parsed.data.exp - parsed.data.iat !== SESSION_MAX_AGE) return null;
    return identity.parse(parsed.data);
  } catch { return null; }
}
