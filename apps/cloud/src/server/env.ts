import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const env = {
  get appUrl() { return (process.env.APP_URL ?? "http://localhost:3100").replace(/\/$/, ""); },
  get supabaseUrl() { return required("NEXT_PUBLIC_SUPABASE_URL"); },
  get supabasePublishableKey() { return required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"); },
  get supabaseSecretKey() { return required("SUPABASE_SECRET_KEY"); },
  get csrfSecret() { return required("CONTOUR_CSRF_SECRET"); },
  get mcpResource() { return `${this.appUrl}/api/mcp`; },
};

/** Loopback projects are an explicit opt-in for a local, non-production hub. */
export function allowLocalProjects(): boolean {
  if (process.env.CLOUD_ALLOW_LOCAL_PROJECTS !== "1" || process.env.NODE_ENV === "production") return false;
  try {
    const hostname = new URL(env.appUrl).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch { return false; }
}
