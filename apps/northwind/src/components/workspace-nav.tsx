'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brand } from './brand';
import type { Session } from '@/data/types';
import { useRef } from 'react';
export function WorkspaceNav({ session }: { session: Session }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const links = [['/desk', 'Desk'], ['/customers', 'Customers'], ['/reports', 'Reports'], ['/settings', 'Settings'], ...(session.role === 'admin' ? [['/admin', 'Admin']] : [])];
  return <header className="workspace-header"><div className="header-inner">
    <Link className="brand-link" href="/desk" aria-label="Northwind Support desk"><Brand /></Link>
    <nav aria-label="Main navigation">{links.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</Link>)}</nav>
    <details ref={menu} className="account-menu" onKeyDown={e => { if (e.key === 'Escape') { menu.current?.removeAttribute('open'); menu.current?.querySelector('summary')?.focus(); } }}>
      <summary><span className="avatar">{session.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</span><span className="account-name">{session.name.split(' ')[0]}</span><span aria-hidden="true" className="account-chevron">⌄</span><span className="sr-only">Account menu</span></summary>
      <div className="account-popover"><strong>{session.name}</strong><span>{session.email}</span><p>{session.role === 'admin' ? 'Administrator · All teams' : `${session.role === 'lead' ? 'Team lead' : 'Support agent'} · ${session.team}`}</p><Link href="/settings">Manage profile</Link><form action="/api/auth/logout" method="post"><button type="submit">Sign out</button></form></div>
    </details>
  </div></header>;
}
