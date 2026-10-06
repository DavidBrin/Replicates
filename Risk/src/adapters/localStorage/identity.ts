/**
 * `IdentityPort` with a cached-name adapter (SPEC §7, §4.16).
 *
 * `risk:identity:v1` holds the display name and colour **only**, for first
 * paint — never a secret; the httpOnly `risk_sid` cookie is the real identity
 * and it is S5's to mint. `claim()` POSTs `/api/session`; offline, or before
 * S5's route exists, a 404/network failure resolves to a local identity so
 * the whole setup flow still works with no server at all.
 */
import type { PlayerColour } from "@/engine/types";
import type { Identity, IdentityPort } from "@/ports/identity";

import { newId, readJson, removeKey, writeJson } from "./store";

export const IDENTITY_KEY = "risk:identity:v1";

export type CachedIdentity = Pick<Identity, "displayName" | "colour">;

export const PLAYER_COLOURS: readonly PlayerColour[] = [
  "red", "green", "blue", "yellow", "orange", "pink", "black", "white", "purple",
];

const ADJECTIVES = [
  "Bold", "Iron", "Swift", "Grim", "Noble", "Silent", "Crimson", "Golden", "Restless", "Steady",
  "Wily", "Granite", "Northern", "Vagrant", "Stout", "Distant",
];
const NOUNS = [
  "General", "Marshal", "Captain", "Pioneer", "Sentinel", "Corsair", "Warden", "Ranger",
  "Admiral", "Hussar", "Lancer", "Brigadier", "Scout", "Dragoon",
];

/** The `<Adjective> <Noun> <NN>` the identity sheet prefills (SPEC §7). */
export function generateName(random: () => number = Math.random): string {
  const a = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)] ?? "Bold";
  const n = NOUNS[Math.floor(random() * NOUNS.length)] ?? "General";
  const nn = String(10 + Math.floor(random() * 90));
  return `${a} ${n} ${nn}`;
}

/** 2–20 characters after trimming (SPEC §7). */
export function isValidDisplayName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 20;
}

function cache(): CachedIdentity | null {
  const raw = readJson<Partial<CachedIdentity> | null>(IDENTITY_KEY, null);
  if (!raw || typeof raw.displayName !== "string") return null;
  const colour = PLAYER_COLOURS.includes(raw.colour as PlayerColour)
    ? (raw.colour as PlayerColour)
    : "red";
  return { displayName: raw.displayName, colour };
}

export interface IdentityAdapterOptions {
  /** Swappable for tests; defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
}

interface SessionResponse {
  readonly playerId?: string;
  readonly displayName?: string;
  readonly colour?: PlayerColour;
  readonly suggestions?: readonly string[];
}

/** Thrown on a 409 so the sheet can show the three suggestions inline. */
export class NameTakenError extends Error {
  readonly suggestions: readonly string[];
  constructor(suggestions: readonly string[]) {
    super("That name is taken");
    this.name = "NameTakenError";
    this.suggestions = suggestions;
  }
}

export function createIdentityAdapter(options: IdentityAdapterOptions = {}): IdentityPort {
  const doFetch = options.fetch ?? (typeof fetch === "function" ? fetch.bind(globalThis) : null);

  const remember = (identity: Identity): Identity => {
    writeJson(IDENTITY_KEY, { displayName: identity.displayName, colour: identity.colour });
    return identity;
  };

  /** Offline, or before S5's route exists: a local identity, remembered. */
  const local = (displayName: string, colour: PlayerColour): Identity =>
    remember({ playerId: `local-${newId()}`, displayName, colour });

  async function post(method: string, body: unknown): Promise<Identity | null> {
    if (!doFetch) return null;
    let response: Response;
    try {
      response = await doFetch("/api/session", {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return null; // no network: the caller falls back to a local identity
    }
    if (response.status === 409) {
      const payload = (await response.json().catch(() => ({}))) as SessionResponse;
      throw new NameTakenError(payload.suggestions ?? []);
    }
    if (response.status === 404 || !response.ok) return null;
    const payload = (await response.json().catch(() => ({}))) as SessionResponse;
    if (!payload.playerId || !payload.displayName) return null;
    return { playerId: payload.playerId, displayName: payload.displayName, colour: payload.colour ?? "red" };
  }

  return {
    readCached: () => cache(),

    async claim(displayName: string): Promise<Identity> {
      const colour = cache()?.colour ?? "red";
      const claimed = await post("POST", { displayName, colour });
      return claimed ? remember(claimed) : local(displayName, colour);
    },

    async setColour(colour: PlayerColour): Promise<Identity> {
      const displayName = cache()?.displayName ?? generateName();
      const updated = await post("PATCH", { colour });
      return updated ? remember({ ...updated, colour }) : local(displayName, colour);
    },

    async leave(): Promise<void> {
      await post("DELETE", undefined).catch(() => null);
      removeKey(IDENTITY_KEY);
    },
  };
}
