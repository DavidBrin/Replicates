/**
 * Typed `localStorage` wrapper for the create-bet wizard's draft
 * persistence (SPEC §3.4, research/social-and-invites.md §4.2's "highest-
 * leverage UX decision" — a refresh mid-wizard must lose nothing).
 *
 * Deliberately generic (`DraftStore<T>`) and constructed via a factory
 * rather than hard-coding the wizard's `WizardDraft` shape in here, so this
 * module stays swappable (a future task could point it at `sessionStorage`,
 * an in-memory fake for tests, or eventually a server-persisted draft) and
 * independently testable without importing anything from
 * `src/components/wizard/**`.
 *
 * Every method is a plain synchronous call — callers persist on every
 * change from inside their own event handlers (an `onChange`, not a
 * `useEffect`), so writes never race React's render/commit cycle and this
 * module never needs to be a React hook itself.
 *
 * Guards `localStorage` being unavailable (SSR — `window` doesn't exist;
 * private/incognito browsing — `setItem` throws `QuotaExceededError` in
 * Safari private mode, or the whole `localStorage` getter throws in some
 * locked-down embedded contexts) by treating every failure as "no draft
 * persistence right now" rather than throwing. A caller that can't persist
 * still works — it just won't survive a refresh.
 */

/** The minimal typed contract every draft store implements. */
export interface DraftStore<T> {
  /** Returns the persisted draft, or `null` if there is none, the stored
   * value is corrupt/unparseable, or storage isn't available. Never
   * throws. */
  get(): T | null;
  /** Persists `value`, overwriting anything previously stored under this
   * key. A storage failure (quota, private mode, unavailable) is silently
   * swallowed — never throws. */
  set(value: T): void;
  /** Removes the persisted draft, if any. Never throws. */
  clear(): void;
}

/** `true` iff `window.localStorage` exists and actually accepts a write —
 * some browsers expose the property but throw on first use (Safari private
 * mode raises on `setItem`, not on the `localStorage` getter itself), so
 * this probes with a real (immediately-removed) write rather than just
 * checking for the property's existence. */
function isStorageAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const probeKey = "__bet_draft_storage_probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds a `DraftStore<T>` backed by `localStorage` under a single fixed
 * `key`. `T` is never validated at runtime beyond "did `JSON.parse`
 * succeed" — callers own their own shape and any migration between draft
 * versions (see `WizardDraft`'s `version` field for how the wizard does
 * this).
 */
export function createDraftStore<T>(key: string): DraftStore<T> {
  return {
    get(): T | null {
      if (!isStorageAvailable()) return null;
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return null;
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    set(value: T): void {
      if (!isStorageAvailable()) return;
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Quota exceeded, private-mode write rejection, etc. — the draft
        // just won't survive a refresh; the wizard itself keeps working
        // off in-memory React state either way.
      }
    },
    clear(): void {
      if (!isStorageAvailable()) return;
      try {
        window.localStorage.removeItem(key);
      } catch {
        // As above — nothing more we can do, and nothing the caller needs
        // to react to.
      }
    },
  };
}

/** The create-bet draft is keyed per user (David's ambiguity resolution)
 * so two demo users signed in on the same browser never see or clobber
 * each other's in-progress bet. */
export function wizardDraftStorageKey(userId: string): string {
  return `bet:wizard-draft:${userId}`;
}
