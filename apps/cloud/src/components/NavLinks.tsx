"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function NavLinks() {
  const path = usePathname();
  return <nav aria-label="Main navigation">{[["/projects","Projects"],["/activity","Activity"],["/owner","Site owner"]].map(([href,label]) => <Link href={href} key={href} aria-current={path===href ? "page" : undefined}>{label}</Link>)}</nav>;
}
