/**
 * E2E-only server preload: adds fixed latency before the REAL selector call so
 * the WORKING state is observable at the desk's 1.2 s poll interval. The
 * request still goes to the real gateway and the real model decides; nothing
 * else changes. Load it only into a local test server, never production:
 *
 *   NODE_OPTIONS=--import=$PWD/tests/e2e/support/slow-gateway.mjs JEV_TIMEOUT_MS=10000 pnpm dev
 */
const GATEWAY = "https://ai-gateway.vercel.sh/";
const DELAY_MS = Number(process.env.NORTHWIND_E2E_SELECTOR_DELAY_MS ?? 2500);
const originalFetch = globalThis.fetch;

globalThis.fetch = async function slowGatewayFetch(input, init) {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith(GATEWAY)) return originalFetch(input, init);
  await new Promise((resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const aborted = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", aborted); resolve(); }, DELAY_MS);
    signal?.addEventListener("abort", aborted, { once: true });
  });
  return originalFetch(input, init);
};
