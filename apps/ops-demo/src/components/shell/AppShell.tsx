import "server-only";
import Link from "next/link";
import type { ReactNode } from "react";
import type { HostUser } from "@/server/context";
import { csrfTokenFor } from "@/server/csrf";
import { CsrfProvider } from "@/components/csrf";
import { ContourMark } from "@/components/contour-art";
import { tenantName } from "@/components/format";
import { NavLinks } from "./NavLinks";
import { AccountMenu } from "./AccountMenu";

/**
 * Company-owned chrome: navigation, account and sign-out live outside the
 * adaptable surface and are never changed by a proposal.
 */
export function AppShell({ user, children }: { user: HostUser; children: ReactNode }) {
  const items = [
    { href: "/", label: "Dashboard" },
    { href: "/settings", label: "Settings" },
    { href: "/billing", label: "Billing" },
    ...(user.role === "operator" ? [{ href: "/console", label: "Console" }] : []),
  ];
  return (
    <CsrfProvider token={csrfTokenFor(user)}>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <header className="border-b border-rule bg-paper/95">
        <div className="page flex min-h-16 flex-wrap items-center gap-x-6 gap-y-1 py-2">
          <Link href="/" className="flex items-center gap-2 rounded-md font-semibold text-ink" aria-label="Contour, go to dashboard">
            <span className="text-accent">
              <ContourMark />
            </span>
            <span className="text-[1.0625rem]" style={{ fontVariationSettings: '"wdth" 80' }}>
              Contour
            </span>
          </Link>
          <nav aria-label="Main" className="order-3 -mx-3 w-full sm:order-none sm:mx-0 sm:w-auto sm:flex-1">
            <NavLinks items={items} />
          </nav>
          <div className="ml-auto sm:ml-0">
            <AccountMenu displayName={user.displayName} email={user.email} tenant={tenantName(user.tenantId)} role={user.role} />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="page pt-6 pb-24 md:pt-8">
        {children}
      </main>
    </CsrfProvider>
  );
}
