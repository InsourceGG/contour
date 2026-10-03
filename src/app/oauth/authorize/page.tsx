import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ContourError, type Scope } from "@/sdk/types";
import { APP_ID, resolveHostUser, type HostUser } from "@/server/context";
import { csrfTokenFor } from "@/server/csrf";
import {
  AUTHORIZE_PARAM_NAMES,
  authorizePathFor,
  buildClientRedirect,
  validateAuthorizeRequest,
  type RawParams,
} from "@/server/oauth/authorize";
import { isAgentAccessEnabled } from "@/server/oauth/tokens";

export const metadata: Metadata = {
  title: "Authorize agent access · Contour",
  robots: { index: false, follow: false },
};

const SCOPE_COPY: Record<Scope, { title: string; detail: string }> = {
  "view:read": {
    title: "See your dashboard layout",
    detail:
      "Which approved components appear on the Overview dashboard, their order, density and variants, and your saved view revision.",
  },
  "data:read": {
    title: "Read permitted dashboard summaries",
    detail:
      "Summaries you can already see on the dashboard: revenue totals, key metrics, your task list, recent activity and active alerts. Nothing beyond your own permissions.",
  },
  "view:propose": {
    title: "Propose a layout for your review",
    detail:
      "A proposal never changes your screen. You open a preview in Contour and choose Accept or Keep current. Each ready proposal uses one prepaid adaptation credit.",
  },
  "view:commit": { title: "", detail: "" }, // never offered to agents
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12 text-zinc-900 dark:text-zinc-100">
      <p className="mb-6 text-sm font-semibold tracking-wide text-zinc-500">CONTOUR</p>
      {children}
    </main>
  );
}

function ErrorView({ title, message }: { title: string; message: string }) {
  return (
    <Shell>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-3 text-zinc-700 dark:text-zinc-300" role="alert">
        {message}
      </p>
      <p className="mt-6">
        <a className="underline underline-offset-4" href="/">
          Return to Contour
        </a>
      </p>
    </Shell>
  );
}

export default async function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  const raw = (await searchParams) as RawParams;
  const v = await validateAuthorizeRequest(raw);
  if (v.kind === "fatal") return <ErrorView title="This authorization request is invalid" message={v.message} />;
  if (v.kind === "redirect_error") {
    redirect(buildClientRedirect(v.redirectUri, { error: v.error, error_description: v.description, state: v.state }));
  }
  const req = v.request;

  let user: HostUser | null = null;
  let needsLogin = false;
  try {
    user = await resolveHostUser();
  } catch (e) {
    if (e instanceof ContourError && e.code === "UNAUTHENTICATED") needsLogin = true;
    else if (e instanceof ContourError && e.code === "FORBIDDEN") {
      return <ErrorView title="No access" message="Your account has no active membership for this app, so it cannot be shared with an agent." />;
    } else throw e;
  }
  if (needsLogin || !user) redirect(`/login?next=${encodeURIComponent(authorizePathFor(raw))}`);

  const denyHref = buildClientRedirect(req.redirectUri, {
    error: "access_denied",
    error_description: "The user denied the request",
    state: req.state,
  });
  if (!(await isAgentAccessEnabled(APP_ID))) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Agent access is turned off</h1>
        <p className="mt-3 text-zinc-700 dark:text-zinc-300">
          Your company has disabled personal-agent access for this app. No access can be granted right now.
        </p>
        <p className="mt-6">
          <a className="underline underline-offset-4" href={denyHref}>
            Return to the application
          </a>
        </p>
      </Shell>
    );
  }

  const redirectHost = new URL(req.redirectUri).host;
  const client = req.client;
  const hidden = AUTHORIZE_PARAM_NAMES.map((n) => {
    const value = raw[n];
    return typeof value === "string" ? <input key={n} type="hidden" name={n} value={value} /> : null;
  });

  return (
    <Shell>
      <h1 className="text-2xl font-semibold leading-tight">
        Allow <span className="break-all">{client.clientName}</span> to use your Contour dashboard?
      </h1>

      <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        <p className="font-semibold">Unverified application</p>
        {client.kind === "cimd" && client.metadataHost ? (
          <p className="mt-1">
            Identity document published by <strong>{client.metadataHost}</strong>. Contour has not reviewed this
            application; only continue if you started this connection yourself.
          </p>
        ) : (
          <p className="mt-1">
            The name &ldquo;{client.clientName}&rdquo; was supplied by the application itself and has not been verified by
            Contour. Only continue if you started this connection yourself.
          </p>
        )}
        <p className="mt-1">
          After you decide you will be returned to <strong className="break-all">{redirectHost}</strong>
          {req.loopbackRedirect ? " — an application running on this computer." : "."}
        </p>
      </div>

      <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
        Signed in as <strong>{user.email || user.displayName}</strong> · workspace <strong>{user.tenantId}</strong> ·
        Overview dashboard only
      </p>

      <form method="post" action="/oauth/authorize/decision" className="mt-6">
        {hidden}
        <input type="hidden" name="csrf" value={csrfTokenFor(user.subjectId)} />
        <input type="hidden" name="scope_choice" value="1" />

        <fieldset>
          <legend className="text-base font-semibold">It will be able to</legend>
          <ul className="mt-3 space-y-3">
            {req.scopes.map((s) => (
              <li key={s} className="flex gap-3">
                <input
                  id={`scope-${s}`}
                  type="checkbox"
                  name="grant_scope"
                  value={s}
                  defaultChecked
                  disabled={s === "view:read"}
                  className="mt-1 h-4 w-4"
                  aria-describedby={`scope-${s}-detail`}
                />
                <label htmlFor={`scope-${s}`} className="text-sm">
                  <span className="font-medium">{SCOPE_COPY[s].title}</span>
                  {s === "view:read" ? <span className="text-zinc-500"> (required)</span> : null}
                  <span id={`scope-${s}-detail`} className="block text-zinc-600 dark:text-zinc-400">
                    {SCOPE_COPY[s].detail}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <section className="mt-6" aria-labelledby="never-heading">
          <h2 id="never-heading" className="text-base font-semibold">
            It will never be able to
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
            <li>Save, apply, undo or reset a layout — only you can, in Contour</li>
            <li>Change business data or perform business actions</li>
            <li>Change your permissions, or see other users or workspaces</li>
          </ul>
        </section>

        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          Access tokens last one hour and renew for up to 30 days. You can disconnect this agent at any time from
          Connected agents in Contour.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="submit"
            name="decision"
            value="approve"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Approve
          </button>
          <button
            type="submit"
            name="decision"
            value="deny"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-600"
          >
            Deny
          </button>
        </div>
      </form>
    </Shell>
  );
}
