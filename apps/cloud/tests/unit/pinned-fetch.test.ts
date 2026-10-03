import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), https: vi.fn(), http: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.https }));
vi.mock("node:http", () => ({ request: mocks.http }));
import { pinnedFetchJson } from "../../src/server/pinned-fetch";

const init = { maxBytes: 100, timeoutMs: 1000 };
let status: number;
let chunks: Buffer[];
let headers: Record<string, string>;
let request: EventEmitter & { end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
function transport(_url: URL, _options: unknown, callback: (response: unknown) => void) {
  request = Object.assign(new EventEmitter(), {
    end: vi.fn(() => queueMicrotask(() => {
      const response = Object.assign(new EventEmitter(), { statusCode: status, headers, destroy: vi.fn() });
      callback(response);
      for (const chunk of chunks) response.emit("data", chunk);
      response.emit("end");
    })),
    destroy: vi.fn((error: Error) => { request.emit("error", error); return request; }),
  });
  return request;
}
beforeEach(() => {
  vi.resetAllMocks();
  status = 200;
  chunks = [Buffer.from('{"ok":true}')];
  headers = { "content-type": "application/json" };
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocks.https.mockImplementation(transport);
  mocks.http.mockImplementation(transport);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("pinnedFetchJson", () => {
  it("resolves once, pins the socket address and preserves TLS hostname and response headers", async () => {
    const response = await pinnedFetchJson("https://project.example/api/mcp", { ...init, method: "POST", headers: { Authorization: "Bearer token" }, body: "{}" });
    expect(response.json).toEqual({ ok: true });
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    const options = mocks.https.mock.calls[0][1];
    expect(options).toMatchObject({ method: "POST", servername: "project.example", headers: { Authorization: "Bearer token" } });
    const callback = vi.fn();
    options.lookup("project.example", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    const allCallback = vi.fn();
    options.lookup("project.example", { all: true }, allCallback);
    expect(allCallback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
    expect(request.end).toHaveBeenCalledWith("{}");
  });
  it.each([
    "0.0.0.0", "10.1.2.3", "127.0.0.1", "100.64.0.1", "169.254.169.254", "172.16.0.1", "192.168.0.1", "224.1.1.1",
    "::", "::1", "0:0:0:0:0:0:0:1", "fc00::1", "fe80::1", "0:0:0:0:0:ffff:7f00:1", "::ffff:127.0.0.1", "::ffff:a00:1", "64:ff9b::7f00:1", "ff02::1", "2001:db8::1",
  ])("rejects private or reserved address %s without making a request", async (address) => {
    mocks.lookup.mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
    await expect(pinnedFetchJson("https://project.example/doc", init)).rejects.toThrow();
    expect(mocks.https).not.toHaveBeenCalled();
  });
  it("rejects a mixed public/private DNS answer", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    await expect(pinnedFetchJson("https://project.example/doc", init)).rejects.toThrow();
    expect(mocks.https).not.toHaveBeenCalled();
  });
  it.each([{ addresses: [] }, { addresses: [{ address: "127.0.0.1", family: 6 }] }, { addresses: [{ address: "not-an-IP", family: 4 }] }])("rejects empty or malformed DNS answers %j", async ({ addresses }) => {
    mocks.lookup.mockResolvedValue(addresses);
    await expect(pinnedFetchJson("https://project.example/doc", init)).rejects.toThrow();
    expect(mocks.https).not.toHaveBeenCalled();
  });
  it.each(["http://project.example", "https://user:secret@project.example", "https://project.example/#", "file:///doc"])("rejects unsafe URL %s", async (url) => {
    await expect(pinnedFetchJson(url, init)).rejects.toThrow();
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.https).not.toHaveBeenCalled();
  });
  it("rejects private IP literals without consulting DNS", async () => {
    await expect(pinnedFetchJson("https://[0:0:0:0:0:ffff:7f00:1]/doc", init)).rejects.toThrow();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("permits public IPv6", async () => {
    mocks.lookup.mockResolvedValue([{ address: "2606:4700:4700::1111", family: 6 }]);
    expect((await pinnedFetchJson("https://project.example/doc", init)).status).toBe(200);
  });
  it("pins public IP literals without DNS", async () => {
    expect((await pinnedFetchJson("https://93.184.216.34/doc", init)).status).toBe(200);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("rejects redirects without following them", async () => {
    status = 302;
    headers.location = "https://other.example";
    await expect(pinnedFetchJson("https://project.example/doc", init)).rejects.toThrow();
    expect(mocks.https).toHaveBeenCalledTimes(1);
  });
  it("caps streaming bytes", async () => {
    chunks = [Buffer.alloc(60), Buffer.alloc(60)];
    await expect(pinnedFetchJson("https://project.example/doc", init)).rejects.toThrow();
    expect(request.destroy).toHaveBeenCalled();
  });
  it("rejects a declared oversized body", async () => {
    headers["content-length"] = "101";
    await expect(pinnedFetchJson("https://project.example/doc", init)).rejects.toThrow();
  });
  it("rejects invalid JSON with generic errors", async () => {
    chunks = [Buffer.from("Bearer secret")];
    const error = await pinnedFetchJson("https://project.example/doc", init).catch(e => e);
    expect(error.message).toBe("Invalid project JSON response");
    expect(error.message).not.toContain("secret");
  });
  it("includes DNS time in the timeout and never requests after it expires", async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    mocks.lookup.mockReturnValue(new Promise(r => { resolve = r; }));
    const rejected = pinnedFetchJson("https://project.example/doc", init).catch(error => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await rejected).message).toContain("timed out");
    resolve([{ address: "93.184.216.34", family: 4 }]);
    await Promise.resolve();
    expect(mocks.https).not.toHaveBeenCalled();
  });
  it("times out stalled response streams", async () => {
    vi.useFakeTimers();
    mocks.https.mockImplementation(() => {
      request = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn((error: Error) => request.emit("error", error)) });
      return request;
    });
    const rejected = pinnedFetchJson("https://project.example/doc", init).catch(error => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await rejected).message).toContain("timed out");
    expect(request.destroy).toHaveBeenCalled();
  });
  it("allows only explicitly enabled literal http localhost with a fixed loopback pin", async () => {
    vi.stubEnv("CLOUD_ALLOW_LOCAL_PROJECTS", "1");
    expect((await pinnedFetchJson("http://localhost:3000/doc", init)).status).toBe(200);
    expect(mocks.lookup).not.toHaveBeenCalled();
    const callback = vi.fn();
    mocks.http.mock.calls[0][1].lookup("localhost", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "127.0.0.1", 4);
    await expect(pinnedFetchJson("http://127.0.0.1:3000/doc", init)).rejects.toThrow();
    await expect(pinnedFetchJson("http://localhost.evil.example/doc", init)).rejects.toThrow();
    await expect(pinnedFetchJson("https://localhost:3000/doc", init)).resolves.toMatchObject({ status: 200 });
    // HTTPS gets the standard public-address validation even with local HTTP
    // enabled; this mock deliberately returns a public address for localhost.
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(pinnedFetchJson("https://localhost:3000/doc", init)).rejects.toThrow();
  });
  it("suppresses transport error details", async () => {
    mocks.lookup.mockRejectedValue(new Error("Bearer secret"));
    const error = await pinnedFetchJson("https://project.example/doc", init).catch(e => e);
    expect(error.message).not.toContain("secret");
  });
});
