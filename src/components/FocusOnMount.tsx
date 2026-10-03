"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Moves focus to the first focusable-by-script child (e.g. a heading with tabIndex=-1) on mount. */
export function FocusOnMount({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = ref.current?.querySelector<HTMLElement>("[tabindex]");
    target?.focus();
  }, []);
  return (
    <div ref={ref} className="contents">
      {children}
    </div>
  );
}
