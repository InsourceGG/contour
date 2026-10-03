import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveHostContext, tryHostUser } from "@/server/context";
import { getBroker } from "@/server/broker";
import { userClient } from "@/server/supabase";
import { AppShell } from "@/components/shell/AppShell";
import { BuyCreditButton } from "@/components/billing/BuyCreditButton";
import { CheckoutStatus } from "@/components/billing/CheckoutStatus";
import { formatDateTime, formatMoney } from "@/components/format";

export const metadata: Metadata = { title: "Billing" };

type OrderRow = { id: string; status: string; amount: number; currency: string; created_at: string; granted_at: string | null };
type CreditRow = { id: string; status: string; created_at: string; reserved_at: string | null; consumed_at: string | null; proposal_id: string | null };

const ORDER_STATUS: Record<string, string> = {
  pending: "Waiting for payment confirmation",
  granted: "Paid, credit added",
  canceled: "Canceled",
  rejected: "Rejected",
};
const CREDIT_STATUS: Record<string, string> = { available: "Available", reserved: "In use by a request", consumed: "Used" };

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const user = await tryHostUser();
  if (!user) redirect("/login?next=/billing");
  const ctx = await resolveHostContext();
  const balance = await getBroker().creditBalance(ctx);

  // RLS scopes both tables to the signed-in owner; tenant filter selects the active membership.
  const supa = await userClient();
  const [ordersRes, creditsRes] = await Promise.all([
    supa
      .from("billing_orders")
      .select("id,status,amount,currency,created_at,granted_at")
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: false })
      .limit(10),
    supa
      .from("credits")
      .select("id,status,created_at,reserved_at,consumed_at,proposal_id")
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const orders = (ordersRes.data ?? []) as OrderRow[];
  const credits = (creditsRes.data ?? []) as CreditRow[];

  const sp = await searchParams;
  const checkout = Array.isArray(sp.checkout) ? sp.checkout[0] : sp.checkout;

  return (
    <AppShell user={user}>
      <div className="space-y-8">
        <header>
          <h1 className="text-2xl font-semibold md:text-3xl">Billing and credits</h1>
          <p className="mt-1 max-w-[68ch] text-ink-2">
            Credits pay for preparing a proposed view. Everything else on your dashboard is included.
          </p>
        </header>

        {checkout === "success" && <CheckoutStatus initialAvailable={balance.available} latestOrderGranted={orders[0]?.status === "granted"} />}
        {(checkout === "cancel" || checkout === "canceled") && (
          <p role="status" className="notice notice-info">
            Checkout was canceled. You weren&apos;t charged.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <section aria-labelledby="bal" className="panel p-5 md:p-6">
            <h2 id="bal" className="section-title">
              Your balance
            </h2>
            <p className="mt-3">
              <span className="text-5xl font-semibold tracking-tight">{balance.available}</span>
              <span className="ml-2 text-ink-2">{balance.available === 1 ? "credit available" : "credits available"}</span>
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-ink-3">Reserved by a running request</dt>
                <dd className="num font-semibold">{balance.reserved}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Used</dt>
                <dd className="num font-semibold">{balance.consumed}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="buy" className="panel p-5 md:p-6">
            <h2 id="buy" className="section-title">
              Buy a credit
            </h2>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
              <span className="text-3xl font-semibold">USD 1.00</span>
              <span className="text-ink-2">for 1 credit</span>
              <span className="badge badge-warning">Demo amount, test mode</span>
            </p>
            <p className="mt-1 text-sm text-ink-3">This is a demonstration price, not final pricing. No real card is charged.</p>
            <ul className="mt-4 space-y-1.5 text-sm text-ink-2">
              <li>
                One credit is used each time a request finishes with a ready proposal, <strong className="text-ink">even if you then keep your current view</strong>.
              </li>
              <li>If we suggest keeping your view, ask a question, or the request fails, no credit is used.</li>
              <li>Accepting, undoing and resetting views are always free.</li>
            </ul>
            <div className="mt-5">
              <BuyCreditButton />
            </div>
          </section>
        </div>

        <section aria-labelledby="ledger" className="space-y-3">
          <h2 id="ledger" className="section-title">
            Credit history
          </h2>
          {credits.length === 0 ? (
            <p className="text-ink-2">No credits yet. Buy one above to request your first proposal.</p>
          ) : (
            <div className="panel table-scroll">
              <table className="data-table">
                <caption className="sr-only">Your credits, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Added</th>
                    <th scope="col">Status</th>
                    <th scope="col">Used</th>
                    <th scope="col">Proposal</th>
                  </tr>
                </thead>
                <tbody>
                  {credits.map((c) => (
                    <tr key={c.id}>
                      <td>{formatDateTime(c.created_at)}</td>
                      <td>{CREDIT_STATUS[c.status] ?? c.status}</td>
                      <td>{c.consumed_at ? formatDateTime(c.consumed_at) : "—"}</td>
                      <td className="text-ink-2">{c.proposal_id ? <span title={c.proposal_id}>{c.proposal_id.slice(0, 8)}</span> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="orders" className="space-y-3">
          <h2 id="orders" className="section-title">
            Orders
          </h2>
          {orders.length === 0 ? (
            <p className="text-ink-2">No orders yet.</p>
          ) : (
            <div className="panel table-scroll">
              <table className="data-table">
                <caption className="sr-only">Your recent orders, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Created</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">Credit added</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td>{formatDateTime(o.created_at)}</td>
                      <td>{ORDER_STATUS[o.status] ?? o.status}</td>
                      <td className="num">{formatMoney(o.amount / 100, o.currency.toUpperCase())}</td>
                      <td>{o.granted_at ? formatDateTime(o.granted_at) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="meta">Credits are added only after our server verifies Stripe&apos;s signed confirmation.</p>
        </section>
      </div>
    </AppShell>
  );
}
