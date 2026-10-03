import { userClient } from "@/server/supabase";
import { go, safeNext } from "@/server/forms";
export async function GET(request: Request) {
  const url = new URL(request.url), code = url.searchParams.get("code");
  if (code) {
    const { error } = await (await userClient()).auth.exchangeCodeForSession(code);
    if (!error) return go(safeNext(url.searchParams.get("next")));
  }
  return go("/login?error=expired");
}
