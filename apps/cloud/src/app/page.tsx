import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/server/supabase";
export default async function Landing() {
  const { data } = await (await userClient()).auth.getUser();
  if (data.user) redirect("/projects");
  return <><section className="landing-hero"><h1>Your projects.<br/>One connection.</h1><div className="hero-detail"><p className="lede">Connect your company projects so your AI agent can help you use them.</p><Link href="/signup" className="button primary">Create account <span className="button-arrow" aria-hidden="true">↗</span></Link></div></section>
  <section className="landing-explanation" aria-labelledby="how-heading"><div><h2 id="how-heading">A little less setup.<br/>A lot more control.</h2><p className="muted">Contour helps your agent understand your apps and propose views that fit the work you want to do.</p></div><ol className="flow-list"><li><h3>Link your projects</h3><p>Sign in at each company to choose what to share. Your company password stays with that company.</p></li><li><h3>Connect your agent once</h3><p>One Contour connection lets your agent find and work with all your linked projects.</p></li><li><h3>Review changes where you work</h3><p>Your agent can read and propose. Open the preview in the company app and choose Accept to save a change.</p></li></ol></section></>;
}
