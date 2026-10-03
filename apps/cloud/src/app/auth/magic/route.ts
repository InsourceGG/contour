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
  let state = "sent=magic";
  try {
    const { error } = await (await userClient()).auth.signInWithOtp({ email, options: {
      shouldCreateUser: false, emailRedirectTo: `${env.appUrl}/auth/callback?next=${encodeURIComponent(next)}`,
    } });
    if (error?.status === 429 || ["over_email_send_rate_limit", "over_request_rate_limit"].includes(error?.code ?? "")) {
      state = "error=email-rate";
    } else if (error && ((error.status ?? 0) >= 500 || error.name === "AuthRetryableFetchError" ||
      ["unexpected_failure", "request_timeout", "email_address_not_authorized", "email_provider_disabled", "otp_disabled", "provider_disabled", "hook_timeout", "hook_timeout_after_retry"].includes(error.code ?? ""))) {
      state = "error=magic";
    }
  } catch { state = "error=magic"; }
  return go(`/login?${state}&next=${encodeURIComponent(next)}`);
}
