"use client";

import { useEffect, useMemo, useState } from "react";

import type { PlayerColour } from "@/engine/types";
import type { Identity } from "@/ports/identity";

import { createIdentityClient, NameTakenError } from "@/net/identityClient";

/**
 * The identity sheet's **claim** (SPEC §7's first row: "S4 shell, S5 claim").
 *
 * A generated `<Adjective> <Noun> <NN>` is prefilled, the name is editable
 * (2–20 characters), nine colour swatches, `Continue`. A `409` shows the
 * three suggestions inline, because we **never silently rename**: the player
 * chose that name and should be told it is taken.
 *
 * The chrome here is deliberately plain. S4 owns the sheet's visual shell and
 * will wrap this; what cannot move is the claim — the request, the `409`
 * handling, and the rule that `localStorage` holds the name and colour and
 * never a secret.
 */

export const COLOURS: readonly PlayerColour[] = [
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "pink",
  "purple",
  "black",
  "white",
];

const ADJECTIVES = [
  "Bold", "Brisk", "Calm", "Clever", "Daring", "Fierce", "Grim", "Iron",
  "Keen", "Lucky", "Noble", "Quiet", "Rapid", "Sly", "Stout", "Swift",
  "Vast", "Wary", "Wild", "Wise",
] as const;

const NOUNS = [
  "Admiral", "Baron", "Captain", "Consul", "Corsair", "Duke", "Envoy",
  "General", "Herald", "Hussar", "Lancer", "Marshal", "Pilot", "Ranger",
  "Regent", "Scout", "Sentry", "Sultan", "Tribune", "Viceroy",
] as const;

/**
 * The prefilled default, generated client-side so the sheet can paint before
 * any request. The server generates its own for a caller that sends nothing;
 * the two lists are the same wording, and neither is RGD's unverified
 * "Lucius The Cruel 33" phrasing (§6.1).
 */
export function suggestDisplayName(random: () => number = Math.random): string {
  const adjective = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)] ?? "Bold";
  const noun = NOUNS[Math.floor(random() * NOUNS.length)] ?? "General";
  return `${adjective} ${noun} ${10 + Math.floor(random() * 90)}`;
}

export interface IdentitySheetProps {
  readonly onClaimed: (identity: Identity) => void;
  readonly title?: string;
}

export default function IdentitySheet({ onClaimed, title }: IdentitySheetProps) {
  const identity = useMemo(() => createIdentityClient(), []);
  const [name, setName] = useState("");
  const [colour, setColour] = useState<PlayerColour>("red");
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const cached = identity.readCached();
    setName(cached?.displayName ?? suggestDisplayName());
    if (cached?.colour) setColour(cached.colour);
  }, [identity]);

  async function claim(candidate: string): Promise<void> {
    setBusy(true);
    setError(null);
    setSuggestions([]);
    try {
      const claimed = await identity.claim(candidate);
      if (claimed.colour !== colour) {
        onClaimed(await identity.setColour(colour));
        return;
      }
      onClaimed(claimed);
    } catch (thrown) {
      if (thrown instanceof NameTakenError) {
        setError("That name is taken.");
        setSuggestions(thrown.suggestions);
      } else {
        setError("Could not reach the server. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const valid = name.trim().length >= 2 && name.trim().length <= 20;

  return (
    <form
      data-testid="identity-sheet"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) void claim(name.trim());
      }}
      className="mx-auto flex w-full max-w-md flex-col gap-5 rounded-2xl border border-[color:var(--chrome-line)] bg-[color:var(--chrome-800)] p-6"
    >
      <h1 className="font-head text-2xl font-black text-[color:var(--text)]">
        {title ?? "Choose a name"}
      </h1>

      <label className="flex flex-col gap-2 text-sm text-[color:var(--text-muted)]">
        Display name
        <input
          data-testid="identity-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={20}
          autoComplete="off"
          className="rounded-lg border border-[color:var(--chrome-line)] bg-[color:var(--chrome-900)] px-3 py-2 font-head text-lg text-[color:var(--text)]"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-sm text-[color:var(--text-muted)]">Colour</legend>
        <div data-testid="identity-colours" className="flex flex-wrap gap-2">
          {COLOURS.map((option) => (
            <button
              key={option}
              type="button"
              data-testid={`identity-colour-${option}`}
              aria-label={option}
              aria-pressed={colour === option}
              onClick={() => setColour(option)}
              style={{ background: `var(--p-${option})` }}
              className={`h-9 w-9 rounded-full border-2 ${
                colour === option
                  ? "border-[color:var(--gold)]"
                  : "border-[color:var(--chrome-line)]"
              }`}
            />
          ))}
        </div>
      </fieldset>

      {error !== null && (
        <p data-testid="identity-error" className="text-sm text-[color:var(--danger)]">
          {error}
        </p>
      )}

      {suggestions.length > 0 && (
        <div data-testid="identity-suggestions" className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              data-testid="identity-suggestion"
              onClick={() => {
                setName(suggestion);
                void claim(suggestion);
              }}
              className="rounded-full border border-[color:var(--chrome-line)] px-3 py-1 text-sm text-[color:var(--text)]"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <button
        type="submit"
        data-testid="identity-continue"
        disabled={!valid || busy}
        className="rounded-xl bg-[color:var(--go)] px-6 py-3 font-head text-lg font-bold text-white disabled:bg-[color:var(--disabled)]"
      >
        Continue
      </button>
    </form>
  );
}
