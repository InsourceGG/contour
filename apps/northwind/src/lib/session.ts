import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { hashPassword, SESSION_MAX_AGE, signSession, verifyPassword, verifySession } from "./auth";
import type { Session } from "@/data/types";
const COOKIE = "nw_session";
const secret = () => {
  const value = process.env.NW_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("NW_SESSION_SECRET must contain at least 32 characters.");
  return value;
};
const cookieOptions = () => ({ httpOnly: true, secure: process.env.APP_URL?.startsWith("https://") ?? false, sameSite: "lax" as const, path: "/", maxAge: SESSION_MAX_AGE });
const userToSession = (user: { id: string; email: string; name: string; role: Session["role"]; team: string }): Session => ({ userId: user.id, email: user.email, name: user.name, role: user.role, team: user.team });
// A matching-cost fallback avoids a fast hashless path for unknown addresses.
let dummyHash: Promise<string> | undefined;
/** Authenticate against Northwind's own users, returning only the session identity. */
export async function authenticate(email: string, password: string): Promise<Session | null> {
  const { data, error } = await getDb().from("users").select("id,email,name,role,team,password_hash").eq("email", email.trim().toLowerCase()).maybeSingle();
  if (error) throw new Error("Unable to sign in right now.");
  dummyHash ??= hashPassword("northwind-invalid-identity");
  const valid = await verifyPassword(password, data?.password_hash ?? await dummyHash);
  return data && valid ? userToSession(data) : null;
}
/** Read a verified cookie and recheck its current identity to honor role/team changes. */
export async function getSession(): Promise<Session | null> {
  const cookie = (await cookies()).get(COOKIE)?.value;
  if (!cookie) return null;
  const session = verifySession(cookie, secret());
  if (!session) return null;
  const { data, error } = await getDb().from("users").select("id,email,name,role,team").eq("id", session.userId).maybeSingle();
  if (error) throw new Error("Unable to load your account right now.");
  return data ? userToSession(data) : null;
}
/** Require authentication in a server-rendered page. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
/** Set the HttpOnly session from a route handler after authentication. */
export async function createSession(session: Session): Promise<void> {
  (await cookies()).set(COOKIE, signSession(session, secret()), cookieOptions());
}
/** Expire the session cookie from a route handler. */
export async function clearSession(): Promise<void> {
  (await cookies()).set(COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}
