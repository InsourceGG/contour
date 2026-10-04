import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/auth/magic/route";

const mocks = vi.hoisted(() => ({ otp: vi.fn(), csrf: vi.fn() }));
vi.mock("../../src/server/supabase", () => ({ userClient: async () => ({ auth: { signInWithOtp: mocks.otp } }) }));
vi.mock("../../src/server/auth-csrf", () => ({ checkAuthCsrf: mocks.csrf }));
vi.mock("../../src/server/contour", () => ({ contour: {} }));
vi.mock("../../src/server/context", () => ({ resolveHostUser: vi.fn() }));

beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("APP_URL", "https://cloud.example"); mocks.csrf.mockResolvedValue(true); });
afterEach(() => vi.unstubAllEnvs());
function request() {
  const form = new FormData(); form.set("email", "someone@example.com"); form.set("next", "/activity");
  return new Request("https://cloud.example/auth/magic", { method: "POST", body: form });
}
describe("magic-link account privacy", () => {
  it.each([null, { code: "user_not_found", status: 400 }, { code: "signup_disabled", status: 422 },
    { code: "email_not_confirmed", status: 400 }])("returns the same email state for success and account errors: %j", async (error) => {
    mocks.otp.mockResolvedValue({ error });
    const response = await POST(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://cloud.example/login?sent=magic&next=%2Factivity");
    expect(mocks.otp).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ shouldCreateUser: false }) }));
  });
  it.each([{ status: 429 }, { code: "over_email_send_rate_limit", status: 400 },
    { code: "over_request_rate_limit", status: 400 }])("keeps a rate-limit error visible: %j", async (error) => {
    mocks.otp.mockResolvedValue({ error });
    expect((await POST(request())).headers.get("location")).toBe("https://cloud.example/login?error=email-rate&next=%2Factivity");
  });
  it.each([{ status: 500 }, { code: "unexpected_failure", status: 400 },
    { code: "request_timeout", status: 408 }, { name: "AuthRetryableFetchError", status: 0 },
    { code: "email_address_not_authorized", status: 403 }, { code: "otp_disabled", status: 422 }])("keeps a system error visible: %j", async (error) => {
    mocks.otp.mockResolvedValue({ error });
    expect((await POST(request())).headers.get("location")).toBe("https://cloud.example/login?error=magic&next=%2Factivity");
  });
  it("reports a thrown network or configuration failure as a generic system error", async () => {
    mocks.otp.mockRejectedValue(new Error("secret system details"));
    expect((await POST(request())).headers.get("location")).toBe("https://cloud.example/login?error=magic&next=%2Factivity");
  });
  it("rejects failed CSRF before requesting email", async () => {
    mocks.csrf.mockResolvedValue(false);
    expect((await POST(request())).headers.get("location")).toBe("https://cloud.example/login?error=permission");
    expect(mocks.otp).not.toHaveBeenCalled();
  });
});
