import { afterEach, describe, expect, it, vi } from "vitest";
import { allowLocalProjects } from "../../src/server/env";

afterEach(() => vi.unstubAllEnvs());

describe("local project opt-in", () => {
  it.each([
    ["1", "development", "http://localhost:3100", true],
    ["1", "test", "http://127.0.0.1:3100", true],
    ["1", "production", "http://localhost:3100", false],
    ["1", "production", "http://127.0.0.1:3100", false],
    ["1", "development", "https://cloud.example", false],
    ["1", "development", "http://localhost.evil.example", false],
    ["1", "development", "invalid-url", false],
    ["0", "development", "http://localhost:3100", false],
    ["true", "development", "http://localhost:3100", false],
  ])("flag %s, environment %s, Cloud URL %s permits local projects: %s", (flag, mode, url, allowed) => {
    vi.stubEnv("CLOUD_ALLOW_LOCAL_PROJECTS", flag);
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("APP_URL", url);
    expect(allowLocalProjects()).toBe(allowed);
  });
});
