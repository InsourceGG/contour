import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
async function limiter() { return import('../../src/server/rate-limit'); }

describe('consumer mutation rate limits', () => {
  it('allows ten link attempts per user and blocks the next one', async () => {
    const { rateLimit, RateLimitError } = await limiter();
    for (let attempt = 0; attempt < 10; attempt++) expect(() => rateLimit('consumer-a', 'link', 0)).not.toThrow();
    expect(() => rateLimit('consumer-a', 'link', 1)).toThrow(RateLimitError);
    expect(() => rateLimit('consumer-a', 'link', 59_999)).toThrow(RateLimitError);
  });

  it('keeps different users and different actions independent', async () => {
    const { rateLimit, RateLimitError } = await limiter();
    for (let attempt = 0; attempt < 5; attempt++) rateLimit('consumer-a', 'verify', 0);
    expect(() => rateLimit('consumer-a', 'verify', 0)).toThrow(RateLimitError);
    expect(() => rateLimit('consumer-b', 'verify', 0)).not.toThrow();
    expect(() => rateLimit('consumer-a', 'link', 0)).not.toThrow();
  });

  it('opens a fresh window exactly at the expiry boundary', async () => {
    const { rateLimit, RateLimitError } = await limiter();
    for (let attempt = 0; attempt < 5; attempt++) rateLimit('consumer-a', 'verify', 123);
    expect(() => rateLimit('consumer-a', 'verify', 60_122)).toThrow(RateLimitError);
    expect(() => rateLimit('consumer-a', 'verify', 60_123)).not.toThrow();
    for (let attempt = 0; attempt < 4; attempt++) rateLimit('consumer-a', 'verify', 60_123);
    expect(() => rateLimit('consumer-a', 'verify', 60_123)).toThrow(RateLimitError);
  });

  it('refuses new windows when capacity is full without evicting active user limits', async () => {
    const { rateLimit, RateLimitError } = await limiter();
    for (let attempt = 0; attempt < 5; attempt++) rateLimit('existing-consumer', 'verify', 0);
    for (let user = 0; user < 9_999; user++) rateLimit(`consumer-${user}`, 'verify', 0);
    expect(() => rateLimit('overflow-consumer', 'verify', 1)).toThrow(RateLimitError);
    expect(() => rateLimit('existing-consumer', 'verify', 1)).toThrow(RateLimitError);
    // Expired windows can be reclaimed without retaining old identities.
    expect(() => rateLimit('overflow-consumer', 'verify', 60_000)).not.toThrow();
  });
});

it('caps MCP calls per consumer and per consumer/project independently', async () => {
  const { rateLimit } = await import('../../src/server/rate-limit');
  const now = Date.now() + 10_000_000;
  for (let i = 0; i < 120; i++) rateLimit('mcp-limit-user', 'mcp', now);
  expect(() => rateLimit('mcp-limit-user', 'mcp', now)).toThrow('Too many attempts');
  for (let i = 0; i < 60; i++) rateLimit('project-limit-user:project-a', 'project', now);
  expect(() => rateLimit('project-limit-user:project-a', 'project', now)).toThrow('Too many attempts');
  expect(() => rateLimit('project-limit-user:project-b', 'project', now)).not.toThrow();
});
