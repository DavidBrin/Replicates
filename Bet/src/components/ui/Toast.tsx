"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export type ToastVariant = "default" | "success" | "error";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. Default 4000. */
  durationMs?: number;
}

interface ToastRecord extends Required<Pick<ToastOptions, "title" | "variant" | "durationMs">> {
  id: string;
  description?: string;
}

export interface ToastContextValue {
  show: (toast: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const variantIcon: Record<ToastVariant, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  error: XCircle,
};

const variantClasses: Record<ToastVariant, string> = {
  default: "border-(--border) text-(--text-1)",
  success: "border-(--yes-br) text-(--yes)",
  error: "border-(--no-br) text-(--no)",
};

let nextId = 0;

/**
 * App-wide toast host (SPEC: trade confirmations, friend-request results,
 * etc.). Wrap the app once in `<ToastProvider>`; call `useToast().show(...)`
 * anywhere beneath it. Client component — owns timers and a live region.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((toast: ToastOptions) => {
    const id = `toast-${++nextId}`;
    setToasts((prev) => [
      ...prev,
      {
        id,
        title: toast.title,
        description: toast.description,
        variant: toast.variant ?? "default",
        durationMs: toast.durationMs ?? 4000,
      },
    ]);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== "undefined"
        ? createPortal(
            <div
              role="status"
              aria-live="polite"
              className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
            >
              {toasts.map((t) => (
                <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.durationMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id, toast.durationMs]);

  const Icon = variantIcon[toast.variant];

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-(--radius-card) border bg-(--surface-2) p-4 shadow-2xl",
        variantClasses[toast.variant],
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-(--text-1)">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-sm text-(--text-2)">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-(--radius-input) p-1 text-(--text-3) hover:bg-(--surface-3) hover:text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Reads the nearest `<ToastProvider>`'s `show` function. Throws if none is
 * mounted, so a missing provider fails loudly instead of silently no-oping. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be used within a <ToastProvider>");
  return ctx;
}
