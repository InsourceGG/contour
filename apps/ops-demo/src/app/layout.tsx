import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import { ComponentStateProvider } from "@contour/sdk/react";
import "./globals.css";

const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  axes: ["wdth"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Operations overview", template: "%s | Contour" },
  description: "Your operations workspace. Adapt the view to your task and expertise within company guardrails.",
};

export const viewport: Viewport = {
  themeColor: "#edf0ef",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${instrument.variable} antialiased`}>
      <body className="min-h-dvh">
        {/* Component state lives above every page so a draft survives preview → accept → dashboard. */}
        <ComponentStateProvider>
          <ToastProvider>{children}</ToastProvider>
        </ComponentStateProvider>
      </body>
    </html>
  );
}
