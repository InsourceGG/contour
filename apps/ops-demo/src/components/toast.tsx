"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { IconCheck, IconAlert, IconClose } from "./icons";

type Tone = "success" | "error" | "info";
type Toast = { id: number; tone: Tone; message: string };

type ToastApi = {
  notify: (message: string, tone?: Tone) => void;
  /** Screen-reader-only announcement without a visible toast. */
  announce: (message: string) => void;
};

const ToastContext = createContext<ToastApi>({ notify: () => {}, announce: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [politeText, setPoliteText] = useState("");
  const [assertiveText, setAssertiveText] = useState("");
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const notify = useCallback(
    (message: string, tone: Tone = "success") => {
      seq.current += 1;
      const id = seq.current;
      setToasts((t) => [...t.slice(-2), { id, tone, message }]);
      if (tone === "error") setAssertiveText(message);
      else setPoliteText(message);
      window.setTimeout(() => dismiss(id), tone === "error" ? 9000 : 5000);
    },
    [dismiss],
  );

  const announce = useCallback((message: string) => {
    // Clear first so repeating the same text is announced again.
    setPoliteText("");
    window.setTimeout(() => setPoliteText(message), 50);
  }, []);

  const api = useMemo(() => ({ notify, announce }), [notify, announce]);

  return (
    <ToastContext value={api}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {politeText}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {assertiveText}
      </div>
      <div className="toast-region" aria-hidden="true">
        {toasts.map((t) => (
          <div key={t.id} className="toast" data-tone={t.tone}>
            {t.tone === "error" ? <IconAlert size={18} /> : <IconCheck size={18} />}
            <p className="flex-1">{t.message}</p>
            <button
              type="button"
              tabIndex={-1}
              className="opacity-70 hover:opacity-100"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              <IconClose size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
