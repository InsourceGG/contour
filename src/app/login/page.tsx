import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { tryHostUser } from "@/server/context";
import { ContourMark, HeroLines } from "@/components/contour-art";
import { LoginForm } from "@/components/login/LoginForm";
import { safeNextPath } from "@/components/login/safe-next";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  const user = await tryHostUser();
  if (user) redirect(next);

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main id="main" className="flex flex-col px-5 py-8 sm:px-10 lg:px-16 lg:py-12">
        <p className="flex items-center gap-2 font-semibold">
          <span className="text-accent">
            <ContourMark />
          </span>
          <span style={{ fontVariationSettings: '"wdth" 80' }}>Contour</span>
        </p>
        <div className="my-auto w-full max-w-[26rem] py-10">
          <h1 className="text-2xl font-semibold sm:text-3xl">Sign in to your operations workspace</h1>
          <p className="mt-3 text-ink-2">
            Your dashboard can adapt to the task in front of you. Your company decides what can change, and you decide
            what to keep.
          </p>
          <LoginForm next={next} />
        </div>
        <p className="meta">Demo environment with synthetic data. Payments run in Stripe test mode.</p>
      </main>
      <aside
        className="relative hidden overflow-hidden bg-ink text-surface lg:flex lg:flex-col lg:justify-end lg:p-14"
        aria-label="About Contour"
      >
        <HeroLines className="absolute inset-0 h-full w-full text-[#2f6f60]" />
        <div className="relative max-w-md">
          <p className="text-[2rem] leading-tight font-semibold" style={{ fontVariationSettings: '"wdth" 80' }}>
            The same data and the same permissions, shown the way you work.
          </p>
          <ul className="mt-6 space-y-2 text-[#c9d5d1]">
            <li>Your agent can propose a view. Only you can accept it, here.</li>
            <li>Required alerts and actions always stay in place.</li>
            <li>Undo or reset at any time.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
