"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { useIsClient } from "@/components/ui/popover";
import { Toast, resolveDuration, type ToastData } from "@/components/ui/toast";

/**
 * The toast queue.
 *
 * ## Why this is a provider and not a hook
 *
 * The rule from `research/04-interaction.md` §6.4 is that **toasts must be
 * driven off the mutation queue, not off a component**: a row that unmounted
 * mid-flight still has to produce its error toast. A `useState` inside the row
 * cannot — it went away with the row. So the queue lives above the app and is
 * reachable from anywhere through {@link useToast}.
 *
 * That also makes it callable from outside React entirely, which the optimistic
 * mutation layer needs: it raises toasts from a queue drain, not from a render.
 * {@link ToastProvider} publishes its `toast` function to a module-scoped slot
 * for exactly that caller — see {@link toast}.
 *
 * ## Three visible, newest at the open end
 *
 * Older toasts are dropped rather than stacked. A column of nine cards covers
 * the sidebar, and the tenth error is not more informative than the first
 * three — it is the same error nine times.
 *
 * ## Pausing
 *
 * On hover, and while the tab is hidden. The second one matters more than it
 * looks: without it, a five-second toast raised as you switch away has expired
 * before you switch back, and the undo it was offering is gone.
 */

export interface ToastOptions extends Omit<ToastData, "id"> {
  /**
   * Reuse an id to replace an existing toast in place.
   *
   * The retry case: a mutation that fails, retries and fails again should
   * update one card rather than stack two identical ones.
   */
  id?: string;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Max cards on screen. Older ones are dropped from the far end. */
const MAX_VISIBLE = 3;

/**
 * The module-scoped escape hatch for non-React callers.
 *
 * Set by the mounted provider. Calling it before the provider mounts is a
 * silent no-op rather than a throw — a toast is never important enough to take
 * down the caller that raised it, and the only way to hit this is a mutation
 * that resolves before first paint.
 */
let publish: ((options: ToastOptions) => string) | null = null;

export function toast(options: ToastOptions): string {
  return publish?.(options) ?? "";
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}

export interface ToastProviderProps {
  children: ReactNode;
  /** Bottom-left is Linear's corner: the right side belongs to the properties rail. */
  position?: "bottom-left" | "bottom-right";
}

export function ToastProvider({
  children,
  position = "bottom-left",
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<readonly ToastData[]>([]);
  const [paused, setPaused] = useState(false);
  const mounted = useIsClient();
  const counter = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Time left per toast, so a pause resumes rather than restarts. */
  const deadlines = useRef(new Map<string, { remaining: number; startedAt: number }>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    deadlines.current.delete(id);
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const push = useCallback(
    (options: ToastOptions): string => {
      counter.current += 1;
      const id = options.id ?? `toast-${counter.current}`;
      const entry: ToastData = { ...options, id };

      setToasts((current) => {
        const without = current.filter((existing) => existing.id !== id);
        return [entry, ...without].slice(0, MAX_VISIBLE);
      });

      const duration = resolveDuration(entry);
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      timers.current.delete(id);
      deadlines.current.delete(id);
      if (duration !== null) {
        deadlines.current.set(id, { remaining: duration, startedAt: Date.now() });
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  const dismissAll = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    deadlines.current.clear();
    setToasts([]);
  }, []);

  // Publish for the mutation layer, and tear the slot down on unmount so a
  // stale provider from a hot reload cannot keep receiving toasts.
  useEffect(() => {
    publish = push;
    return () => {
      if (publish === push) publish = null;
    };
  }, [push]);

  useEffect(() => {
    const timerMap = timers.current;
    return () => {
      for (const timer of timerMap.values()) clearTimeout(timer);
      timerMap.clear();
    };
  }, []);

  // A hidden tab cannot be read, so its toasts must not expire. Implemented by
  // pausing the same flag hover uses, which keeps the countdown bar and the
  // dismissal timer in agreement.
  useEffect(() => {
    const onVisibility = (): void => {
      setPaused(document.visibilityState === "hidden");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Pausing has to stop the dismissal timer, not just the bar — and resuming
  // has to continue from where it stopped. Clearing and re-arming with the full
  // duration would hand a toast a fresh five seconds every time the pointer
  // crossed it, which is how a "paused" toast ends up immortal.
  useEffect(() => {
    const now = Date.now();
    if (paused) {
      for (const [id, timer] of timers.current) {
        clearTimeout(timer);
        const deadline = deadlines.current.get(id);
        if (deadline) {
          deadlines.current.set(id, {
            remaining: Math.max(0, deadline.remaining - (now - deadline.startedAt)),
            startedAt: now,
          });
        }
      }
      timers.current.clear();
      return;
    }
    for (const [id, deadline] of deadlines.current) {
      if (timers.current.has(id)) continue;
      deadlines.current.set(id, { ...deadline, startedAt: now });
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), deadline.remaining),
      );
    }
  }, [paused, dismiss]);

  const value = useMemo<ToastContextValue>(
    () => ({ toast: push, dismiss, dismissAll }),
    [push, dismiss, dismissAll],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted
        ? createPortal(
            <div
              data-toast-viewport=""
              // `aria-relevant="additions"` so the region announces new cards
              // rather than re-reading the stack every time one expires.
              aria-relevant="additions"
              aria-label="Notifications"
              onPointerEnter={() => setPaused(true)}
              onPointerLeave={() => setPaused(false)}
              className={cn(
                "pointer-events-none fixed bottom-4 flex flex-col-reverse gap-2",
                position === "bottom-left" ? "left-4" : "right-4",
              )}
              style={{ zIndex: "var(--z-toast)" }}
            >
              {toasts.map((entry) => (
                <Toast
                  key={entry.id}
                  toast={entry}
                  onDismiss={dismiss}
                  paused={paused}
                />
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}
