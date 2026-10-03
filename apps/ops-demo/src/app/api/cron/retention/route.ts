import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { adminClient } from "@/server/supabase";

/** Daily retention job (Vercel Cron). Requires the CRON_SECRET bearer that
 *  Vercel sends; no user or agent can trigger it. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data, error } = await adminClient().rpc("contour_retention");
  if (error) return NextResponse.json({ error: "retention failed" }, { status: 500 });
  return NextResponse.json({ ok: true, ...(data as object) });
}
