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

import {
  KeyboardDispatcher,
  type BindingInput,
  type DispatchContext,
} from "./dispatcher";
import type { KeyToken } from "./keys";
import type { Scope } from "./registry";

/**
 * React's half of the keyboard model.
 *
 * The dispatcher itself knows nothing about React, which is the point: it is
 * testable as a plain object against synthetic `KeyboardEvent`s, and the tests
 * in `__tests__/dispatcher.test.ts` never render anything. This file is the
 * thin part — a context, three hooks, and one decision worth explaining.
 *
 * ## Why the provider is optional
 *
 * `useKeyboard()` falls back to a shared browser-scoped dispatcher attached to
 * `document` rather than throwing when no provider is above it. Every other
 * context in this codebase throws, and this one deliberately does not: the app
 * shell, the issue list and the command palette are built by different slices,
 * and a missing provider would present as "no shortcut in the entire
 * application does anything" — the least debuggable possible symptom, on the
 * feature the product is named for. The fallback is the same object for every
 * caller, so the scope stack still works; wrapping the tree in
 * {@link KeyboardProvider} only adds deterministic teardown, which matters in
 * tests and not in a browser tab.
 */

const KeyboardContext = createContext<KeyboardDispatcher | null>(null);

/** The fallback dispatcher, created and attached on first use in a browser. */
let ambient: KeyboardDispatcher | null = null;

function ambientDispatcher(): KeyboardDispatcher {
  if (ambient === null) {
    ambient = new KeyboardDispatcher();
    if (typeof document !== "undefined") ambient.attach(document);
  }
  return ambient;
}

export interface KeyboardProviderProps {
  children: ReactNode;
  /** Injected by tests that want to drive the dispatcher directly. */
  dispatcher?: KeyboardDispatcher;
  /** Defaults to `document`. */
  target?: EventTarget | null;
}

export function KeyboardProvider({
  children,
  dispatcher,
  target,
}: KeyboardProviderProps) {
  // One instance for the provider's whole life. `useState`'s initialiser rather
  // than `useMemo`, because `useMemo` is explicitly allowed to discard its
  // cache — a dropped dispatcher would silently detach every binding.
  const [owned] = useState(() => dispatcher ?? new KeyboardDispatcher());
  const instance = dispatcher ?? owned;

  useEffect(() => {
    const node = target ?? (typeof document === "undefined" ? null : document);
    if (node === null) return;
    return instance.attach(node);
  }, [instance, target]);

  return (
    <KeyboardContext.Provider value={instance}>
      {children}
    </KeyboardContext.Provider>
  );
}

export function useKeyboard(): KeyboardDispatcher {
  const fromContext = useContext(KeyboardContext);
  // `useState` so the ambient instance is resolved once per component rather
  // than on every render, and so the fallback is not created during SSR.
  const [fallback] = useState(() =>
    fromContext === null ? ambientDispatcher() : null,
  );
  return fromContext ?? fallback ?? ambientDispatcher();
}

/**
 * Register bindings for as long as this component is mounted.
 *
 * The array may be rebuilt on every render — it usually is, since the handlers
 * close over props — without re-registering. Registration is keyed on the
 * binding *ids*, and the handlers are read through a ref at dispatch time. The
 * alternative is a `useMemo` with a dependency array at every call site, and
 * the failure mode of getting that wrong is a shortcut that silently runs a
 * stale closure: it fires, it does something, and the something is one render
 * out of date.
 */
export function useKeyboardScope(
  scope: Scope,
  bindings: readonly BindingInput[],
  options: { readonly enabled?: boolean } = {},
): void {
  const enabled = options.enabled ?? true;
  const dispatcher = useKeyboard();
  const latest = useRef(bindings);

  useEffect(() => {
    latest.current = bindings;
  });

  // The set of keys is what defines this layer; the handlers behind them are
  // free to change. Joining ids and keys means adding or removing a binding
  // re-registers and swapping a callback does not.
  const signature = bindings
    .map((binding) => `${binding.id}:${binding.keys ?? ""}`)
    .join("|");

  useEffect(() => {
    if (!enabled) return;
    const ids = signature === "" ? [] : signature.split("|");
    const proxies: BindingInput[] = ids.map((entry) => {
      const [id = "", keys = ""] = entry.split(":");
      const find = (): BindingInput | undefined =>
        latest.current.find((binding) => binding.id === id);
      return {
        id,
        ...(keys === "" ? {} : { keys }),
        run: (context: DispatchContext) => find()?.run(context),
        when: () => {
          const binding = find();
          if (binding === undefined) return false;
          return binding.when === undefined || binding.when();
        },
        allowWhileTyping: find()?.allowWhileTyping ?? false,
      };
    });
    return dispatcher.register(scope, proxies);
  }, [dispatcher, scope, signature, enabled]);
}

/**
 * Claim one rung of the Escape ladder while `active`.
 *
 * `close` returns whether it consumed the key. Returning false lets `Escape`
 * fall to the rung below, which is how "close the picker" and "clear the
 * selection" coexist on one screen without the picker's rung swallowing the
 * press that was meant for the list.
 */
export function useEscapeLayer(
  id: string,
  close: () => boolean,
  active: boolean,
): void {
  const dispatcher = useKeyboard();
  const latest = useRef(close);

  useEffect(() => {
    latest.current = close;
  });

  useEffect(() => {
    if (!active) return;
    return dispatcher.pushEscapeLayer({ id, close: () => latest.current() });
  }, [dispatcher, id, active]);
}

/**
 * The armed chord prefix, for the "G …" affordance.
 *
 * Subscribed rather than polled so the hint appears on the same frame the
 * prefix is armed. An armed chord the user cannot see is invisible modal state,
 * and invisible modal state is where "why did that just happen" comes from.
 */
export function useChordHint(): readonly KeyToken[] {
  const dispatcher = useKeyboard();
  const [buffer, setBuffer] = useState<readonly KeyToken[]>(dispatcher.chord);

  useEffect(() => dispatcher.onChordChange(setBuffer), [dispatcher]);

  return buffer;
}

/**
 * A single global binding, for the many callers that want exactly one.
 *
 * Sugar over {@link useKeyboardScope}, but the memoisation is the point: an
 * inline `[{ id, run }]` at the call site would re-register on every render
 * without it, and the signature check inside the scope hook only prevents that
 * when the array's shape is stable.
 */
export function useShortcut(
  id: string,
  run: (context: DispatchContext) => void,
  options: {
    readonly scope?: Scope;
    readonly keys?: string;
    readonly when?: () => boolean;
    readonly enabled?: boolean;
  } = {},
): void {
  const { scope = "global", keys, when, enabled } = options;
  const runRef = useRef(run);
  const whenRef = useRef(when);

  useEffect(() => {
    runRef.current = run;
    whenRef.current = when;
  });

  const stableRun = useCallback((context: DispatchContext) => {
    runRef.current(context);
  }, []);
  const stableWhen = useCallback(
    () => (whenRef.current === undefined ? true : whenRef.current()),
    [],
  );

  const bindings = useMemo<BindingInput[]>(
    () => [{ id, ...(keys === undefined ? {} : { keys }), run: stableRun, when: stableWhen }],
    [id, keys, stableRun, stableWhen],
  );

  useKeyboardScope(scope, bindings, enabled === undefined ? {} : { enabled });
}
