import { authenticatedForm, formFailure, go } from "@/server/forms";
import { userClient } from "@/server/supabase";
export async function POST(request: Request) {
  try { await authenticatedForm(request); await (await userClient()).auth.signOut({ scope: "local" }); return go("/"); }
  catch (error) { return formFailure(error, "/projects"); }
}
