/**
 * Isolated E2E server preload. Load with Node's --import only when running
 * live.spec.ts locally; production never imports this module. All host and
 * Supabase requests use real handlers. Only the bounded selector response is
 * a delayed fixture, so WORKING is observable and model confidence is stable.
 */
const originalFetch = globalThis.fetch;
globalThis.fetch = async function fixtureFetch(input, init) {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== "https://ai-gateway.vercel.sh/v1/evaluate") return originalFetch(input, init);
  await new Promise((resolve, reject) => {
    if (init?.signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const aborted = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { init?.signal?.removeEventListener("abort", aborted); resolve(); }, 2800);
    init?.signal?.addEventListener("abort", aborted, { once: true });
  });
  return Response.json({
    answers: { view_choice: { type: "choice", choice: "guided", confidence: 0.96, probabilities: { guided: 0.96 } } },
    model: "live-e2e-fixture", usage: { inputTokens: 0, outputTokens: 0 },
  });
};
