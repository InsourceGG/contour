import { userClient } from "@/server/supabase";
import { checkAuthCsrf } from "@/server/auth-csrf";
import { go, safeNext } from "@/server/forms";
import { env } from "@/server/env";
export async function POST(request: Request) {
  const form = await request.formData();
  const next = safeNext(form.get("next"));
  if (!(await checkAuthCsrf(request, form))) return go("/login?error=permission");
  const email = String(form.get("email") ?? "").trim();
  if (!email) return go("/login?error=fields");
  const { error } = await (await userClient()).auth.signInWithOtp({ email, options: {
    shouldCreateUser: false, emailRedirectTo: `${env.appUrl}/auth/callback?next=${encodeURIComponent(next)}`,
  } });
  return go(`/login?${error ? "error=magic" : "sent=magic"}&next=${encodeURIComponent(next)}`);
}
