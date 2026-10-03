/** Only same-origin relative paths are followed after sign-in ("/x", never "//host" or "/\host"). */
export function safeNextPath(raw: unknown): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string" || v.length > 2048) return "/";
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f]/.test(v)) return "/";
  return v;
}
