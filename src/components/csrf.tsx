"use client";

import { createContext, useContext, type ReactNode } from "react";

const CsrfContext = createContext<string>("");

/** Session-bound CSRF token rendered by the server page; read by client mutations. */
export function CsrfProvider({ token, children }: { token: string; children: ReactNode }) {
  return <CsrfContext value={token}>{children}</CsrfContext>;
}

export function useCsrf(): string {
  return useContext(CsrfContext);
}
