import { userClient } from "@/server/supabase";
import { checkAuthCsrf } from "@/server/auth-csrf";
import { go, safeNext } from "@/server/forms";
import { env } from "@/server/env";
export async function POST(request: Request) {
  const form = await request.formData();
  const signup = form.get("mode") === "signup", path = signup ? "/signup" : "/login";
  const next = safeNext(form.get("next"));
  if (!(await checkAuthCsrf(request, form))) return go(`${path}?error=permission`);
  const email = String(form.get("email") ?? "").trim(), password = String(form.get("password") ?? "");
  if (!email || password.length < (signup ? 8 : 1)) return go(`${path}?error=fields&next=${encodeURIComponent(next)}`);
  const supabase = await userClient();
  const result = signup
    ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${env.appUrl}/auth/callback?next=${encodeURIComponent(next)}` } })
    : await supabase.auth.signInWithPassword({ email, password });
  if (result.error) return go(`${path}?error=${result.error.code === "over_email_send_rate_limit" ? "email-rate" : "credentials"}&next=${encodeURIComponent(next)}`);
  if (!result.data.session) return go(`/login?sent=confirmation&next=${encodeURIComponent(next)}`);
  return go(next);
}
