import { handleConsentDecision } from "@/server/oauth/consent";

/**
 * Consent decision (Approve / Deny) from /oauth/authorize. Same-origin +
 * session-bound CSRF token; every authorization parameter is re-validated
 * server-side before a grant or code is created.
 */
export async function POST(request: Request) {
  return handleConsentDecision(request);
}
