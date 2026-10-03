import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
const geist = localFont({ src: '../../public/fonts/geist-latin.woff2', variable: '--font-geist', weight: '100 900', display: 'swap' });
export const metadata: Metadata = { title: { default: 'Northwind Support', template: '%s · Northwind Support' }, description: 'The customer support workspace for Northwind.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={geist.variable}><body><a className="skip-link" href="#main">Skip to content</a>{children}</body></html>;
}
