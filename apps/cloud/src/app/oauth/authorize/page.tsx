import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Scope } from "@contour/sdk/core";
import { AUTHORIZE_PARAM_NAMES, authorizePathFor, type RawParams } from "@contour/sdk/server";
import { tryHostUser } from "@/server/context";
import { contour } from "@/server/contour";

export const metadata: Metadata = { title: "Connect an agent", robots: { index: false, follow: false } };

const COPY: Record<Scope, { title: string; detail: string }> = {
  "view:read": {
    title: "List and link your projects",
    detail: "See your linked projects, find available projects and describe the views you can access.",
  },
  "data:read": {
    title: "Read permitted project data",
    detail: "Read the summaries each company allows for your linked account. Company permissions still apply.",
  },
  "view:propose": {
    title: "Propose views for your review",
    detail: "Suggest a view for your task. You open the preview in the company app and choose whether to Accept.",
  },
  "view:commit": { title: "", detail: "" },
};

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="page-shell narrow"><section className="panel consent-panel">{children}</section></div>;
}

function ErrorView({ message }: { message: string }) {
  return <Shell><h1>Connection unavailable</h1><p className="notice" role="alert">{message}</p>
    <Link href="/projects" className="button secondary">Return to your projects</Link></Shell>;
}

export default async function AuthorizePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams as RawParams;
  const validation = await contour.oauth.validateAuthorize(raw);
  if (validation.kind === "fatal") return <ErrorView message={validation.message} />;
  if (validation.kind === "redirect_error") {
    const back = contour.oauth.buildClientRedirect(validation.redirectUri, {
      error: validation.error, error_description: validation.description, state: validation.state,
    });
    return <Shell><h1>This connection could not start</h1><p className="notice" role="alert">{validation.description}</p>
      <p className="muted">Continue only if you started a connection with <strong>{new URL(validation.redirectUri).host}</strong>.</p>
      <a href={back} rel="noreferrer" className="button secondary">Return to the application</a></Shell>;
  }
  const user = await tryHostUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(authorizePathFor(raw))}`);
  const request = validation.request;
  const client = request.client;
  const redirectHost = new URL(request.redirectUri).host;
  const hidden = AUTHORIZE_PARAM_NAMES.map((name) => typeof raw[name] === "string"
    ? <input type="hidden" key={name} name={name} value={raw[name] as string} /> : null);

  return <Shell>
    <h1>Connect <span className="break-anywhere">{client.clientName}</span> to your projects?</h1>
    <p className="muted">Signed in as <strong>{user.email}</strong></p>
    <div className="notice">
      <strong>{request.trustedClient ? "Recognized application" : "Check the application"}</strong>
      <p>{client.kind === "cimd" && client.metadataHost
        ? <>Its identity document is published by <strong>{client.metadataHost}</strong>. </>
        : <>The application supplied the name <strong>{client.clientName}</strong>. </>}
        {request.trustedClient ? "Continue if you started this connection." : "Contour has not reviewed this application. Continue only if you started this connection."}</p>
      <p>You will return to <strong className="break-anywhere">{redirectHost}</strong>{request.loopbackRedirect ? ", an application on this computer." : "."}</p>
    </div>
    <form method="post" action="/oauth/authorize/decision">
      {hidden}
      <input type="hidden" name="csrf" value={contour.oauth.csrfTokenFor(user)} />
      <input type="hidden" name="scope_choice" value="1" />
      <fieldset className="consent-scopes">
        <legend>Choose what this agent can do</legend>
        {request.scopes.map((scope) => <div className="consent-option" key={scope}>
          <input id={`scope-${scope}`} type="checkbox" name="grant_scope" value={scope}
            defaultChecked disabled={scope === "view:read"} aria-describedby={`scope-${scope}-detail`} />
          <label htmlFor={`scope-${scope}`}><strong>{COPY[scope].title}{scope === "view:read" ? " (required)" : ""}</strong>
            <span id={`scope-${scope}-detail`} className="muted">{COPY[scope].detail}</span></label>
        </div>)}
      </fieldset>
      <div className="consent-boundary">
        <h2>Your decisions stay with you</h2>
        <p>This agent can never save anything. Accepting a proposed view always happens in the company’s own app.</p>
        <p className="muted">It cannot change business data or your permissions. You can revoke access from your projects page at any time.</p>
      </div>
      <p className="muted small">Access lasts one hour and can renew for up to 30 days.</p>
      <div className="actions">
        <button className="button primary" type="submit" name="decision" value="approve">Approve</button>
        <button className="button secondary" type="submit" name="decision" value="deny">Deny</button>
      </div>
    </form>
  </Shell>;
}
