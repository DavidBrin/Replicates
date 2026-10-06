import type { PlayerColour } from "@/engine/types";
import type { Identity, IdentityPort } from "@/ports/identity";

/**
 * `IdentityPort` over `/api/session` (SPEC §4.16, §6.1).
 *
 * The interface is S4's; the three requests behind it are S5's, which is why
 * the adapter lives under `src/net/`. The identity sheet itself is S4's shell
 * with S5's claim (§7's first row), so this is the half the sheet calls into.
 *
 * `localStorage` holds **only the display name and colour**, under
 * `risk:identity:v1`, purely so the sheet and the home screen can paint
 * before `/api/session` answers. **Never a secret** — the secret is the
 * httpOnly half of `risk_sid` and is unreachable from JavaScript by
 * construction.
 */

export const IDENTITY_KEY = "risk:identity:v1";

/** Thrown by `claim` when the name is held: carries the three suggestions. */
export class NameTakenError extends Error {
  constructor(readonly suggestions: readonly string[]) {
    super("nameTaken");
    this.name = "NameTakenError";
  }
}

type CachedIdentity = Pick<Identity, "displayName" | "colour">;

/**
 * Every read and write is wrapped, behind a `typeof window` guard: in a
 * private window or with site data blocked the accessor itself throws, and
 * the right behaviour is that the feature simply does not persist (§4.16).
 */
function readCache(): CachedIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedIdentity>;
    if (typeof parsed.displayName !== "string" || typeof parsed.colour !== "string") return null;
    return { displayName: parsed.displayName, colour: parsed.colour as PlayerColour };
  } catch {
    return null;
  }
}

function writeCache(identity: CachedIdentity | null): void {
  if (typeof window === "undefined") return;
  try {
    if (identity === null) window.localStorage.removeItem(IDENTITY_KEY);
    else window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    /* storage unavailable — the name simply does not survive a reload */
  }
}

async function send(
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<Response> {
  return fetchImpl("/api/session", {
    method,
    cache: "no-store",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

export function createIdentityClient(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): IdentityPort {
  return {
    readCached: readCache,

    async claim(displayName: string): Promise<Identity> {
      const cached = readCache();
      const response = await send(
        "POST",
        cached ? { displayName, colour: cached.colour } : { displayName },
        fetchImpl,
      );
      if (response.status === 409) {
        const body = (await response.json()) as { suggestions?: string[] };
        throw new NameTakenError(body.suggestions ?? []);
      }
      if (!response.ok) throw new Error(`claim failed: ${response.status}`);
      const identity = (await response.json()) as Identity;
      writeCache({ displayName: identity.displayName, colour: identity.colour });
      return identity;
    },

    async setColour(colour: PlayerColour): Promise<Identity> {
      const response = await send("PATCH", { colour }, fetchImpl);
      if (!response.ok) throw new Error(`setColour failed: ${response.status}`);
      const identity = (await response.json()) as Identity;
      writeCache({ displayName: identity.displayName, colour: identity.colour });
      return identity;
    },

    async leave(): Promise<void> {
      await send("DELETE", undefined, fetchImpl);
      writeCache(null);
    },
  };
}
