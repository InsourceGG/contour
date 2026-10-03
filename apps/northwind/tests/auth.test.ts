import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, signSession, verifySession } from "../src/lib/auth";
import type { Session } from "../src/data/types";
const secret = "test-session-secret-that-is-at-least-32-characters";
const session: Session = { userId: "riley", email: "riley@northwind.demo", name: "Riley Chen", role: "agent", team: "Tier 1" };
describe("passwords", () => {
  it("uses salted scrypt N=16384 and verifies only the right password", async () => {
    const hash = await hashPassword("northwind-demo-2026");
    expect(hash.startsWith("scrypt$16384$")).toBe(true);
    expect(await verifyPassword("northwind-demo-2026", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await hashPassword("northwind-demo-2026")).not.toBe(hash);
  });
  it("rejects malformed hashes", async () => {
    expect(await verifyPassword("password", "scrypt$999999$bad$bad")).toBe(false);
  });
});
describe("signed sessions", () => {
  it("round trips a valid identity", () => {
    const cookie = signSession(session, secret, 1000);
    expect(verifySession(cookie, secret, 1001)).toEqual(session);
  });
  it("rejects tampered identity, signature, secret, and expired cookies", () => {
    const cookie = signSession(session, secret, 1000);
    const [payload, signature] = cookie.split(".");
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), role: "admin" })).toString("base64url");
    expect(verifySession(`${changed}.${signature}`, secret, 1001)).toBeNull();
    expect(verifySession(`${payload}.${signature.slice(0, -1)}A`, secret, 1001)).toBeNull();
    expect(verifySession(cookie, "other-secret-with-at-least-32-characters", 1001)).toBeNull();
    expect(verifySession(cookie, secret, 1000 + 8 * 60 * 60)).toBeNull();
    expect(verifySession("invalid", secret, 1001)).toBeNull();
  });
});
