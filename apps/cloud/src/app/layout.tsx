import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource-variable/figtree";
import "./globals.css";
import { userClient } from "@/server/supabase";
import { contour } from "@/server/contour";
import { resolveHostUser } from "@/server/context";
import { NavLinks } from "@/components/NavLinks";
export const metadata: Metadata = { title: { default: "Contour Cloud", template: "%s | Contour Cloud" }, description: "Connect your company projects to your personal AI agent. Review every proposed change in the company’s own app." };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { data } = await (await userClient()).auth.getUser();
  const user = data.user ? await resolveHostUser() : null;
  return <html lang="en"><body><a className="skip" href="#content">Skip to content</a>
    <div className="site-wrap"><header className="site-header"><Link href={user ? "/projects" : "/"} className="brand" aria-label="Contour Cloud home"><span className="brand-mark" aria-hidden="true">c</span><span>Contour <span className="muted">Cloud</span></span></Link>
    {user ? <><NavLinks/><details className="account"><summary aria-label={`Account: ${user.email}`}>{user.email}</summary><div className="account-menu"><p className="small muted">Signed in as</p><p>{user.email}</p><form action="/auth/signout" method="post"><input type="hidden" name="csrf" value={contour.oauth.csrfTokenFor(user)}/><button className="button" type="submit">Sign out</button></form></div></details></> : <Link href="/login" className="button">Sign in</Link>}
    </header><main id="content" tabIndex={-1}>{children}</main><footer className="site-footer"><span>Contour Cloud</span><p>You choose what changes. Your company keeps control.</p></footer></div>
  </body></html>;
}
